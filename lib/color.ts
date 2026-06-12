// Calendar colors arrive from several sources in different hex shapes. Apple/CalDAV
// returns 8-digit #RRGGBBAA, Google returns 6-digit #RRGGBB, manual calendars use
// 6-digit. Consumers that append an alpha pair (e.g. `${hex}45`) need a canonical
// #RRGGBB base, otherwise an 8-digit value becomes an invalid 10-digit color and the
// declaration is dropped. Collapse everything to #RRGGBB; return null when unparseable.
export function normalizeHexColor(input: string | null | undefined): string | null {
  if (!input) return null
  let hex = input.trim().replace(/^#/, "")
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null
  if (hex.length === 3) {
    hex = hex.split("").map((char) => char + char).join("")
  } else if (hex.length === 4) {
    hex = hex.slice(0, 3).split("").map((char) => char + char).join("")
  } else if (hex.length === 8) {
    hex = hex.slice(0, 6)
  }
  return hex.length === 6 ? `#${hex.toLowerCase()}` : null
}

// Apply an alpha byte (e.g. "45") to a hex color, normalizing the base first so the
// result is always a valid #RRGGBBAA value.
export function withAlpha(input: string | null | undefined, alphaByte: string): string | null {
  const base = normalizeHexColor(input)
  return base ? `${base}${alphaByte}` : null
}
