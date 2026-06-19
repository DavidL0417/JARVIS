import { describe, expect, it } from "vitest"

import {
  buildRaycastContentText,
  buildRaycastDigest,
  dedupeNotesById,
  filterItems,
} from "@/lib/raycast/ingest"
import type { RaycastItemPayload, RaycastNotePayload } from "@/schemas/raycast"

function makeNote(overrides: Partial<RaycastNotePayload> & { id: string }): RaycastNotePayload {
  return {
    title: "For tonight:",
    markdown: "- [ ] do a thing",
    createdAt: "2026-06-10T00:00:00Z",
    modifiedAt: "2026-06-14T00:00:00Z",
    pinned: false,
    ...overrides,
  }
}

function makeItem(overrides: Partial<RaycastItemPayload> = {}): RaycastItemPayload {
  return {
    kind: "task",
    checked: false,
    text: "do a thing",
    noteTitle: "For tonight:",
    section: null,
    authored: "user",
    ...overrides,
  }
}

describe("dedupeNotesById", () => {
  it("collapses duplicate ids, keeping the last occurrence", () => {
    const result = dedupeNotesById([
      makeNote({ id: "A", markdown: "first" }),
      makeNote({ id: "B", markdown: "second" }),
      makeNote({ id: "A", markdown: "updated" }),
    ])
    expect(result).toHaveLength(2)
    expect(result.find((n) => n.id === "A")?.markdown).toBe("updated")
  })

  it("drops notes with no id and notes with neither title nor body", () => {
    const result = dedupeNotesById([
      makeNote({ id: "", markdown: "orphan" }),
      makeNote({ id: "B", title: "", markdown: "" }),
      makeNote({ id: "C", title: "real", markdown: "" }),
    ])
    expect(result.map((n) => n.id)).toEqual(["C"])
  })
})

describe("filterItems", () => {
  it("drops items with empty/whitespace text", () => {
    const result = filterItems([
      makeItem({ text: "keep me" }),
      makeItem({ text: "" }),
      makeItem({ text: "   " }),
    ])
    expect(result.map((i) => i.text)).toEqual(["keep me"])
  })
})

describe("buildRaycastDigest", () => {
  it("reports note and item counts in the header", () => {
    const digest = buildRaycastDigest(
      [makeNote({ id: "A" }), makeNote({ id: "B" })],
      [
        makeItem({ text: "open one" }),
        makeItem({ text: "open two" }),
        makeItem({ text: "finished", checked: true }),
        makeItem({ kind: "bullet", checked: null, text: "a thought" }),
      ],
    )
    expect(digest).toContain("2 Raycast notes mirrored")
    expect(digest).toContain("2 open scratchpad tasks")
    expect(digest).toContain("1 done")
    expect(digest).toContain("1 bullet")
  })

  it("treats a task with no checkbox state as open", () => {
    const digest = buildRaycastDigest([makeNote({ id: "A" })], [makeItem({ checked: null })])
    expect(digest).toContain("1 open scratchpad task")
  })

  it("names pinned notes and lists open tasks with their source note", () => {
    const digest = buildRaycastDigest(
      [makeNote({ id: "A", title: "For tonight:", pinned: true })],
      [makeItem({ text: "Declare polisci major", noteTitle: "For tonight:" })],
    )
    expect(digest).toContain("(pinned: For tonight:)")
    expect(digest).toContain("• Declare polisci major [For tonight:]")
  })

  it("caps the spelled-out open tasks and summarizes the overflow", () => {
    const items = Array.from({ length: 20 }, (_, i) => makeItem({ text: `task ${i}` }))
    const digest = buildRaycastDigest([makeNote({ id: "A" })], items)
    expect(digest).toContain("• task 0")
    expect(digest).toContain("• task 14")
    expect(digest).not.toContain("• task 15")
    expect(digest).toContain("(+5 more open tasks; full notes in snapshot payload.)")
  })

  it("handles the empty-notes case", () => {
    expect(buildRaycastDigest([], [])).toBe("Raycast intake received no active notes.")
  })

  it("excludes assistant-authored board lines from David's counts and notes them as context", () => {
    const digest = buildRaycastDigest(
      [makeNote({ id: "A" })],
      [
        makeItem({ text: "my real task" }),
        makeItem({ kind: "bullet", checked: null, text: "📝 Scheduler note", authored: "agent" }),
        makeItem({ kind: "bullet", checked: null, text: "✅ Scheduler ack", authored: "agent" }),
      ],
    )
    expect(digest).toContain("1 open scratchpad task")
    expect(digest).toContain("0 bullets") // the two agent bullets are not David's
    expect(digest).toContain("2 assistant lines on the board kept as context")
  })

  it("never lists an agent line among the top open tasks", () => {
    const digest = buildRaycastDigest(
      [makeNote({ id: "A" })],
      [
        makeItem({ text: "Declare polisci major" }),
        makeItem({ kind: "task", checked: false, text: "🛑 do this now", authored: "agent" }),
      ],
    )
    expect(digest).toContain("• Declare polisci major")
    expect(digest).not.toContain("do this now")
  })
})

describe("buildRaycastContentText", () => {
  it("is order-independent (sorted by id) so payload ordering never changes the hash", () => {
    const a = makeNote({ id: "A", markdown: "alpha" })
    const b = makeNote({ id: "B", markdown: "beta" })
    expect(buildRaycastContentText([a, b])).toBe(buildRaycastContentText([b, a]))
  })

  it("changes when a note body changes", () => {
    const before = buildRaycastContentText([makeNote({ id: "A", markdown: "v1" })])
    const after = buildRaycastContentText([makeNote({ id: "A", markdown: "v2" })])
    expect(before).not.toBe(after)
  })
})
