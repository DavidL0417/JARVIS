/**
 * The JARVIS "J" letterform, tile-less and monochrome (inherits `currentColor`),
 * for inline use in the nav/footer lockup alongside the `Jarvis•` wordmark.
 * The copper dot lives on the wordmark, so the mark itself stays a clean glyph.
 * Geometry matches the favicon/app icon (see scripts/logo/build-icons.cjs).
 */
export function JarvisMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="41 33 94 116"
      fill="none"
      className={className}
      style={{ aspectRatio: "94 / 116" }}
      aria-hidden="true"
    >
      <path
        d="M77 45H120"
        stroke="currentColor"
        strokeWidth="16"
        strokeLinecap="round"
      />
      <path
        d="M106 45V106Q106 135 77 135Q53 135 53 115"
        stroke="currentColor"
        strokeWidth="16"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
