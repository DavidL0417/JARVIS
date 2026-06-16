import { describe, expect, it } from "vitest"

import {
  classifyCanvasNodeKind,
  isAllowedCanvasUrl,
  isLikelyCanvasTabUrl,
  looksLikeActiveAssessment,
  looksLikeGatedCapture,
  looksLikeLoginUrl,
  normalizeUrl,
  unwrapProxyUrl,
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

  it("allows any localhost/127.0.0.1 dev port for pairing", () => {
    for (const port of ["3000", "3005", "3006", "5173", "8080"]) {
      expect(normalizeJarvisAppBaseUrl(`http://localhost:${port}/dashboard/canvas-extension`)).toBe(`http://localhost:${port}`)
    }

    expect(normalizeJarvisAppBaseUrl("http://127.0.0.1:3006/dashboard/canvas-extension")).toBe("http://127.0.0.1:3006")

    // Non-localhost http origins are still rejected.
    expect(() => normalizeJarvisAppBaseUrl("http://evil.example.com:3000/dashboard/canvas-extension")).toThrow()
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

  it("detects auth/SSO landing URLs, including Northwestern SSO", () => {
    expect(looksLikeLoginUrl("https://prd-nusso.it.northwestern.edu/nusso/XUI/?realm=northwestern")).toBe(true)
    expect(looksLikeLoginUrl("https://idp.example.edu/idp/profile/SAML2/Redirect/SSO")).toBe(true)
    expect(looksLikeLoginUrl("https://api.duosecurity.com/frame/web/v1/auth")).toBe(true)
    expect(looksLikeLoginUrl("https://www.proquest.com/docview/2679088860")).toBe(false)
  })

  it("flags a sign-in shell as a gated capture but lets a real article through", () => {
    // The actual Northwestern SSO shell that previously got stored as content.
    expect(looksLikeGatedCapture({
      target: "http://turing.library.northwestern.edu/login?url=https://www.proquest.com/docview/2679088860/se-2",
      destination: "https://www.proquest.com/docview/2679088860/se-2",
      finalUrl: "https://prd-nusso.it.northwestern.edu/nusso/XUI/?realm=northwestern",
      html: "<html><body><!--[if !IE]--> Loading... <a>Help with login problems</a></body></html>",
      readableTextLength: 40,
    })).toBe(true)

    expect(looksLikeGatedCapture({
      target: "https://www.jstor.org/stable/799511",
      destination: "https://www.jstor.org/stable/799511",
      finalUrl: "https://www.jstor.org/stable/799511",
      html: "<html><body><article><h1>Moral Passage</h1><p>" + "word ".repeat(400) + "</p></article></body></html>",
      readableTextLength: 2000,
    })).toBe(false)
  })

  it("detects an inline password field even without auth URL markers", () => {
    expect(looksLikeGatedCapture({
      target: "https://paywall.example.com/article",
      destination: "https://paywall.example.com/article",
      finalUrl: "https://paywall.example.com/article",
      html: '<form><input type="password" name="pw"></form>',
      readableTextLength: 12,
    })).toBe(true)
  })

  it("unwraps EZproxy links to the underlying reading", () => {
    expect(
      unwrapProxyUrl("http://turing.library.northwestern.edu/login?url=https://www.proquest.com/docview/2679088860/se-2?accountid=12861"),
    ).toBe("https://www.proquest.com/docview/2679088860/se-2?accountid=12861")
    // A plain reading link is returned unchanged.
    expect(unwrapProxyUrl("https://www.jstor.org/stable/799511")).toBe("https://www.jstor.org/stable/799511")
  })
})
