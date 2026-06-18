import { describe, expect, it } from "vitest"

import { isSubsequence, searchTasks, type SearchableTask } from "@/lib/task-search"

function task(title: string, tags: string[] = [], description: string | null = null): SearchableTask {
  return { title, tags, description }
}

describe("isSubsequence", () => {
  it("matches characters in order, with gaps", () => {
    expect(isSubsequence("prsnt", "presentation")).toBe(true)
    expect(isSubsequence("wk6", "week 6 mlm")).toBe(true)
  })

  it("rejects out-of-order or absent characters", () => {
    expect(isSubsequence("ztp", "presentation")).toBe(false)
    expect(isSubsequence("", "anything")).toBe(false)
  })
})

describe("searchTasks", () => {
  it("returns nothing for an empty query", () => {
    expect(searchTasks([task("Anything")], "   ")).toHaveLength(0)
  })

  it("ranks a title hit above a tag/course hit", () => {
    const results = searchTasks(
      [
        task("Week 6 MLM Problems", ["MATH 240"]),
        task("Read the math chapter", []),
      ],
      "math",
    )
    expect(results.map((t) => t.title)).toEqual(["Read the math chapter", "Week 6 MLM Problems"])
  })

  it("surfaces MATH 240 coursework for the query 'math 220' via the 'math' term", () => {
    const results = searchTasks(
      [
        task("Week 6 MLM Problems", ["MATH 240"]),
        task("Buy groceries", ["errands"]),
      ],
      "math 220",
    )
    expect(results.map((t) => t.title)).toEqual(["Week 6 MLM Problems"])
  })

  it("matches the course stored as a tag", () => {
    const results = searchTasks([task("Problem set", ["ENTREP 225"])], "entrep")
    expect(results).toHaveLength(1)
  })

  it("falls back to fuzzy subsequence matching on the title", () => {
    const results = searchTasks([task("Mastering Your Pitch")], "mstr")
    expect(results).toHaveLength(1)
  })

  it("rewards covering more query terms", () => {
    const results = searchTasks(
      [
        task("Week 6 MLM Problems", ["MATH 240"]),
        task("MLM reading", []),
      ],
      "mlm math",
    )
    // The first matches both terms (title + course), the second only "mlm".
    expect(results[0].title).toBe("Week 6 MLM Problems")
  })

  it("does not let a 3-letter query subsequence-match unrelated prose (the MLM bug)", () => {
    const results = searchTasks(
      [
        task("Cancel or confirm 222 Dinner & Improv waitlist spot (text BAIL24 by 4:22pm)"),
        task("Actually wire up Jarvis into a production site with a real domain instead of vercel.app"),
        task("Week 6 MLM Problems", ["MATH 240"]),
      ],
      "MLM",
    )
    expect(results.map((t) => t.title)).toEqual(["Week 6 MLM Problems"])
  })

  it("matches the full word against an abbreviated/glued course token (the entrepreneurship bug)", () => {
    const fromTitle = searchTasks([task("Complete ENTREP225 assignments"), task("Buy groceries", ["errands"])], "entrepreneurship")
    expect(fromTitle.map((t) => t.title)).toEqual(["Complete ENTREP225 assignments"])

    const fromCourseTag = searchTasks(
      [task("Problem set 3", ["2026SP_IEMS_225-0_SEC01_AND_ENTREP_225-0_SEC1"])],
      "entrepreneurship",
    )
    expect(fromCourseTag).toHaveLength(1)
  })

  it("tokenizes course codes so a separator-glued code is searchable by part", () => {
    const results = searchTasks([task("Problem set", ["2026SP_IEMS_225-0_SEC01"])], "iems")
    expect(results).toHaveLength(1)
  })
})
