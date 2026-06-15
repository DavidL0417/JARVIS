// Handle normalization + shortcode detection, ported from the Scheduler's
// messages_snapshot.py so the iMessage allowlist matches the same way in both
// projects. Kept dependency-free so the standalone reader script can mirror it.

// Canonical match key for a handle. Phones -> last 10 digits (drops +1 and all
// formatting, so '+1 (555) 202-4226', '5552024226', '15552024226' collapse to
// '5552024226'). Emails -> lowercased. Empty in, empty out.
export function normalizeHandle(handle: string | null | undefined): string {
  if (!handle) {
    return ""
  }
  const trimmed = handle.trim()
  if (!trimmed) {
    return ""
  }
  if (trimmed.includes("@")) {
    return trimmed.toLowerCase()
  }
  const digits = trimmed.replace(/\D/g, "")
  return digits.length >= 10 ? digits.slice(-10) : digits
}

// True for automated SMS senders — banks, 2FA, delivery, payment confirmations —
// which use short numeric shortcodes and are never a real person. Real phones
// normalize to >= 10 digits; emails are never shortcodes.
export function isShortcode(handle: string | null | undefined): boolean {
  if (!handle) {
    return false
  }
  const trimmed = handle.trim()
  if (trimmed.includes("@")) {
    return false
  }
  const digits = trimmed.replace(/\D/g, "")
  return digits.length < 7
}
