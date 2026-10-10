import { Badge } from "@/components/ui/badge";
import type { Regime } from "@/lib/api";

const copy: Record<Regime, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  Open: { label: "Open", variant: "default" },
  Closed: { label: "Closed", variant: "secondary" },
  Paused: { label: "Paused", variant: "destructive" },
  Degraded: { label: "Degraded", variant: "destructive" },
};

export function RegimeBadge({ regime }: { regime: Regime }) {
  const c = copy[regime];
  return <Badge variant={c.variant}>{c.label}</Badge>;
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
      return "The feed is stale or disagrees with the pool by more than 3 percent. No new borrows; repaying and withdrawing still work.";
  }
}
