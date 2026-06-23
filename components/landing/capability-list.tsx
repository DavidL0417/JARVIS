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
 * The "what it actually does" list. Each capability is a native <details>
 * disclosure: the title + one-line detail stay visible; expanding reveals a
 * deeper description and, for some, a concrete example of the agentic planner
 * at work. Native <details> keeps it dependency-free, accessible, and
 * impossible to silently break — animation lives in globals.css (.cap-*).
 */
export function CapabilityList({ items }: { items: Capability[] }) {
  return (
    <ol className="mt-[clamp(32px,4vw,56px)] divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
      {items.map((cap) => (
        <li key={cap.number}>
          <details className="cap-details">
            <summary className="group flex w-full cursor-pointer items-start gap-[clamp(16px,4vw,48px)] py-[clamp(24px,3vw,36px)] text-left">
              <span
                className="landing-display num w-[clamp(36px,6vw,72px)] shrink-0 text-[clamp(1.8rem,3.2vw,2.6rem)] font-light leading-none text-[var(--copper)]"
                aria-hidden="true"
                style={{ letterSpacing: "-0.02em" }}
              >
                {cap.number}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-start justify-between gap-4">
                  <h3 className="max-w-[26ch] text-[clamp(1.1rem,1.7vw,1.4rem)] font-semibold leading-[1.25] text-foreground">
                    {cap.title}
                  </h3>
                  <span
                    aria-hidden="true"
                    className="cap-plus-icon mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--rule-strong)] text-muted-foreground group-hover:border-[var(--copper)] group-hover:text-[var(--copper)]"
                  >
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                      <path d="M5.5 1.4v8.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                      <path d="M1.4 5.5h8.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                  </span>
                </span>

                <span className="mt-2.5 block max-w-[60ch] text-[clamp(0.95rem,1.25vw,1.05rem)] leading-[1.6] text-foreground/70">
                  {cap.detail}
                </span>
              </span>
            </summary>

            <div className="cap-reveal pb-[clamp(24px,3vw,40px)] pl-[calc(clamp(36px,6vw,72px)+clamp(16px,4vw,48px))] pr-1">
              <p className="max-w-[64ch] text-[clamp(0.98rem,1.3vw,1.1rem)] leading-[1.65] text-foreground/80">
                {cap.body}
              </p>

              {cap.example ? (
                <div className="mt-6 max-w-[62ch] rounded-sm bg-[var(--panel)]/60 p-[clamp(16px,2.2vw,26px)]">
                  <p className="landing-mark text-[10.5px] text-[var(--copper)]">{cap.example.label}</p>
                  <div className="mt-3.5 space-y-3.5">
                    {cap.example.lines.map((line, i) => {
                      const isLast = i === cap.example!.lines.length - 1
                      return (
                        <p
                          key={i}
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
      ))}
    </ol>
  )
}
