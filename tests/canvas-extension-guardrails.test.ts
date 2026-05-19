import { describe, expect, it } from "vitest"

import {
  classifyCanvasNodeKind,
  isAllowedCanvasUrl,
  isLikelyCanvasTabUrl,
  looksLikeActiveAssessment,
  normalizeUrl,
} from "../extensions/canvas-reader/src/guardrails.js"
import {
  appHostPermissionPattern,
  normalizeJarvisAppBaseUrl,
} from "../extensions/canvas-reader/src/jarvis-app-url.js"

describe("Canvas extension guardrails", () => {
  const origin = "https://canvas.example.edu"

  it("allows same-origin read-only Canvas course surfaces", () => {
    expect(isAllowedCanvasUrl(`${origin}/courses/42/assignments`, origin)).toBe(true)
    expect(isAllowedCanvasUrl(`${origin}/courses/42/modules`, origin)).toBe(true)
    expect(isAllowedCanvasUrl(`${origin}/calendar`, origin)).toBe(true)
  })

  it("blocks mutation and active assessment surfaces", () => {
    expect(isAllowedCanvasUrl(`${origin}/courses/42/quizzes/7/take`, origin)).toBe(false)
    expect(isAllowedCanvasUrl(`${origin}/courses/42/assignments/8/submit`, origin)).toBe(false)
    expect(isAllowedCanvasUrl(`${origin}/conversations`, origin)).toBe(false)
    expect(isAllowedCanvasUrl("https://evil.example.edu/courses/42", origin)).toBe(false)
  })

  it("normalizes URLs for crawl dedupe", () => {
    expect(normalizeUrl("/courses/42#rubric", `${origin}/dashboard`)).toBe(`${origin}/courses/42`)
  })

  it("detects active timed quiz language", () => {
    expect(looksLikeActiveAssessment({
      url: `${origin}/courses/42/quizzes/7`,
      title: "Quiz 2",
      text: "Time Limit 30 Minutes. Attempt 1. Start Quiz",
    })).toBe(true)
  })

  it("normalizes JARVIS setup page URLs to the app origin", () => {
    expect(normalizeJarvisAppBaseUrl("http://localhost:3001/dashboard/canvas-extension")).toBe("http://localhost:3001")
    expect(normalizeJarvisAppBaseUrl("https://mydearestjarvis.vercel.app/dashboard/canvas-extension")).toBe("https://mydearestjarvis.vercel.app")
  })

  it("allows localhost dev ports 3001-3005 for pairing", () => {
    for (const port of ["3001", "3002", "3003", "3004", "3005"]) {
      expect(normalizeJarvisAppBaseUrl(`http://localhost:${port}/dashboard/canvas-extension`)).toBe(`http://localhost:${port}`)
    }

    expect(() => normalizeJarvisAppBaseUrl("http://localhost:3006/dashboard/canvas-extension")).toThrow(/3001-3005/)
  })

  it("uses portless Chrome host permission patterns", () => {
    expect(appHostPermissionPattern("http://localhost:3001/dashboard/canvas-extension")).toBe("http://localhost/*")
    expect(appHostPermissionPattern("https://mydearestjarvis.vercel.app/dashboard/canvas-extension")).toBe("https://mydearestjarvis.vercel.app/*")
  })

  it("allows captured same-origin Canvas links", () => {
    expect(isAllowedCanvasUrl(`${origin}/courses/42/pages/week-1`, origin)).toBe(true)
    expect(isAllowedCanvasUrl(`${origin}/courses/42/files/9`, origin)).toBe(true)
  })

  it("classifies Canvas inventory node URLs without model calls", () => {
    expect(classifyCanvasNodeKind(`${origin}/courses/42`)).toBe("course")
    expect(classifyCanvasNodeKind(`${origin}/courses/42/modules`)).toBe("module")
    expect(classifyCanvasNodeKind(`${origin}/courses/42/files/9`)).toBe("file")
    expect(classifyCanvasNodeKind(`${origin}/courses/42/discussion_topics/3`)).toBe("discussion")
  })

  it("does not treat unrelated root tabs as Canvas tabs", () => {
    expect(isLikelyCanvasTabUrl("https://chatgpt.com/")).toBe(false)
    expect(isLikelyCanvasTabUrl("https://canvas.northwestern.edu/")).toBe(true)
    expect(isLikelyCanvasTabUrl("https://school.instructure.com/courses/42")).toBe(true)
  })
})
