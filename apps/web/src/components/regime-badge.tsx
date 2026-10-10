import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { Regime } from "@/lib/api";

// The palette is ink, signal orange and one oxblood. A regime climbs through those: ink while prices are live,
// signal while the reference market is shut, red when the engine refuses new risk.
const TONES = {
  ink: "text-ink shadow-[inset_0_0_0_1.5px_var(--line)]",
  signal: "text-signal-deep shadow-[inset_0_0_0_1.5px_rgba(212,84,28,0.45)]",
  wash: "bg-signal-wash text-signal-deep shadow-[inset_0_0_0_1.5px_rgba(212,84,28,0.6)]",
  danger: "text-danger shadow-[inset_0_0_0_1.5px_var(--danger)]",
} as const;

export function RegimeBadgeLike({ tone, children }: { tone: keyof typeof TONES; children: ReactNode }) {
  return (
    <Badge variant="ghost" className={`h-6 w-fit px-2.5 font-sans text-xs font-bold tracking-[0.5px] uppercase hover:bg-transparent ${TONES[tone]}`}>
      {children}
    </Badge>
  );
}

const TONE_OF: Record<Regime, keyof typeof TONES> = { Open: "ink", Closed: "signal", Paused: "danger", Degraded: "danger" };

export function RegimeBadge({ regime }: { regime: Regime }) {
  return <RegimeBadgeLike tone={TONE_OF[regime]}>{regime}</RegimeBadgeLike>;
}

export function regimeExplainer(regime: Regime): string {
  switch (regime) {
    case "Open":
      return "US extended hours. The quote is the higher of the APRO feed and the PancakeSwap TWAP.";
    case "Closed":
      return "The reference market is shut. The quote also counts the last reference print and a gap premium that grows with every hour closed.";
    case "Paused":
      return "A dividend or split is pending, or the token is paused. No new borrows until it settles; repaying and withdrawing still work.";
    case "Degraded":
      return "The feed is stale or disagrees with the pool beyond the market's band. No new borrows; repaying and withdrawing still work.";
  }
}
