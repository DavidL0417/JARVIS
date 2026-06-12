/**
 * One-time importer: distill the offline Codex Scheduler memory files into the
 * app's `memory_items` table so the planner inherits David's hard-won rules,
 * planning profile, preferences, and known deadlines.
 *
 * Usage:
 *   npx tsx scripts/seed-codex-memory.ts <user-id>            # dry-run (prints proposed rows)
 *   npx tsx scripts/seed-codex-memory.ts <user-id> --commit   # actually inserts
 *
 * Idempotent: rows are tagged source_label="codex_seed" and de-duplicated by a
 * content hash, so re-running only inserts genuinely new entries. Run once; this
 * is not a sync — there is no ongoing link to the Codex folder afterward.
 */
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

import { getClaudeClient, getClaudePlannerConfig } from "@/lib/ai/claude"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import type { MemoryImportance, MemoryKind, MemoryLayer } from "@/types"

const CODEX_MEMORY_DIR = "/Users/david/Desktop/Academia/Codex - Scheduler/memory"

interface SeedFile {
  file: string
  layer: MemoryLayer
}

const SEED_FILES: SeedFile[] = [
  { file: "secretary-operating-rules.md", layer: "operating_rules" },
  { file: "planning-profile.md", layer: "planning_profile" },
  { file: "productivity-preferences.md", layer: "durable_preferences" },
  { file: "user-preferences.md", layer: "durable_preferences" },
  { file: "current-known-deadlines.md", layer: "deadline_context" },
]

interface DistilledEntry {
  content: string
  importance: MemoryImportance
  kind: MemoryKind
  expiresAt: string | null
}

const DISTILL_INSTRUCTIONS = [
  "You are distilling a personal secretary's memory file into clean, atomic memory entries for a scheduling assistant.",
  "Each entry is ONE durable fact, rule, or preference, stated in a single concise sentence.",
  "Drop ephemeral or session-specific noise (today's status, one-off logs). Keep durable judgment, preferences, constraints, and known deadlines.",
  "Set importance by how load-bearing the entry is: critical = a hard correction or fact that breaks plans if ignored; high = a strong rule/preference; medium = useful context; low = minor.",
  "Set kind to one of: rule, preference, observation.",
  "For a dated deadline, set expiresAt to an ISO date shortly after the date passes; otherwise expiresAt is null.",
  "Return ONLY a JSON array of objects {content, importance, kind, expiresAt}. No prose.",
].join("\n")

function contentHash(content: string): string {
  return createHash("sha256").update(content.trim().toLowerCase()).digest("hex")
}

function parseEntries(text: string): DistilledEntry[] {
  const start = text.indexOf("[")
  const end = text.lastIndexOf("]")
  if (start === -1 || end === -1) {
    throw new Error(`Distiller did not return a JSON array:\n${text.slice(0, 200)}`)
  }
  const parsed = JSON.parse(text.slice(start, end + 1)) as DistilledEntry[]
  return parsed.filter((entry) => entry && typeof entry.content === "string" && entry.content.trim().length > 0)
}

async function distillFile(markdown: string, layer: MemoryLayer): Promise<DistilledEntry[]> {
  const client = getClaudeClient()
  const { model } = getClaudePlannerConfig()
  const message = await client.messages.create({
    model,
    max_tokens: 2000,
    temperature: 0,
    system: DISTILL_INSTRUCTIONS,
    messages: [
      {
        role: "user",
        content: `Memory layer: ${layer}\n\nFile content:\n${markdown}`,
      },
    ],
  })
  const text = message.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
  return parseEntries(text)
}

async function main() {
  const userId = process.argv[2]
  const commit = process.argv.includes("--commit")

  if (!userId) {
    throw new Error("Usage: tsx scripts/seed-codex-memory.ts <user-id> [--commit]")
  }

  const adminClient = createSupabaseAdminClient()

  // Load existing codex_seed hashes so re-runs are idempotent.
  const { data: existingRows, error: existingError } = await adminClient
    .from("memory_items")
    .select("payload")
    .eq("user_id", userId)
    .eq("source_label", "codex_seed")
    .limit(2000)
  if (existingError) {
    throw new Error(existingError.message)
  }
  const existingHashes = new Set(
    (existingRows ?? [])
      .map((row) => (row.payload as { contentHash?: string } | null)?.contentHash)
      .filter((hash): hash is string => typeof hash === "string"),
  )

  const proposed: Array<Record<string, unknown>> = []

  for (const seed of SEED_FILES) {
    const path = `${CODEX_MEMORY_DIR}/${seed.file}`
    let markdown: string
    try {
      markdown = readFileSync(path, "utf8")
    } catch {
      console.warn(`Skipping missing file: ${path}`)
      continue
    }

    const entries = await distillFile(markdown, seed.layer)
    for (const entry of entries) {
      const hash = contentHash(entry.content)
      if (existingHashes.has(hash)) {
        continue
      }
      existingHashes.add(hash)
      proposed.push({
        user_id: userId,
        kind: entry.kind,
        layer: seed.layer,
        category: seed.layer,
        content: entry.content.trim(),
        importance: entry.importance,
        importance_note: null,
        confidence: null,
        source_label: "codex_seed",
        source_ref: seed.file,
        payload: { contentHash: hash, sourceFile: seed.file },
        status: "active",
        expires_at: entry.expiresAt ?? null,
      })
    }
  }

  console.log(`\nDistilled ${proposed.length} new memory entr${proposed.length === 1 ? "y" : "ies"}:\n`)
  for (const row of proposed) {
    console.log(`- [${row.layer} · ${row.importance}] ${row.content}`)
  }

  if (!commit) {
    console.log(`\nDry run — nothing inserted. Re-run with --commit to insert these ${proposed.length} rows.`)
    return
  }

  if (proposed.length === 0) {
    console.log("\nNothing new to insert.")
    return
  }

  const { error: insertError } = await adminClient.from("memory_items").insert(proposed)
  if (insertError) {
    throw new Error(insertError.message)
  }
  console.log(`\nInserted ${proposed.length} memory entries for ${userId}.`)
}

if (process.argv[1]?.endsWith("seed-codex-memory.ts")) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Codex memory seed failed.")
    process.exitCode = 1
  })
}
