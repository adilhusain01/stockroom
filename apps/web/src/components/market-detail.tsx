"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RegimeBadge, regimeExplainer } from "@/components/regime-badge";
import { useTx } from "@/hooks/use-tx";
import { api, fmt, pct, shortAddress } from "@/lib/api";

export function MarketDetail({ ticker }: { ticker: string }) {
  const { data: m, isLoading, isError } = useQuery({ queryKey: ["market", ticker], queryFn: () => api.market(ticker) });
  if (isLoading) return <Skeleton className="h-96" />;
  if (isError || !m) {
    return (
      <Alert>
        <AlertTitle>No market called {ticker}</AlertTitle>
        <AlertDescription>Check the ticker against the markets list.</AlertDescription>
      </Alert>
    );
  }
  const feedAge = Math.max(0, Math.floor(Date.now() / 1000) - m.feedUpdatedAt);
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{m.ticker}</h1>
            <RegimeBadge regime={m.regime} />
          </div>
          <p className="max-w-2xl text-muted-foreground">{regimeExplainer(m.regime)}</p>
        </section>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Price the risk engine uses" value={`$${fmt(m.price)}`} />
          <Stat label="Lenders earn" value={pct(m.supplyRateApr)} />
          <Stat label="Borrowers pay" value={pct(m.borrowRateApr)} />
          <Stat label="Pool used" value={pct(m.utilisation, 0)} />
        </div>

        <Card className="rounded-xl">
          <CardHeader>
            <CardTitle>Where the price comes from</CardTitle>
            <CardDescription>Three sources that fail in different ways. The engine takes the highest, so debt is never undervalued.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <Source label="APRO feed (relayed)" value={`$${fmt(m.feedPrice)}`} note={`updated ${Math.floor(feedAge / 60)} min ago`} />
            <Source label="PancakeSwap 30-min TWAP" value={m.twapPrice ? `$${fmt(m.twapPrice)}` : "–"} note="from the deepest pool" />
            <Source label="Last reference print" value={m.anchorPrice ? `$${fmt(m.anchorPrice)}` : "not pushed yet"} note="counts while the market is closed" />
          </CardContent>
        </Card>

        <Card className="rounded-xl">
          <CardHeader>
            <CardTitle>Pool facts</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Row k="Lent in total" v={`${fmt(m.totalAssets, 4)} ${m.ticker}`} />
            <Row k="Available to borrow" v={`${fmt(m.idle, 4)} ${m.ticker}`} />
            <Row k="Borrow cap" v={`${fmt(m.borrowCapRaw, 2)} ${m.ticker}`} />
            <Row k="Out on loan" v={`${fmt(m.totalBorrows, 4)} ${m.ticker}`} />
            <Row k="Multiplier (shares per raw token)" v={fmt(m.multiplier, 6)} />
            <Row k="Collateral per $100 borrowed" v={`$${fmt(Number(m.initialRatio) * 100, 0)} to open, liquidated under $${fmt(Number(m.liqThreshold) * 100, 0)}`} />
            <Row k="Token" v={shortAddress(m.token)} />
            <Row k="Pool" v={shortAddress(m.lendingPool)} />
          </CardContent>
        </Card>
      </div>

      <ActionPanel ticker={m.ticker} borrowAllowed={m.borrowAllowed} idle={m.idle} price={m.price} initialRatio={m.initialRatio} />
    </div>
  );
}

function ActionPanel({ ticker, borrowAllowed, idle, price, initialRatio }: { ticker: string; borrowAllowed: boolean; idle: string; price: string; initialRatio: string }) {
  const { isConnected } = useAccount();
  const tx = useTx();
  const [lendAmount, setLendAmount] = useState("");
  const [collateral, setCollateral] = useState("");
  const [shortAmount, setShortAmount] = useState("");
  const needed = Number(shortAmount || 0) * Number(price) * Number(initialRatio);
  const busy = tx.isPending;

  return (
    <aside className="lg:sticky lg:top-6 lg:self-start">
      <Card className="rounded-xl">
        <Tabs defaultValue="lend">
          <CardHeader>
            <TabsList className="w-full">
              <TabsTrigger value="lend" className="flex-1">Lend</TabsTrigger>
              <TabsTrigger value="short" className="flex-1">Short</TabsTrigger>
            </TabsList>
          </CardHeader>
          <CardContent>
            <TabsContent value="lend" className="flex flex-col gap-4">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="lend-amount">Amount to lend</FieldLabel>
                  <InputGroup>
                    <InputGroupInput id="lend-amount" inputMode="decimal" placeholder="0.00" value={lendAmount} onChange={(e) => setLendAmount(e.target.value)} />
                    <InputGroupAddon align="inline-end">
                      <InputGroupText>{ticker}</InputGroupText>
                    </InputGroupAddon>
                  </InputGroup>
                  <FieldDescription>You get s{ticker} shares. Dividends and splits still reach you through the multiplier. Withdraw any time there is idle liquidity.</FieldDescription>
                </Field>
              </FieldGroup>
              <Button disabled={!isConnected || busy || !(Number(lendAmount) > 0)} onClick={() => tx.mutate({ action: "lend", params: { ticker, amount: lendAmount } })}>
                {busy && <Spinner data-icon="inline-start" />}
                {isConnected ? `Lend ${lendAmount || ""} ${ticker}` : "Connect a wallet to lend"}
              </Button>
              <Button variant="outline" disabled={!isConnected || busy || !(Number(lendAmount) > 0)} onClick={() => tx.mutate({ action: "withdraw-lend", params: { ticker, amount: lendAmount } })}>
                Withdraw {lendAmount || ""} {ticker}
              </Button>
            </TabsContent>

            <TabsContent value="short" className="flex flex-col gap-4">
              {!borrowAllowed && (
                <Alert>
                  <AlertTitle>Borrowing is paused for {ticker}</AlertTitle>
                  <AlertDescription>The oracle regime does not allow new borrows right now. Covering and repaying still work.</AlertDescription>
                </Alert>
              )}
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="collateral">USDT collateral to add</FieldLabel>
                  <InputGroup>
                    <InputGroupInput id="collateral" inputMode="decimal" placeholder="0.00" value={collateral} onChange={(e) => setCollateral(e.target.value)} />
                    <InputGroupAddon align="inline-end">
                      <InputGroupText>USDT</InputGroupText>
                    </InputGroupAddon>
                  </InputGroup>
                  <FieldDescription>One USDT balance backs shorts in every stock.</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="short-amount">Amount to short</FieldLabel>
                  <InputGroup>
                    <InputGroupInput id="short-amount" inputMode="decimal" placeholder="0.00" value={shortAmount} onChange={(e) => setShortAmount(e.target.value)} />
                    <InputGroupAddon align="inline-end">
                      <InputGroupText>{ticker}</InputGroupText>
                    </InputGroupAddon>
                  </InputGroup>
                  <FieldDescription>
                    Borrows and sells on PancakeSwap in one transaction; the USDT proceeds count as margin. {fmt(idle, 3)} {ticker} available.
                    {needed > 0 && ` Needs about $${fmt(needed, 0)} of collateral in total.`}
                  </FieldDescription>
                </Field>
              </FieldGroup>
              <Button variant="outline" disabled={!isConnected || busy || !(Number(collateral) > 0)} onClick={() => tx.mutate({ action: "deposit-collateral", params: { amount: collateral } })}>
                Add {collateral || ""} USDT collateral
              </Button>
              <Button variant="outline" disabled={!isConnected || busy} onClick={() => tx.mutate({ action: "set-operator", params: {} })}>
                Allow the short router (once)
              </Button>
              <Button disabled={!isConnected || busy || !borrowAllowed || !(Number(shortAmount) > 0)} onClick={() => tx.mutate({ action: "short", params: { ticker, amount: shortAmount } })}>
                {busy && <Spinner data-icon="inline-start" />}
                Short {shortAmount || ""} {ticker}
              </Button>
              <Button variant="outline" disabled={!isConnected || busy || !(Number(shortAmount) > 0)} onClick={() => tx.mutate({ action: "cover", params: { ticker, amount: shortAmount } })}>
                Cover {shortAmount || ""} {ticker}
              </Button>
            </TabsContent>
          </CardContent>
        </Tabs>
      </Card>
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Source({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg bg-muted p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{note}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-1.5 last:border-0">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right tabular-nums">{v}</span>
    </div>
  );
}
