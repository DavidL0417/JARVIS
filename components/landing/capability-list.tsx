type CapabilityExample = {
  label: string
  lines: string[]
}

export type Capability = {
  number: string
  title: string
  detail: string
  /** Deeper description revealed on expand. */
  body: string
  /** Optional worked example revealed on expand. */
  example?: CapabilityExample
}

/**
 * The "most days" capabilities. With only two, they sit side by side and fill
 * the section width (single column on mobile). Each is a native <details>
 * disclosure: number + title + one-line detail stay visible; expanding reveals
 * a deeper description and, for some, a concrete example. Columns are separated
 * by a hairline rule rather than card borders, so the example panel inside an
 * open toggle isn't a nested card.
 */
export function CapabilityList({ items }: { items: Capability[] }) {
  return (
    <ol className="mt-[clamp(32px,4vw,56px)] grid grid-cols-1 border-y border-[var(--rule)] md:grid-cols-2 md:divide-x md:divide-[var(--rule)]">
      {items.map((cap, i) => {
        const panelId = `cap-panel-${cap.number}`
        const isLeft = i % 2 === 0
        return (
          <li
            key={cap.number}
            className={[
              i < items.length - 1 ? "border-b border-[var(--rule)] md:border-b-0" : "",
              isLeft ? "md:pr-[clamp(28px,4vw,56px)]" : "md:pl-[clamp(28px,4vw,56px)]",
            ].join(" ")}
          >
            <details className="cap-details h-full">
              <summary className="group flex cursor-pointer flex-col gap-[clamp(10px,1.6vw,16px)] py-[clamp(26px,3.2vw,40px)]">
                <span className="flex items-center justify-between">
                  <span
                    className="landing-display num text-[clamp(1.8rem,3.2vw,2.6rem)] font-light leading-none text-[var(--copper)]"
                    aria-hidden="true"
                    style={{ letterSpacing: "-0.02em" }}
                  >
                    {cap.number}
                  </span>
                  <span
                    aria-hidden="true"
                    className="cap-plus-icon inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--rule-strong)] text-muted-foreground group-hover:border-[var(--copper)] group-hover:text-[var(--copper)]"
                  >
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                      <path d="M5.5 1.4v8.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                      <path d="M1.4 5.5h8.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                  </span>
                </span>

                <h3 className="mt-1 text-[clamp(1.15rem,1.7vw,1.45rem)] font-semibold leading-[1.2] text-foreground">
                  {cap.title}
                </h3>
                <p className="max-w-[46ch] text-[clamp(0.95rem,1.2vw,1.05rem)] leading-[1.6] text-foreground/70">
                  {cap.detail}
                </p>
              </summary>

              <div id={panelId} className="cap-reveal pb-[clamp(26px,3.2vw,40px)]">
                <p className="max-w-[58ch] text-[clamp(0.98rem,1.3vw,1.1rem)] leading-[1.65] text-foreground/80">
                  {cap.body}
                </p>

                {cap.example ? (
                  <div className="mt-6 rounded-sm bg-[var(--panel)]/60 p-[clamp(16px,2.2vw,26px)]">
                    <p className="landing-mark text-[10.5px] text-[var(--copper)]">{cap.example.label}</p>
                    <div className="mt-3.5 space-y-3.5">
                      {cap.example.lines.map((line, j) => {
                        const isLast = j === cap.example!.lines.length - 1
                        return (
                          <p
                            key={j}
                            className={
                              isLast
                                ? "text-[clamp(1.02rem,1.4vw,1.22rem)] font-medium leading-[1.5] text-foreground"
                                : "text-[clamp(0.95rem,1.2vw,1.05rem)] leading-[1.6] text-foreground/75"
                            }
                          >
                            {line}
                          </p>
                        )
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </details>
          </li>
        )
      })}
    </ol>
  )
}
