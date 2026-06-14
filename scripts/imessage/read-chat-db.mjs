#!/usr/bin/env node
// Operator-only iMessage reader — runs on the operator's Mac, NOT on the server.
//
// macOS stores every iMessage/SMS in ~/Library/Messages/chat.db (SQLite). This
// script snapshots that DB, decodes recent messages, and POSTs them to the hidden
// /api/integrations/imessage/ingest webhook. The server never sees chat.db; all
// macOS-specific work (attributedBody decode, Apple-epoch -> ISO) happens here.
//
// REQUIREMENTS
//   - The process running this (your terminal / node) needs Full Disk Access:
//     System Settings -> Privacy & Security -> Full Disk Access -> add Terminal.
//   - macOS `sqlite3` CLI (ships with macOS) and Node 18+ (global fetch).
//
// USAGE
//   IMESSAGE_INGEST_SECRET=... JARVIS_APP_URL=https://mydearestjarvis.vercel.app \
//     node scripts/imessage/read-chat-db.mjs [--since-days 7] [--limit 1000] [--dry-run]
//
// A cursor at ~/.jarvis/imessage-cursor.json tracks the last message processed so
// re-runs only send new messages. First run backfills --since-days (default 7).
// See docs/decisions/operator-only-imessage.md.

import { execFileSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

const HOME = homedir()
const CHAT_DB = join(HOME, "Library", "Messages", "chat.db")
const CURSOR_PATH = join(HOME, ".jarvis", "imessage-cursor.json")
const APPLE_EPOCH_OFFSET_SECONDS = 978_307_200 // 2001-01-01 -> 1970-01-01
const POST_BATCH_SIZE = 200

function parseArgs(argv) {
  const args = { sinceDays: 7, limit: 5000, dryRun: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--since-days") args.sinceDays = Number(argv[++i])
    else if (arg === "--limit") args.limit = Number(argv[++i])
    else if (arg === "--dry-run") args.dryRun = true
  }
  return args
}

function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
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

// --- chat.db snapshot + query ------------------------------------------------
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

function queryMessages(dbPath, sinceAppleNanos, limit) {
  const sql = `
    SELECT
      m.guid AS guid,
      m.text AS text,
      hex(m.attributedBody) AS attributedBodyHex,
      m.date AS date,
      m.is_from_me AS isFromMe,
      m.service AS service,
      h.id AS handle,
      c.display_name AS chatName
    FROM message m
    LEFT JOIN handle h ON m.handle_id = h.ROWID
    LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    LEFT JOIN chat c ON c.ROWID = cmj.chat_id
    WHERE m.date > ${sinceAppleNanos}
    ORDER BY m.date ASC
    LIMIT ${limit};
  `
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

function toMessage(row) {
  const text = (row.text && String(row.text).trim()) || decodeAttributedBody(row.attributedBodyHex) || ""
  return {
    guid: row.guid,
    text,
    handle: row.handle ?? null,
    senderName: null, // contact-name resolution from AddressBook is a future enhancement
    sentAt: appleDateToIso(row.date),
    isFromMe: row.isFromMe === 1 || row.isFromMe === "1",
    service: row.service ?? null,
    chatName: row.chatName ?? null,
    _appleDate: Number(row.date),
  }
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

  const cursor = readCursor()
  const sinceAppleNanos = cursor?.maxAppleDate
    ? cursor.maxAppleDate
    : isoToAppleNanos(new Date(Date.now() - args.sinceDays * 86_400_000).toISOString())

  const { dir, dest } = snapshotChatDb()
  let rows
  try {
    rows = queryMessages(dest, sinceAppleNanos, args.limit)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  const messages = rows.map(toMessage).filter((m) => m.guid && m.text)
  if (messages.length === 0) {
    console.log("✓ No new messages since last run.")
    return
  }

  const maxAppleDate = messages.reduce((max, m) => Math.max(max, m._appleDate || 0), sinceAppleNanos)
  const payloadMessages = messages.map(({ _appleDate, ...rest }) => rest)

  if (args.dryRun) {
    console.log(`✓ Dry run: ${payloadMessages.length} message(s) would be sent. Sample:`)
    console.log(JSON.stringify(payloadMessages.slice(0, 3), null, 2))
    return
  }

  let sent = 0
  for (let i = 0; i < payloadMessages.length; i += POST_BATCH_SIZE) {
    const batch = payloadMessages.slice(i, i + POST_BATCH_SIZE)
    const result = await postBatch(appUrl, secret, batch)
    sent += batch.length
    console.log(`  …sent ${sent}/${payloadMessages.length} (candidates: ${result?.candidateCount ?? "?"})`)
  }

  writeCursor(maxAppleDate)
  console.log(`✓ Done. Sent ${sent} message(s); cursor advanced.`)
}

main().catch((error) => fail(error?.message ?? String(error)))
