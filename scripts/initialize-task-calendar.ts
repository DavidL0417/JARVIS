import { ensureTaskCalendarForUser } from "@/lib/tasks-calendar"

async function main() {
  const userId = process.argv[2]

  if (!userId) {
    throw new Error("Usage: tsx scripts/initialize-task-calendar.ts <user-id>")
  }

  const calendar = await ensureTaskCalendarForUser(userId)
  console.log(
    JSON.stringify(
      {
        ok: true,
        calendarKey: calendar.calendarKey,
        googleCalendarId: calendar.googleCalendarId,
      },
      null,
      2,
    ),
  )
}

if (process.argv[1]?.endsWith("initialize-task-calendar.ts")) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Task Calendar initialization failed.")
    process.exitCode = 1
  })
}
