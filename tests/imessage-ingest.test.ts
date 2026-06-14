import { describe, expect, it } from "vitest"

import {
  buildImessageSourceText,
  dedupeMessagesByGuid,
  formatMessageLine,
  type IncomingImessage,
} from "@/lib/imessage/ingest"

function makeMessage(overrides: Partial<IncomingImessage> & { guid: string }): IncomingImessage {
  return {
    text: "hello",
    handle: "+15555550123",
    senderName: null,
    sentAt: "2026-06-13T17:00:00.000Z",
    isFromMe: false,
    service: "iMessage",
    chatName: null,
    ...overrides,
  }
}

describe("dedupeMessagesByGuid", () => {
  it("collapses duplicate GUIDs, keeping the last occurrence", () => {
    const result = dedupeMessagesByGuid([
      makeMessage({ guid: "A", text: "first" }),
      makeMessage({ guid: "B", text: "second" }),
      makeMessage({ guid: "A", text: "updated" }),
    ])
    expect(result).toHaveLength(2)
    expect(result.find((m) => m.guid === "A")?.text).toBe("updated")
  })

  it("drops messages with empty/whitespace text or missing guid", () => {
    const result = dedupeMessagesByGuid([
      makeMessage({ guid: "A", text: "" }),
      makeMessage({ guid: "B", text: "   " }),
      makeMessage({ guid: "", text: "orphan" }),
      makeMessage({ guid: "C", text: "real" }),
    ])
    expect(result.map((m) => m.guid)).toEqual(["C"])
  })
})

describe("formatMessageLine", () => {
  it("labels the operator's own messages as 'Me'", () => {
    const line = formatMessageLine(makeMessage({ guid: "A", text: "I'll send it Friday", isFromMe: true }))
    expect(line).toBe("[2026-06-13T17:00:00.000Z] Me: I'll send it Friday")
  })

  it("prefers a resolved sender name, then handle, then Unknown", () => {
    expect(formatMessageLine(makeMessage({ guid: "A", text: "hi", senderName: "Mom" }))).toContain("Mom:")
    expect(formatMessageLine(makeMessage({ guid: "B", text: "hi", senderName: null }))).toContain("+15555550123:")
    expect(
      formatMessageLine(makeMessage({ guid: "C", text: "hi", senderName: null, handle: null })),
    ).toContain("Unknown:")
  })

  it("annotates the thread for group chats", () => {
    const line = formatMessageLine(makeMessage({ guid: "A", text: "dinner?", chatName: "Roommates" }))
    expect(line).toContain("(in Roommates)")
  })

  it("truncates very long messages", () => {
    const line = formatMessageLine(makeMessage({ guid: "A", text: "x".repeat(5000) }))
    // 1200-char cap + the prefix; nowhere near the original 5000.
    expect(line.length).toBeLessThan(1400)
  })
})

describe("buildImessageSourceText", () => {
  it("renders messages newest-last, one per line", () => {
    const text = buildImessageSourceText([
      makeMessage({ guid: "A", text: "earlier", sentAt: "2026-06-13T16:00:00.000Z" }),
      makeMessage({ guid: "B", text: "later", sentAt: "2026-06-13T17:00:00.000Z" }),
    ])
    const lines = text.split("\n")
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain("later")
  })

  it("caps the transcript to the newest 400 messages", () => {
    const many = Array.from({ length: 500 }, (_, i) =>
      makeMessage({ guid: `m${i}`, text: `msg ${i}` }),
    )
    const lines = buildImessageSourceText(many).split("\n")
    expect(lines).toHaveLength(400)
    // Keeps the tail (newest), drops the head.
    expect(lines[lines.length - 1]).toContain("msg 499")
    expect(lines[0]).toContain("msg 100")
  })
})
