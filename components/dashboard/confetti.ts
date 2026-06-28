// A small, dependency-free confetti burst for task completion. It runs on raw
// DOM + the Web Animations API rather than React so the pieces keep animating
// even after the originating row unmounts (the list refreshes a beat later and
// the checkbox goes with it). Call fireConfetti() with viewport coordinates —
// usually the center of the checkbox the user just clicked.

// Brand-led palette: copper leads, with the signal accents for variety. These
// resolve against :root since the container is appended to <body>.
const COLORS = [
  "var(--copper)",
  "var(--copper-bright, var(--copper))",
  "var(--signal-teal)",
  "var(--signal-green)",
  "var(--signal-blue)",
]

const PIECE_COUNT = 16

export function fireConfetti(x: number, y: number) {
  if (typeof document === "undefined") return
  // Respect reduced-motion: the spinner still gives functional feedback; the
  // celebration is the part we drop.
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return

  const container = document.createElement("div")
  container.setAttribute("aria-hidden", "true")
  container.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:9999;pointer-events:none;`
  document.body.appendChild(container)

  const animations: Animation[] = []

  for (let i = 0; i < PIECE_COUNT; i++) {
    const piece = document.createElement("span")
    const width = 5 + Math.random() * 4
    const height = width * (0.4 + Math.random() * 0.7)
    piece.style.cssText =
      `position:absolute;left:0;top:0;width:${width}px;height:${height}px;` +
      `background:${COLORS[i % COLORS.length]};` +
      `border-radius:${Math.random() > 0.5 ? "1px" : "50%"};will-change:transform,opacity;`
    container.appendChild(piece)

    // Upward-biased radial spray, then gravity pulls the piece back down.
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1
    const speed = 45 + Math.random() * 85
    const peakX = Math.cos(angle) * speed
    const peakY = Math.sin(angle) * speed // negative → upward
    const endX = peakX * 1.4
    const endY = peakY + 90 + Math.random() * 120 // fall past the launch point
    const spin = (Math.random() - 0.5) * 720

    const animation = piece.animate(
      [
        { transform: "translate(-50%, -50%) rotate(0deg) scale(1)", opacity: 1 },
        {
          transform: `translate(calc(-50% + ${peakX}px), calc(-50% + ${peakY}px)) rotate(${spin * 0.5}deg) scale(1)`,
          opacity: 1,
          offset: 0.35,
        },
        {
          transform: `translate(calc(-50% + ${endX}px), calc(-50% + ${endY}px)) rotate(${spin}deg) scale(0.85)`,
          opacity: 0,
        },
      ],
      {
        duration: 700 + Math.random() * 450,
        easing: "cubic-bezier(0.2, 0.65, 0.3, 1)",
        fill: "forwards",
      },
    )
    animations.push(animation)
  }

  let removed = false
  const cleanup = () => {
    if (removed) return
    removed = true
    container.remove()
  }

  Promise.all(animations.map((a) => a.finished.catch(() => undefined))).then(cleanup)
  // Safety net in case a .finished promise never settles (tab backgrounded, etc.).
  window.setTimeout(cleanup, 2000)
}
