import { describe, expect, it } from "vitest"

import { canvasPlannerItemsToCandidates } from "@/lib/sources/canvas-refresh"

describe("Canvas planner mapping", () => {
  it("maps incomplete planner assignments to stable Canvas candidates", () => {
    const candidates = canvasPlannerItemsToCandidates(
      [
        {
          context_name: "ENTREP 225",
          course_id: 42,
          html_url: "https://canvas.example.edu/courses/42/assignments/7",
          plannable_id: 7,
          plannable_type: "assignment",
          planner_override: null,
          plannable: {
            title: "Customer interview memo",
            due_at: "2026-05-20T23:59:00-05:00",
          },
        },
      ],
      "https://canvas.example.edu",
    )

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      key: "assignment:7",
      kind: "deadline",
      title: "Customer interview memo",
      course: "ENTREP 225",
      payload: {
        canvas: {
          baseUrl: "https://canvas.example.edu",
          courseId: "42",
          plannableId: "7",
          plannableType: "assignment",
          plannableKey: "assignment:7",
        },
      },
    })
  })

  it("skips completed, unsupported, duplicate, and title-less planner items", () => {
    const candidates = canvasPlannerItemsToCandidates(
      [
        {
          plannable_id: 1,
          plannable_type: "assignment",
          planner_override: { marked_complete: true },
          plannable: { title: "Done already" },
        },
        {
          plannable_id: 2,
          plannable_type: "wiki_page",
          plannable: { title: "Read page" },
        },
        {
          plannable_id: 3,
          plannable_type: "quiz",
          plannable: { title: "Quiz 1" },
        },
        {
          plannable_id: 3,
          plannable_type: "quiz",
          plannable: { title: "Quiz 1 duplicate" },
        },
        {
          plannable_id: 4,
          plannable_type: "assignment",
          plannable: {},
        },
      ],
      "https://canvas.example.edu",
    )

    expect(candidates.map((candidate) => candidate.key)).toEqual(["quiz:3"])
  })
})
