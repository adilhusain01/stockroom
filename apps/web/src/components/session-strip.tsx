"use client";

import { useQuery } from "@tanstack/react-query";
import { api, duration, pct } from "@/lib/api";

/**
 * The one thing Stockroom shows before anything else: bStocks trade around the clock, Wall Street does not, and
 * the gap between the two is what every borrow is margined for.
 */
export function SessionStrip() {
  const { data, isError } = useQuery({ queryKey: ["session"], queryFn: api.session, refetchInterval: 30_000 });
  if (isError) {
    return (
      <div className="border-b border-border bg-muted px-4 py-2 text-sm text-muted-foreground">
        The Stockroom API is not answering. Markets below may be stale.
      </div>
    );
  }
  if (!data) return <div className="h-11 border-b border-border bg-accent-strong/20" aria-hidden />;
  const toOpen = data.nextOpen - data.now;
  return (
    <div className="border-b border-border bg-accent-strong text-accent-strong-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-baseline gap-x-6 gap-y-1 px-4 py-2 text-sm">
        {data.isOpen ? (
          <>
            <span className="font-semibold">Wall Street is open.</span>
            <span>Prices are live, borrowing at the base margin.</span>
          </>
        ) : (
          <>
            <span className="font-semibold">Wall Street has been closed for {duration(data.closedForSec)}.</span>
            <span>Reopens in {duration(toOpen)}.</span>
            <span>Short debt carries a {pct(data.gapPremium, 1)} gap premium until then.</span>
          </>
        )}
        <span className="ml-auto tabular-nums opacity-80">bStocks keep trading 24/7</span>
      </div>
    </div>
  );
}
