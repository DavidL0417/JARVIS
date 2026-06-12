import { describe, expect, it } from "vitest"

import { findDuplicateCommitment, overlapsSimilarBlock, titlesLookSimilar } from "@/lib/dedupe"

// The real-world cluster that motivated this module: six auto-approved candidates
// (4 Gmail + 2 Canvas) all describing the same June 4 piano jury.
const PIANO_TITLES = [
  "Piano Juries",
  "Non-Major Piano Juries",
  "Non-Major Piano Juries Sign-up and Performance",
  "Piano Jury Sign-up (Non-Major)",
  "Piano Jury Sign-up and Preparation",
]

describe("titlesLookSimilar", () => {
  it("matches the short jury title against every reworded variant", () => {
    for (const variant of PIANO_TITLES) {
      expect(titlesLookSimilar("Piano Juries", variant), `Piano Juries ~ ${variant}`).toBe(true)
    }
  })

  it("collapses the whole jury cluster when processed sequentially like the auto-approve gate", () => {
    // Pairwise similarity is not transitive, but the gate checks each candidate
    // against everything already accepted — so the cluster of six collapses to at
    // most two tasks instead of six.
    const accepted: Array<{ title: string; at: string | null }> = []
    for (const title of PIANO_TITLES) {
      const ref = { title, at: "2026-06-04T19:20:00.000Z" }
      if (!findDuplicateCommitment(ref, accepted)) {
        accepted.push(ref)
      }
    }
    expect(accepted.length).toBeGreaterThanOrEqual(1)
    expect(accepted.length).toBeLessThanOrEqual(2)
  })

  it("handles singular/plural stemming (jury vs juries)", () => {
    expect(titlesLookSimilar("Piano Jury", "Piano Juries")).toBe(true)
  })

  it("does not match unrelated titles", () => {
    expect(titlesLookSimilar("Piano Juries", "MATH 240 Final Review")).toBe(false)
    expect(titlesLookSimilar("Get boxes", "Room move out")).toBe(false)
  })

  it("documents the known fuzzy limit: cross-vocabulary titles need the LLM layer", () => {
    // Deterministic token matching cannot connect these; the calendar-aware
    // extraction prompt is responsible for this class of duplicate.
    expect(titlesLookSimilar("Final Exam", "[FINAL] MATH 240")).toBe(false)
    expect(titlesLookSimilar("Juries in #4-198, RCMA", "Piano Juries")).toBe(false)
  })
})

describe("findDuplicateCommitment", () => {
  const existing = [
    { title: "Non-Major Piano Juries Sign-up and Performance", at: "2026-06-04T19:20:00.000Z" },
    { title: "Weekly groceries", at: null },
  ]

  it("flags a reworded candidate at nearly the same time", () => {
    expect(
      findDuplicateCommitment({ title: "Piano Juries", at: "2026-06-04T19:15:00.000Z" }, existing),
    ).not.toBeNull()
  })

  it("allows the same title at a clearly different time (recurring events)", () => {
    expect(
      findDuplicateCommitment({ title: "Piano Juries", at: "2026-09-10T19:15:00.000Z" }, existing),
    ).toBeNull()
  })

  it("requires an exact token match when either side has no timestamp", () => {
    expect(findDuplicateCommitment({ title: "weekly groceries", at: null }, existing)).not.toBeNull()
    expect(findDuplicateCommitment({ title: "groceries", at: null }, existing)).toBeNull()
  })
})

describe("overlapsSimilarBlock", () => {
  const calendarEvents = [
    { title: "[FINAL] MATH 240", start: "2026-06-09T20:00:00.000Z", end: "2026-06-09T22:00:00.000Z" },
  ]

  it("blocks a similar-titled block written over an existing event", () => {
    expect(
      overlapsSimilarBlock(
        { title: "MATH 240 Final", start: "2026-06-09T20:00:00.000Z", end: "2026-06-09T21:00:00.000Z" },
        calendarEvents,
      ),
    ).toBe(true)
  })

  it("allows a dissimilar block at the same time (real conflicts are the planner's job)", () => {
    expect(
      overlapsSimilarBlock(
        { title: "Pack for flight", start: "2026-06-09T20:00:00.000Z", end: "2026-06-09T21:00:00.000Z" },
        calendarEvents,
      ),
    ).toBe(false)
  })

  it("allows a similar block at a non-overlapping time (working before a deadline)", () => {
    expect(
      overlapsSimilarBlock(
        { title: "MATH 240 Final", start: "2026-06-09T14:00:00.000Z", end: "2026-06-09T16:00:00.000Z" },
        calendarEvents,
      ),
    ).toBe(false)
  })
})
