import { describe, expect, it } from "vitest"

import { classifySecretaryIntent, parseReadMessages } from "../lib/assistant/orchestrator"

const baseInput = {
  now: "2026-05-14T12:00:00.000Z",
  timezone: "America/Chicago",
  history: [],
}

describe("secretary orchestrator", () => {
  it("keeps deterministic fast paths for create-task and remember commands", async () => {
    await expect(
      classifySecretaryIntent({
        ...baseInput,
        message: "Add task to finish the market sizing memo urgent",
      }),
    ).resolves.toMatchObject({
      kind: "create_task",
      title: "finish the market sizing memo urgent",
      priority: "high",
    })

    await expect(
      classifySecretaryIntent({
        ...baseInput,
        message: "Remember that I prefer readings before lunch",
      }),
    ).resolves.toMatchObject({
      kind: "remember",
      content: "I prefer readings before lunch",
    })
  })

  it("routes natural-language planning commands into the planner path", async () => {
    await expect(
      classifySecretaryIntent({
        ...baseInput,
        message: "Make today lighter and protect tonight",
      }),
    ).resolves.toMatchObject({
      kind: "plan_day",
      command: "Make today lighter and protect tonight",
    })
  })

  it("separates supported Google task sync from unsupported external writes", async () => {
    await expect(
      classifySecretaryIntent({
        ...baseInput,
        message: "Sync JARVIS task blocks to Google Calendar",
      }),
    ).resolves.toMatchObject({
      kind: "request_external_write",
      action: "google_task_event_sync",
    })

    await expect(
      classifySecretaryIntent({
        ...baseInput,
        message: "Send an email from Gmail to my professor",
      }),
    ).resolves.toMatchObject({
      kind: "request_external_write",
      action: "unsupported_external_write",
    })
  })

  it("routes explicit source refresh commands without asking the model", async () => {
    await expect(
      classifySecretaryIntent({
        ...baseInput,
        message: "Refresh sources from Gmail and Notion",
      }),
    ).resolves.toMatchObject({
      kind: "refresh_sources",
    })
  })

  it("routes iMessage read requests to the read_messages intent", async () => {
    await expect(
      classifySecretaryIntent({ ...baseInput, message: "What did Alan say about the deck?" }),
    ).resolves.toMatchObject({ kind: "read_messages", contactQuery: "Alan" })

    await expect(
      classifySecretaryIntent({ ...baseInput, message: "Can you read my messages with Dani?" }),
    ).resolves.toMatchObject({ kind: "read_messages", contactQuery: "Dani" })
  })
})

describe("parseReadMessages", () => {
  it("extracts the contact from common phrasings and strips trailing topics", () => {
    expect(parseReadMessages("what did Alan say about the trip")).toBe("Alan")
    expect(parseReadMessages("read my messages with Dani Liu")).toBe("Dani Liu")
    expect(parseReadMessages("texts from Mom")).toBe("Mom")
    expect(parseReadMessages("pull up my conversation with Ana")).toBe("Ana")
  })

  it("ignores requests that are not about reading a person's messages", () => {
    expect(parseReadMessages("what did I accomplish today")).toBeNull()
    expect(parseReadMessages("add task to text Alan")).toBeNull()
    expect(parseReadMessages("read me the news")).toBeNull()
  })
})
