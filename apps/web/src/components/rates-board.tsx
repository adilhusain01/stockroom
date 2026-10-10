"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RegimeBadge } from "@/components/regime-badge";
import { api, fmt, pct } from "@/lib/api";

export function RatesBoard() {
  const { data, isLoading } = useQuery({ queryKey: ["markets"], queryFn: api.markets });
  if (isLoading || !data) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-36" />
        ))}
      </div>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {data.map((m) => (
        <Card key={m.ticker} className="rounded-xl">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <Link href={`/market/${m.ticker}`} className="hover:underline underline-offset-4">
                {m.ticker}
              </Link>
              <RegimeBadge regime={m.regime} />
            </CardTitle>
            <CardDescription>${fmt(m.price)} per token, {pct(m.utilisation, 0)} of the pool lent out</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-muted p-3">
              <div className="text-xs text-muted-foreground">Borrowers pay</div>
              <div className="text-xl font-semibold tabular-nums">{pct(m.borrowRateApr)}</div>
            </div>
            <div className="rounded-lg bg-muted p-3">
              <div className="text-xs text-muted-foreground">Lenders earn</div>
              <div className="text-xl font-semibold tabular-nums">{pct(m.supplyRateApr)}</div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
