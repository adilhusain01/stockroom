"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, fmt, shortAddress } from "@/lib/api";

/** The desk is the keeper wallet; its positions are public, so the page reads them like any other account. */
export function DeskStatus() {
  const deployment = useQuery({ queryKey: ["deployment"], queryFn: api.deployment, staleTime: Infinity });
  const keeper = deployment.data?.keeper;
  const account = useQuery({ queryKey: ["account", keeper], queryFn: () => api.account(keeper!), enabled: !!keeper });

  if (!keeper || !account.data) return <Skeleton className="h-32" />;
  const a = account.data;
  const open = a.positions.length > 0;
  return (
    <Card className="rounded-xl">
      <CardHeader>
        <CardTitle>{open ? "Desk is open" : "Desk is idle"}</CardTitle>
        <CardDescription>
          Operator {shortAddress(keeper)}. {open ? "Borrowed stock is out as liquidity." : "Waiting for the next Friday close."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-3">
        <Stat label="USDT collateral" value={`$${fmt(a.collateral)}`} />
        <Stat label="Borrowed" value={open ? a.positions.map((p) => `${fmt(p.debtRaw, 3)} ${p.ticker}`).join(", ") : "nothing"} />
        <Stat label="Health" value={a.healthFactor ? fmt(a.healthFactor) : "no debt"} />
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
