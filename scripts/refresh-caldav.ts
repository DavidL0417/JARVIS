/**
 * One-off operational trigger: refresh a user's CalDAV (Apple Calendar) mirror now,
 * outside the daily cron. Useful when the cron hasn't run and the mirror has gone
 * stale, or to validate CalDAV sync changes end-to-end against the real account.
 *
 * Usage:
 *   npx tsx scripts/refresh-caldav.ts <user-id>
 *
 * Scoped to CalDAV only — it does NOT touch Gmail/Notion/Canvas or the planner.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

function loadEnv(path: string) {
  let content: string
  try {
    content = readFileSync(path, "utf8")
  } catch {
    return
  }
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}

async function main() {
  loadEnv(resolve(process.cwd(), ".env.local"))

  const userId = process.argv[2]
  if (!userId) {
    throw new Error("Usage: tsx scripts/refresh-caldav.ts <user-id>")
  }

  // Import after env is loaded so the admin Supabase client picks up credentials.
  const { refreshCalDavForUser } = await import("@/lib/caldav/refresh")
  const result = await refreshCalDavForUser(userId)

  console.log(
    JSON.stringify(
      {
        success: result.success,
        connected: result.connected,
        needsAuthorization: result.needsAuthorization,
        error: result.error ?? null,
        eventCount: result.events.length,
        reminderCount: result.reminderCount ?? 0,
        calendarCount: result.calendars.length,
        calendars: result.calendars.map((calendar) => ({
          name: calendar.name,
          calendarKey: calendar.calendarKey,
          color: calendar.color,
        })),
      },
      null,
      2,
    ),
  )
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
