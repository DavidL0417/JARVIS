import { describe, expect, it } from "vitest"

import { parseCalDavTodosFromIcs, toCalDavTaskInsert } from "@/lib/caldav/todos"
import { TASKS_CALENDAR_ID } from "@/lib/task-calendar-constants"

function wrap(...vtodos: string[]) {
  return `BEGIN:VCALENDAR\nVERSION:2.0\n${vtodos.join("\n")}\nEND:VCALENDAR`
}

describe("CalDAV reminder (VTODO) parsing", () => {
  it("maps timed, all-day, and undated open reminders", () => {
    const todos = parseCalDavTodosFromIcs({
      calendarData: wrap(
        `BEGIN:VTODO
UID:timed-1
SUMMARY:Email the TA
DUE:20260613T140000Z
PRIORITY:1
DESCRIPTION:About the deadline
END:VTODO`,
        `BEGIN:VTODO
UID:all-day-1
SUMMARY:Submit memo
DUE;VALUE=DATE:20260615
PRIORITY:5
END:VTODO`,
        `BEGIN:VTODO
UID:someday-1
SUMMARY:Read that book
END:VTODO`,
      ),
    })

    expect(todos).toHaveLength(3)
    expect(todos[0]).toMatchObject({
      uid: "timed-1",
      title: "Email the TA",
      deadline: "2026-06-13T14:00:00.000Z",
      allDay: false,
      priority: "high",
      description: "About the deadline",
    })
    expect(todos[1]).toMatchObject({
      uid: "all-day-1",
      title: "Submit memo",
      deadline: "2026-06-15T00:00:00.000Z",
      allDay: true,
      priority: "medium",
    })
    expect(todos[2]).toMatchObject({
      uid: "someday-1",
      title: "Read that book",
      deadline: null,
      allDay: false,
      priority: "medium",
      description: null,
    })
  })

  it("skips completed, cancelled, and UID-less reminders (one-way ingest)", () => {
    const todos = parseCalDavTodosFromIcs({
      calendarData: wrap(
        `BEGIN:VTODO
UID:done-status
SUMMARY:Done via status
STATUS:COMPLETED
END:VTODO`,
        `BEGIN:VTODO
UID:done-stamp
SUMMARY:Done via completed stamp
COMPLETED:20260610T120000Z
END:VTODO`,
        `BEGIN:VTODO
UID:cancelled-1
SUMMARY:Cancelled
STATUS:CANCELLED
END:VTODO`,
        `BEGIN:VTODO
SUMMARY:No UID — cannot dedupe
END:VTODO`,
      ),
    })

    expect(todos).toHaveLength(0)
  })

  it("anchors all-day due dates to local midnight when a timezone is supplied", () => {
    const [todo] = parseCalDavTodosFromIcs({
      timeZone: "America/Chicago",
      calendarData: wrap(
        `BEGIN:VTODO
UID:tz-1
SUMMARY:Pay rent
DUE;VALUE=DATE:20260615
END:VTODO`,
      ),
    })

    // 2026-06-15 00:00 in America/Chicago (CDT, -05:00) == 05:00 UTC.
    expect(todo.deadline).toBe("2026-06-15T05:00:00.000Z")
    expect(todo.allDay).toBe(true)
  })

  it("maps low and undefined iCal priorities", () => {
    const todos = parseCalDavTodosFromIcs({
      calendarData: wrap(
        `BEGIN:VTODO
UID:low-1
SUMMARY:Low
PRIORITY:9
END:VTODO`,
        `BEGIN:VTODO
UID:none-1
SUMMARY:None
PRIORITY:0
END:VTODO`,
      ),
    })

    expect(todos.find((t) => t.uid === "low-1")?.priority).toBe("low")
    expect(todos.find((t) => t.uid === "none-1")?.priority).toBe("medium")
  })

  it("builds an immutable, task-calendar insert from a parsed reminder", () => {
    const [todo] = parseCalDavTodosFromIcs({
      calendarData: wrap(
        `BEGIN:VTODO
UID:insert-1
SUMMARY:Buy groceries
DUE:20260614T180000Z
END:VTODO`,
      ),
    })

    const insert = toCalDavTaskInsert({
      parsedTodo: todo,
      userId: "user-1",
      externalTaskId: "caldav-todo:list:object:uid",
    })

    expect(insert).toMatchObject({
      user_id: "user-1",
      title: "Buy groceries",
      deadline: "2026-06-14T18:00:00.000Z",
      status: "todo",
      is_immutable: true,
      calendar_id: TASKS_CALENDAR_ID,
      external_task_id: "caldav-todo:list:object:uid",
      last_synced_from: "caldav",
      tags: ["apple-reminders"],
    })
  })
})
