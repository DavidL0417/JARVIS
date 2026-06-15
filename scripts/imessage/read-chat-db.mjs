#!/usr/bin/env node
// Operator-only iMessage reader — runs on the operator's Mac, NOT on the server.
//
// macOS stores every iMessage/SMS in ~/Library/Messages/chat.db (SQLite). This
// script snapshots that DB, decodes recent messages, FILTERS them locally, and POSTs
// the survivors to the hidden /api/integrations/imessage/ingest webhook. The server
// never sees chat.db; all macOS-specific work (attributedBody decode, Apple-epoch ->
// ISO) and all filtering happen here, so spam / 2FA / non-allowlisted group bodies
// never leave the machine.
//
// FILTERING (mirrors the Scheduler's messages_snapshot.py):
//   - Fetches the operator's curated contact allowlist from /filter-config.
//   - Includes a chat if it contains an allowlisted contact (1:1 OR group), OR it is
//     a 1:1 with a non-shortcode handle and real two-way traffic in the last 30 days.
//   - Drops shortcodes (<7 digit senders: banks, 2FA, delivery, payment) and any
//     group with no allowlisted member.
//
// REQUIREMENTS
//   - The process running this needs Full Disk Access (Terminal, or the node binary
//     launchd runs): System Settings -> Privacy & Security -> Full Disk Access.
//   - macOS `sqlite3` CLI (ships with macOS) and Node 18+ (global fetch).
//
// USAGE
//   IMESSAGE_INGEST_SECRET=... JARVIS_APP_URL=https://mydearestjarvis.vercel.app \
//     node scripts/imessage/read-chat-db.mjs [--since-days 7] [--limit 5000] [--backfill] [--dry-run]
//
// A cursor at ~/.jarvis/imessage-cursor.json tracks the last message processed so
// re-runs only send new messages. --backfill ignores the cursor and re-scans the full
// --since-days window (use a big --since-days once to capture history for allowlisted
// contacts). See docs/decisions/operator-only-imessage.md.

import { execFileSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

const HOME = homedir()
const CHAT_DB = join(HOME, "Library", "Messages", "chat.db")
const CURSOR_PATH = join(HOME, ".jarvis", "imessage-cursor.json")
const APPLE_EPOCH_OFFSET_SECONDS = 978_307_200 // 2001-01-01 -> 1970-01-01
const POST_BATCH_SIZE = 200
// How far back to look when deciding if a non-allowlisted 1:1 is a real two-way
// relationship. Wider than the incremental fetch window so a back-and-forth that
// spans several runs still counts. Mirrors the Scheduler's rolling window.
const BIDIRECTIONAL_WINDOW_DAYS = 30

function parseArgs(argv) {
  const args = { sinceDays: 7, limit: 5000, dryRun: false, backfill: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--since-days") args.sinceDays = Number(argv[++i])
    else if (arg === "--limit") args.limit = Number(argv[++i])
    else if (arg === "--dry-run") args.dryRun = true
    else if (arg === "--backfill") args.backfill = true
  }
  return args
}

function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

// --- handle normalization (mirror of lib/imessage/handles.ts) ----------------
function normalizeHandle(handle) {
  if (!handle) return ""
  const trimmed = String(handle).trim()
  if (!trimmed) return ""
  if (trimmed.includes("@")) return trimmed.toLowerCase()
  const digits = trimmed.replace(/\D/g, "")
  return digits.length >= 10 ? digits.slice(-10) : digits
}

function isShortcode(handle) {
  if (!handle) return false
  const trimmed = String(handle).trim()
  if (trimmed.includes("@")) return false
  const digits = trimmed.replace(/\D/g, "")
  return digits.length < 7
}

// --- Apple-epoch dates -------------------------------------------------------
// chat.db's message.date is nanoseconds since 2001-01-01 on modern macOS (it was
// seconds on very old versions). Detect by magnitude, then convert to ISO UTC.
function appleDateToIso(rawDate) {
  const value = Number(rawDate)
  if (!Number.isFinite(value) || value <= 0) return null
  const seconds = value > 1e11 ? value / 1e9 : value
  const unixMs = (seconds + APPLE_EPOCH_OFFSET_SECONDS) * 1000
  const date = new Date(unixMs)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function isoToAppleNanos(iso) {
  const unixMs = new Date(iso).getTime()
  return Math.round((unixMs / 1000 - APPLE_EPOCH_OFFSET_SECONDS) * 1e9)
}

// --- attributedBody decode ---------------------------------------------------
// Modern macOS often leaves message.text NULL and stores the body in
// attributedBody, a serialized NSAttributedString (typedstream). Best-effort
// extraction: after the "NSString" class marker, a '+' (0x2b) byte precedes a
// length-prefixed UTF-8 string (0x81 => uint16 LE length, 0x82 => uint32 LE).
// Falls back to null on anything unexpected; such messages are simply skipped.
function decodeAttributedBody(hex) {
  if (!hex) return null
  let buf
  try {
    buf = Buffer.from(hex, "hex")
  } catch {
    return null
  }
  const marker = buf.indexOf("NSString", 0, "ascii")
  if (marker < 0) return null
  let i = buf.indexOf(0x2b, marker)
  if (i < 0) return null
  i += 1
  if (i >= buf.length) return null
  let len = buf[i]
  i += 1
  if (len === 0x81) {
    if (i + 2 > buf.length) return null
    len = buf.readUInt16LE(i)
    i += 2
  } else if (len === 0x82) {
    if (i + 4 > buf.length) return null
    len = buf.readUInt32LE(i)
    i += 4
  }
  if (len <= 0 || i + len > buf.length) return null
  return buf.slice(i, i + len).toString("utf8")
}

// --- chat.db snapshot + queries ----------------------------------------------
// Copy chat.db plus its -wal/-shm sidecars to a temp dir so we read a consistent
// snapshot (SQLite replays the WAL on open) without contending with Messages.app.
function snapshotChatDb() {
  if (!existsSync(CHAT_DB)) {
    fail(`chat.db not found at ${CHAT_DB}. Is this a Mac with Messages set up?`)
  }
  const dir = mkdtempSync(join(tmpdir(), "jarvis-imsg-"))
  const dest = join(dir, "chat.db")
  try {
    copyFileSync(CHAT_DB, dest)
    for (const suffix of ["-wal", "-shm"]) {
      const side = `${CHAT_DB}${suffix}`
      if (existsSync(side)) copyFileSync(side, `${dest}${suffix}`)
    }
  } catch (error) {
    rmSync(dir, { recursive: true, force: true })
    if (error && error.code === "EPERM") {
      fail("Permission denied reading chat.db. Grant your terminal Full Disk Access (see header).")
    }
    fail(`Failed to snapshot chat.db: ${error?.message ?? error}`)
  }
  return { dir, dest }
}

function runQuery(dbPath, sql) {
  let stdout
  try {
    stdout = execFileSync("sqlite3", ["-json", dbPath, sql], { maxBuffer: 256 * 1024 * 1024 }).toString("utf8")
  } catch (error) {
    fail(`sqlite3 query failed: ${error?.message ?? error}`)
  }
  const trimmed = stdout.trim()
  if (!trimmed) return []
  try {
    return JSON.parse(trimmed)
  } catch (error) {
    fail(`Could not parse sqlite3 JSON output: ${error?.message ?? error}`)
  }
}

// chat_id -> [participant handles]. chat_handle_join lists only the OTHER parties,
// so a 1:1 chat has exactly one participant and a group has >1.
function queryParticipants(dbPath) {
  const rows = runQuery(
    dbPath,
    `SELECT chj.chat_id AS chatId, h.id AS handle
     FROM chat_handle_join chj
     JOIN handle h ON h.ROWID = chj.handle_id;`,
  )
  const byChat = new Map()
  for (const row of rows) {
    if (!row.handle) continue
    const list = byChat.get(row.chatId) ?? []
    list.push(String(row.handle))
    byChat.set(row.chatId, list)
  }
  return byChat
}

// chat_id -> display name (null for 1:1 threads).
function queryChatNames(dbPath) {
  const rows = runQuery(dbPath, `SELECT c.ROWID AS chatId, c.display_name AS displayName FROM chat c;`)
  const byChat = new Map()
  for (const row of rows) {
    byChat.set(row.chatId, row.displayName ?? null)
  }
  return byChat
}

// chat_id -> { sent, recv } over the bidirectional window, to tell a real two-way
// 1:1 relationship from one-way automated/notification traffic.
function queryDirectionTally(dbPath, sinceAppleNanos) {
  const rows = runQuery(
    dbPath,
    `SELECT cmj.chat_id AS chatId, m.is_from_me AS isFromMe, COUNT(*) AS n
     FROM message m
     JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
     WHERE m.date > ${sinceAppleNanos}
     GROUP BY cmj.chat_id, m.is_from_me;`,
  )
  const byChat = new Map()
  for (const row of rows) {
    const entry = byChat.get(row.chatId) ?? { sent: 0, recv: 0 }
    if (Number(row.isFromMe) === 1) entry.sent += Number(row.n)
    else entry.recv += Number(row.n)
    byChat.set(row.chatId, entry)
  }
  return byChat
}

// New messages since the fetch floor, tagged with their chat + sender handle.
function queryMessages(dbPath, sinceAppleNanos, limit) {
  return runQuery(
    dbPath,
    `SELECT
       m.guid AS guid,
       m.text AS text,
       hex(m.attributedBody) AS attributedBodyHex,
       m.date AS date,
       m.is_from_me AS isFromMe,
       m.service AS service,
       sh.id AS senderHandle,
       cmj.chat_id AS chatId
     FROM message m
     JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
     LEFT JOIN handle sh ON sh.ROWID = m.handle_id
     WHERE m.date > ${sinceAppleNanos}
     ORDER BY m.date ASC
     LIMIT ${limit};`,
  )
}

// Decide which chats are worth forwarding, and how to tag their messages.
// Returns Map<chatId, { isGroup, counterpartHandle, displayName }>.
function decideIncludedChats(participants, directionTally, chatNames, allowlistSet) {
  const included = new Map()
  for (const [chatId, handles] of participants) {
    const count = handles.length
    const isGroup = count > 1
    const hasAllowlisted = handles.some((h) => allowlistSet.has(normalizeHandle(h)))

    let include = false
    if (hasAllowlisted) {
      // Allowlisted contact present — keep, whether 1:1 or group.
      include = true
    } else if (count === 1 && !isShortcode(handles[0])) {
      // Unknown 1:1: keep only if it's a real two-way exchange (not a one-way blast).
      const tally = directionTally.get(chatId) ?? { sent: 0, recv: 0 }
      include = tally.sent > 0 && tally.recv > 0
    }
    // Group with no allowlisted member, or a shortcode 1:1 -> dropped.

    if (include) {
      included.set(chatId, {
        isGroup,
        counterpartHandle: count === 1 ? handles[0] : null,
        displayName: chatNames.get(chatId) ?? null,
      })
    }
  }
  return included
}

// Build the message the server archives + extracts. For a 1:1, every message
// (both directions) is tagged with the counterpart handle so the thread stays
// joined; for a group, the actual sender's handle is kept.
function toMessage(row, chatInfo) {
  const text = (row.text && String(row.text).trim()) || decodeAttributedBody(row.attributedBodyHex) || ""
  const handle = chatInfo.isGroup ? (row.senderHandle ?? null) : chatInfo.counterpartHandle
  return {
    guid: row.guid,
    text,
    handle,
    senderName: null, // contact-name resolution from AddressBook is a future enhancement
    sentAt: appleDateToIso(row.date),
    isFromMe: row.isFromMe === 1 || row.isFromMe === "1",
    service: row.service ?? null,
    chatName: chatInfo.displayName,
    isGroup: chatInfo.isGroup,
    _appleDate: Number(row.date),
  }
}

// --- allowlist fetch ---------------------------------------------------------
async function fetchAllowlist(appUrl, secret) {
  const response = await fetch(`${appUrl.replace(/\/$/, "")}/api/integrations/imessage/filter-config`, {
    headers: { authorization: `Bearer ${secret}` },
  })
  if (response.status === 404) {
    fail("filter-config returned 404 — the feature is off, or this secret/operator id is wrong.")
  }
  if (!response.ok) {
    fail(`Could not fetch allowlist: HTTP ${response.status}`)
  }
  const payload = await response.json().catch(() => null)
  const entries = Array.isArray(payload?.allowlist) ? payload.allowlist : []
  return new Set(entries.map((entry) => entry?.handleNorm).filter(Boolean))
}

// --- cursor ------------------------------------------------------------------
function readCursor() {
  try {
    return JSON.parse(readFileSync(CURSOR_PATH, "utf8"))
  } catch {
    return null
  }
}

function writeCursor(maxAppleDate) {
  mkdirSync(join(HOME, ".jarvis"), { recursive: true })
  writeFileSync(CURSOR_PATH, JSON.stringify({ maxAppleDate, updatedAt: new Date().toISOString() }, null, 2))
}

// --- POST --------------------------------------------------------------------
async function postBatch(appUrl, secret, messages) {
  const response = await fetch(`${appUrl.replace(/\/$/, "")}/api/integrations/imessage/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
    body: JSON.stringify({ messages }),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = payload?.error ?? `HTTP ${response.status}`
    if (response.status === 404) {
      fail(`Ingest returned 404 — the feature is off. Set IMESSAGE_INGEST_SECRET and IMESSAGE_OPERATOR_USER_ID in the app env, and check this secret matches.`)
    }
    fail(`Ingest failed: ${detail}`)
  }
  return payload
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const secret = process.env.IMESSAGE_INGEST_SECRET?.trim()
  const appUrl = (process.env.JARVIS_APP_URL || "https://mydearestjarvis.vercel.app").trim()
  if (!args.dryRun && !secret) {
    fail("IMESSAGE_INGEST_SECRET is required (or pass --dry-run to preview without sending).")
  }

  // Filtering needs the allowlist. Without a secret (dry-run only) we can't fetch it,
  // so we fall back to an empty allowlist and only two-way unknowns would survive.
  let allowlistSet = new Set()
  if (secret) {
    allowlistSet = await fetchAllowlist(appUrl, secret)
  } else {
    console.log("! No secret — previewing with an EMPTY allowlist (only two-way unknown 1:1s would pass).")
  }

  const cursor = readCursor()
  const useCursor = !args.backfill && cursor?.maxAppleDate
  const sinceAppleNanos = useCursor
    ? cursor.maxAppleDate
    : isoToAppleNanos(new Date(Date.now() - args.sinceDays * 86_400_000).toISOString())
  const bidirectionalFloor = isoToAppleNanos(
    new Date(Date.now() - Math.max(BIDIRECTIONAL_WINDOW_DAYS, args.backfill ? args.sinceDays : 0) * 86_400_000).toISOString(),
  )

  const { dir, dest } = snapshotChatDb()
  let rows
  let participants
  let directionTally
  let chatNames
  try {
    participants = queryParticipants(dest)
    chatNames = queryChatNames(dest)
    directionTally = queryDirectionTally(dest, bidirectionalFloor)
    rows = queryMessages(dest, sinceAppleNanos, args.limit)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  if (rows.length === 0) {
    console.log("✓ No new messages since last run.")
    return
  }

  // Advance the cursor past every queried message (incl. filtered-out ones) so we
  // don't re-evaluate them next run.
  const maxAppleDate = rows.reduce((max, row) => Math.max(max, Number(row.date) || 0), sinceAppleNanos)

  const included = decideIncludedChats(participants, directionTally, chatNames, allowlistSet)
  const messages = rows
    .filter((row) => included.has(row.chatId))
    .map((row) => toMessage(row, included.get(row.chatId)))
    .filter((message) => message.guid && message.text)

  const droppedCount = rows.length - messages.length
  if (messages.length === 0) {
    console.log(`✓ ${rows.length} message(s) scanned, all filtered out (allowlist/shortcode/group). Cursor advanced.`)
    if (!args.dryRun) writeCursor(maxAppleDate)
    return
  }

  const payloadMessages = messages.map(({ _appleDate, ...rest }) => rest)

  if (args.dryRun) {
    console.log(`✓ Dry run: ${payloadMessages.length} of ${rows.length} message(s) would be sent (${droppedCount} filtered). Sample:`)
    console.log(JSON.stringify(payloadMessages.slice(0, 3), null, 2))
    return
  }

  let sent = 0
  let archived = 0
  for (let i = 0; i < payloadMessages.length; i += POST_BATCH_SIZE) {
    const batch = payloadMessages.slice(i, i + POST_BATCH_SIZE)
    const result = await postBatch(appUrl, secret, batch)
    sent += batch.length
    archived += result?.archived ?? 0
    console.log(`  …sent ${sent}/${payloadMessages.length} (archived: ${result?.archived ?? "?"}, candidates: ${result?.candidateCount ?? "?"})`)
  }

  writeCursor(maxAppleDate)
  console.log(`✓ Done. Sent ${sent} message(s) (${droppedCount} filtered, ${archived} newly archived); cursor advanced.`)
}

main().catch((error) => fail(error?.message ?? String(error)))
