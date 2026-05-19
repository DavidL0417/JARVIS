import { describe, expect, it } from "vitest"

import {
  canvasExtensionPairingExpiresAt,
  createCanvasExtensionPairingCode,
  createCanvasExtensionToken,
  hashCanvasExtensionSecret,
} from "@/lib/supabase/canvas-extension-tokens"

describe("Canvas extension token utilities", () => {
  it("creates pairing codes with the JARVIS Canvas prefix", () => {
    expect(createCanvasExtensionPairingCode()).toMatch(/^JCV-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
  })

  it("hashes secrets without preserving the raw value", () => {
    const hash = hashCanvasExtensionSecret("JCV-AAAA-BBBB")
    expect(hash).toHaveLength(64)
    expect(hash).not.toContain("JCV-AAAA-BBBB")
  })

  it("creates long extension tokens", () => {
    expect(createCanvasExtensionToken().length).toBeGreaterThanOrEqual(40)
  })

  it("sets pairing expiry ten minutes ahead", () => {
    const expiresAt = canvasExtensionPairingExpiresAt(new Date("2026-05-18T03:00:00.000Z"))
    expect(expiresAt).toBe("2026-05-18T03:10:00.000Z")
  })
})
