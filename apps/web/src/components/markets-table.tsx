"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { RegimeBadge } from "@/components/regime-badge";
import { api, fmt, pct } from "@/lib/api";

export function MarketsTable() {
  const { data, isLoading, isError, error } = useQuery({ queryKey: ["markets"], queryFn: api.markets });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </div>
    );
  }
  if (isError || !data) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Markets could not be loaded</EmptyTitle>
          <EmptyDescription>{(error as Error)?.message ?? "The API did not answer."} Start the API with `pnpm api` and reload.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Stock</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead>Session</TableHead>
            <TableHead className="text-right">Lenders earn</TableHead>
            <TableHead className="text-right">Borrowers pay</TableHead>
            <TableHead className="text-right">Lent</TableHead>
            <TableHead className="text-right">Available</TableHead>
            <TableHead className="text-right">Used</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((m) => (
            <TableRow key={m.ticker} className="cursor-pointer">
              <TableCell className="font-medium">
                <Link href={`/market/${m.ticker}`} className="block">
                  {m.ticker}
                  <span className="ml-2 text-xs text-muted-foreground">x{fmt(m.multiplier, 4)}</span>
                </Link>
              </TableCell>
              <TableCell className="text-right tabular-nums">${fmt(m.price)}</TableCell>
              <TableCell>
                <RegimeBadge regime={m.regime} />
              </TableCell>
              <TableCell className="text-right tabular-nums">{pct(m.supplyRateApr)}</TableCell>
              <TableCell className="text-right tabular-nums">{pct(m.borrowRateApr)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(m.totalAssets, 3)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(m.idle, 3)}</TableCell>
              <TableCell className="text-right tabular-nums">{pct(m.utilisation, 0)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
