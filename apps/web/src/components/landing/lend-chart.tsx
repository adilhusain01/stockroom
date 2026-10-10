// The whole idea in one picture: the stock goes out on Friday, the market shuts, the fee keeps ticking, the
// stock comes back before Monday's open. The prices are invented to show the shape.

const HELD = "M20,170 L70,166 L120,172 L170,164 L220,168 L280,166 L330,167 L380,165 L430,168 L480,166 L530,167 L580,165 L630,168 L680,166 L720,167 L770,166 L820,168 L870,165 L920,167 L980,166";
const LENT = "M280,166 L330,163 L380,159 L430,156 L480,152 L530,149 L580,145 L630,142 L680,138 L720,135 L770,134 L820,133 L870,132 L920,131 L980,130";

export function LendChart() {
  return (
    <figure className="m-0">
      {/* A phone gets a tighter crop of the same drawing, so the lines stay readable. */}
      <Drawing id="wide" viewBox="0 0 1000 350" className="hidden overflow-visible sm:block" />
      <Drawing id="narrow" viewBox="205 60 700 262" className="overflow-hidden rounded-lg sm:hidden" strokeScale={1.7} />
      <figcaption className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-ink-soft">
        <span className="flex items-center gap-2">
          <span className="h-1 w-6 rounded-full bg-signal" aria-hidden />
          Stock lent on Stockroom
        </span>
        <span className="flex items-center gap-2">
          <span className="h-[3px] w-6 rounded-full bg-ink" aria-hidden />
          Stock sitting in a wallet
        </span>
        <span className="text-ink-faint sm:ml-auto">An illustration. These are not real numbers.</span>
      </figcaption>
    </figure>
  );
}

function Drawing({ id, viewBox, className, strokeScale = 1 }: { id: string; viewBox: string; className: string; strokeScale?: number }) {
  return (
    <svg viewBox={viewBox} role="img" aria-labelledby={`lend-title-${id} lend-desc-${id}`} className={`h-auto w-full ${className}`}>
      <title id={`lend-title-${id}`}>A stock holding across a weekend, held and lent</title>
      <desc id={`lend-desc-${id}`}>
        A holding kept in a wallet stays flat all weekend. The same holding lent on Stockroom goes out at the Friday close, collects a borrow fee every second the market is shut, and comes back before the Monday open with the fee on top.
      </desc>

      <rect x="280" y="24" width="440" height="286" rx="10" className="fill-paper-3" opacity="0.55" />
      <line x1="20" y1="310" x2="980" y2="310" className="stroke-line" strokeWidth="1.5" />
      <line x1="280" y1="24" x2="280" y2="318" className="stroke-ink-faint" strokeWidth="1" strokeDasharray="3 5" />
      <line x1="720" y1="24" x2="720" y2="318" className="stroke-ink-faint" strokeWidth="1" strokeDasharray="3 5" />

      <path d={HELD} pathLength={1} strokeDasharray="1" fill="none" className="animate-draw stroke-ink" strokeWidth={2.5 * strokeScale} strokeLinejoin="round" strokeLinecap="round" style={{ animationDelay: "250ms" }} />
      <path d={LENT} pathLength={1} strokeDasharray="1" fill="none" className="animate-draw stroke-signal" strokeWidth={4 * strokeScale} strokeLinejoin="round" strokeLinecap="round" style={{ animationDelay: "900ms" }} />

      <circle cx="280" cy="166" r="6.5" className="fill-ink" />
      <circle cx="720" cy="135" r="6.5" className="fill-signal stroke-paper" strokeWidth="2.5" />

      {/* The distance between the two outcomes */}
      <g className="animate-rise" style={{ animationDelay: "2100ms" }}>
        <line x1="880" y1="132" x2="880" y2="166" className="stroke-ink" strokeWidth="1.5" />
        <line x1="872" y1="132" x2="888" y2="132" className="stroke-ink" strokeWidth="1.5" />
        <line x1="872" y1="166" x2="888" y2="166" className="stroke-ink" strokeWidth="1.5" />
      </g>

      <g className="hidden fill-ink-soft font-sans text-[15px] sm:block">
        <text x="500" y="52" textAnchor="middle" className="fill-ink-faint">
          Wall Street closed
        </text>
        <text x="280" y="338" textAnchor="middle">
          Friday close
        </text>
        <text x="720" y="338" textAnchor="middle">
          Monday open
        </text>
        <text x="268" y="146" textAnchor="end" className="fill-ink font-bold">
          Stock goes out
        </text>
        <text x="732" y="118" className="fill-signal-deep font-bold">
          Stock comes back
        </text>
        <text x="880" y="196" textAnchor="middle" className="fill-ink font-bold">
          The fee you collected
        </text>
      </g>
    </svg>
  );
}
