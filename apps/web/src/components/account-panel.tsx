"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useTx } from "@/hooks/use-tx";
import { api, fmt } from "@/lib/api";

export function AccountPanel() {
  const { address, isConnected } = useAccount();
  const { data, isLoading } = useQuery({ queryKey: ["account", address], queryFn: () => api.account(address!), enabled: !!address });
  const tx = useTx();

  if (!isConnected || !address) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No wallet connected</EmptyTitle>
          <EmptyDescription>Connect a wallet on BNB Chain to see your lending and borrowing positions.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  if (isLoading || !data) return <Skeleton className="h-48" />;

  const health = data.healthFactor ? Number(data.healthFactor) : null;
  const healthWord = health === null ? "No debt" : health >= 1.5 ? "Comfortable" : health >= 1.1 ? "Watch it" : health >= 1 ? "Close to liquidation" : "Liquidatable";

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="USDT collateral" value={`$${fmt(data.collateral)}`} note={Number(data.pendingFees) > 0 ? `${fmt(data.pendingFees, 4)} USDT of fees pending` : undefined} />
        <Stat label="Health factor" value={health === null ? "–" : fmt(health)} note={healthWord} />
        <Stat label="Short positions" value={String(data.positions.length)} note={data.positions.length ? `$${fmt(data.positions.reduce((s, p) => s + Number(p.valueUsd), 0))} of debt` : undefined} />
      </div>

      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle>Lending</CardTitle>
          <CardDescription>Shares in the pools, the effective stock they represent after dividends, and the USDT you can claim.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.lending.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing lent yet. <Link href="/" className="underline underline-offset-4">Pick a stock</Link> to start earning.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stock</TableHead>
                  <TableHead className="text-right">Lent (raw)</TableHead>
                  <TableHead className="text-right">Effective shares</TableHead>
                  <TableHead className="text-right">Claimable USDT</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.lending.map((l) => (
                  <TableRow key={l.ticker}>
                    <TableCell className="font-medium">
                      <Link href={`/market/${l.ticker}`}>{l.ticker}</Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(l.assets, 4)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(l.effectiveShares, 4)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(l.claimableUsdt, 4)}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" disabled={Number(l.claimableUsdt) === 0 || tx.isPending} onClick={() => tx.mutate({ action: "claim", params: { ticker: l.ticker } })}>
                        Claim
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle>Borrowing</CardTitle>
          <CardDescription>Raw units owed per stock, valued at the price the risk engine uses right now.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.positions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open borrows.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stock</TableHead>
                  <TableHead className="text-right">Owed</TableHead>
                  <TableHead className="text-right">Price used</TableHead>
                  <TableHead className="text-right">Debt value</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.positions.map((p) => (
                  <TableRow key={p.ticker}>
                    <TableCell className="font-medium">
                      <Link href={`/market/${p.ticker}`}>{p.ticker}</Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(p.debtRaw, 4)}</TableCell>
                    <TableCell className="text-right tabular-nums">${fmt(p.priceUsd)}</TableCell>
                    <TableCell className="text-right tabular-nums">${fmt(p.valueUsd)}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" disabled={tx.isPending} onClick={() => tx.mutate({ action: "cover", params: { ticker: p.ticker, amount: p.debtRaw } })}>
                        Cover all
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {Number(data.collateral) > 0 && data.positions.length === 0 && (
            <div className="mt-4">
              <Button variant="outline" disabled={tx.isPending} onClick={() => tx.mutate({ action: "withdraw-collateral", params: { amount: data.collateral } })}>
                Withdraw all collateral
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {note && <div className="text-xs text-muted-foreground">{note}</div>}
    </div>
  );
}
