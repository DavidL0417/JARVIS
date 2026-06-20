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

  it("does not divert a Gmail READ/search question to the external-write path", async () => {
    // "email" is a noun here; previously the external-write regex matched it and
    // hijacked the message into "unsupported external write" instead of letting the
    // agent loop search Gmail. Should fall through to a plain answer (the loop).
    await expect(
      classifySecretaryIntent({
        ...baseInput,
        message: "Search my Gmail for my most recent email",
      }),
    ).resolves.toMatchObject({ kind: "answer" })
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

    await expect(
      classifySecretaryIntent({
        ...baseInput,
        message: "Can you access my imessages? if so, list out a couple messages from Alan.",
      }),
    ).resolves.toMatchObject({ kind: "read_messages", contactQuery: "Alan" })
  })

  it("does not divert email/general questions to the iMessage read fast-path", async () => {
    // Was mis-routed to read_messages (contact "anyone"); should fall through to
    // the agentic answer path, which can search Gmail.
    await expect(
      classifySecretaryIntent({
        ...baseInput,
        message: "Check my email — did anyone send me anything about a deadline?",
      }),
    ).resolves.toMatchObject({ kind: "answer" })
  })
})

describe("parseReadMessages", () => {
  it("extracts the contact from common phrasings and strips trailing topics", () => {
    expect(parseReadMessages("what did Alan say about the trip")).toBe("Alan")
    expect(parseReadMessages("read my messages with Dani Liu")).toBe("Dani Liu")
    expect(parseReadMessages("texts from Mom")).toBe("Mom")
    expect(parseReadMessages("pull up my conversation with Ana")).toBe("Ana")
    // widened phrasings (access/list out/give me, mid-sentence "?", been saying, any new)
    expect(parseReadMessages("Can you access my imessages? if so, list out a couple messages from Alan.")).toBe("Alan")
    expect(parseReadMessages("give me a couple texts from Sarah")).toBe("Sarah")
    expect(parseReadMessages("access my messages from Alan")).toBe("Alan")
    expect(parseReadMessages("what's Alan been saying")).toBe("Alan")
    expect(parseReadMessages("any new texts from Sarah")).toBe("Sarah")
    // named-contact "did X verb" still resolves
    expect(parseReadMessages("did Alan text me")).toBe("Alan")
  })

  it("ignores requests that are not about reading a person's messages", () => {
    expect(parseReadMessages("what did I accomplish today")).toBeNull()
    expect(parseReadMessages("add task to text Alan")).toBeNull()
    expect(parseReadMessages("read me the news")).toBeNull()
    // send phrasings (no read verb / no with-from) must NOT be read-messages
    expect(parseReadMessages("message Alan about the deck")).toBeNull()
    expect(parseReadMessages("send a message to Alan")).toBeNull()
    expect(parseReadMessages("text Alan that I'm running late")).toBeNull()
  })

  it("does not capture indefinite pronouns or fire on email questions", () => {
    // indefinite-pronoun subjects are never a contact
    expect(parseReadMessages("did anyone send me anything about the deadline")).toBeNull()
    expect(parseReadMessages("did someone text me")).toBeNull()
    expect(parseReadMessages("what did anyone say in the meeting")).toBeNull()
    // plainly-email questions fall through (no iMessage/text signal)
    expect(parseReadMessages("Check my email — did anyone send me anything about a deadline?")).toBeNull()
    expect(parseReadMessages("did Alan email me about the project")).toBeNull()
    // real names that merely start with an excluded word are still captured
    expect(parseReadMessages("did Ian text me")).toBe("Ian")
  })
})
