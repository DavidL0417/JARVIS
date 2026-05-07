const previewBlocks: Array<{ row: number; span: number; label: string; sub: string; tone: "deep" | "muted" | "copper" }> = [
  { row: 1, span: 2, label: "ENREP 225 reading", sub: "ch. 7–8", tone: "muted" },
  { row: 3, span: 3, label: "Cluster 2 lean canvas", sub: "due fri", tone: "copper" },
  { row: 6, span: 1, label: "lunch", sub: "30m", tone: "muted" },
  { row: 8, span: 2, label: "MGMT 360 group sync", sub: "video", tone: "deep" },
  { row: 11, span: 2, label: "Problem-set draft", sub: "1.5h focus", tone: "deep" },
]

const hours = ["08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20"]

export function DashboardPreview() {
  return (
    <div
      role="img"
      aria-label="A glance at the JARVIS dashboard: a single day's schedule, dense and quiet, with the next concrete task surfaced."
      className="relative w-full overflow-hidden rounded-sm"
      style={{
        boxShadow:
          "0 0 0 1px oklch(0.40 0.016 35), 0 0 0 6px oklch(0.135 0.012 35), 0 36px 80px -28px oklch(0 0 0 / 0.6), 0 8px 28px -10px oklch(0.74 0.14 42 / 0.18)",
      }}
    >
      <div
        className="dashboard-preview-grid"
        style={{
          background: "oklch(0.16 0.008 60)",
          color: "oklch(0.93 0.012 80)",
          minHeight: "320px",
          display: "grid",
        }}
      >
        <aside
          className="flex flex-col items-center gap-2 py-3"
          style={{ borderRight: "1px solid oklch(0.30 0.008 60)" }}
        >
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className="h-7 w-7 rounded-sm"
              style={{
                background:
                  index === 0
                    ? "oklch(0.66 0.10 40 / 0.18)"
                    : "oklch(0.27 0.012 60)",
              }}
            />
          ))}
        </aside>

        <section className="flex min-w-0 flex-col">
          <header
            className="flex items-center justify-between px-4 py-2.5"
            style={{ borderBottom: "1px solid oklch(0.40 0.008 60)" }}
          >
            <div className="flex items-center gap-3">
              <span className="text-[13px] font-semibold tracking-tight" style={{ color: "oklch(0.93 0.012 80)" }}>
                JARVIS
              </span>
              <span className="h-3 w-px" style={{ background: "oklch(0.40 0.008 60)" }} />
              <span
                className="text-[10px] font-medium uppercase tracking-[0.04em]"
                style={{ color: "oklch(0.62 0.010 70)" }}
              >
                Today · Tue 06
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: "oklch(0.66 0.10 40)" }}
              />
              <span className="text-[10.5px]" style={{ color: "oklch(0.62 0.010 70)" }}>
                Ready
              </span>
            </div>
          </header>

          <div className="grid flex-1 grid-cols-[40px_1fr] text-[10.5px]">
            <div
              className="flex flex-col"
              style={{
                color: "oklch(0.62 0.010 70)",
                borderRight: "1px solid oklch(0.30 0.008 60)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {hours.map((hour) => (
                <span
                  key={hour}
                  className="flex h-6 items-start justify-end pr-2 pt-1 leading-none"
                >
                  {hour}
                </span>
              ))}
            </div>

            <div
              className="relative grid"
              style={{
                gridTemplateRows: `repeat(${hours.length}, 24px)`,
              }}
            >
              {hours.map((_, index) => (
                <span
                  key={index}
                  className="block w-full"
                  style={{
                    borderTop: index === 0 ? "none" : "1px solid oklch(0.245 0.008 60)",
                  }}
                />
              ))}

              {previewBlocks.map((block, index) => {
                const tones: Record<typeof block.tone, { bg: string; ring: string; text: string; sub: string }> = {
                  deep: {
                    bg: "oklch(0.235 0.008 60)",
                    ring: "oklch(0.40 0.008 60)",
                    text: "oklch(0.93 0.012 80)",
                    sub: "oklch(0.62 0.010 70)",
                  },
                  muted: {
                    bg: "oklch(0.215 0.008 60)",
                    ring: "oklch(0.34 0.008 60)",
                    text: "oklch(0.88 0.010 70)",
                    sub: "oklch(0.55 0.010 70)",
                  },
                  copper: {
                    bg: "oklch(0.66 0.10 40 / 0.16)",
                    ring: "oklch(0.66 0.10 40 / 0.55)",
                    text: "oklch(0.86 0.06 50)",
                    sub: "oklch(0.70 0.08 50)",
                  },
                }
                const tone = tones[block.tone]
                return (
                  <div
                    key={index}
                    className="absolute left-2 right-3 flex items-center gap-2 px-2 py-1"
                    style={{
                      top: `${block.row * 24}px`,
                      height: `${block.span * 24 - 2}px`,
                      background: tone.bg,
                      border: `1px solid ${tone.ring}`,
                      borderRadius: 2,
                      color: tone.text,
                    }}
                  >
                    <span className="text-[10.5px] font-medium leading-tight tracking-tight">{block.label}</span>
                    <span className="ml-auto text-[9.5px]" style={{ color: tone.sub }}>
                      {block.sub}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        <aside
          className="dashboard-preview-rail flex flex-col"
          style={{ borderLeft: "1px solid oklch(0.30 0.008 60)" }}
        >
          <header
            className="px-3 py-2.5"
            style={{ borderBottom: "1px solid oklch(0.40 0.008 60)" }}
          >
            <span
              className="text-[10px] font-semibold uppercase tracking-[0.06em]"
              style={{ color: "oklch(0.62 0.010 70)" }}
            >
              Up next
            </span>
          </header>
          <ul className="flex flex-col">
            {[
              { title: "Cluster 2 lean canvas", meta: "due Fri · ENREP 225", live: true },
              { title: "Problem-set draft", meta: "tomorrow · MATH 240" },
              { title: "Reading: Crossing the Chasm", meta: "Sun · ENREP 225" },
              { title: "Re-read syllabus revision", meta: "next wk" },
            ].map((item, index) => (
              <li
                key={index}
                className="flex flex-col gap-0.5 px-3 py-2.5"
                style={{ borderBottom: "1px solid oklch(0.245 0.008 60)" }}
              >
                <div className="flex items-center gap-1.5">
                  {item.live ? (
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: "oklch(0.66 0.10 40)" }}
                    />
                  ) : (
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: "oklch(0.40 0.008 60)" }}
                    />
                  )}
                  <span className="text-[11px] font-medium leading-tight tracking-tight" style={{ color: "oklch(0.93 0.012 80)" }}>
                    {item.title}
                  </span>
                </div>
                <span className="pl-3 text-[10px]" style={{ color: "oklch(0.62 0.010 70)" }}>
                  {item.meta}
                </span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  )
}
