"use client";

// One stock: the price the risk engine uses and where it comes from, the pool, and the lend and short panel.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { ErrorCard } from "@/components/error-card";
import { Loader } from "@/components/loader";
import { RegimeBadge, regimeExplainer } from "@/components/regime-badge";
import { LineRow } from "@/components/sheet";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTx } from "@/hooks/use-tx";
import { api, companyName, fmt, money, pct, shortAddress } from "@/lib/api";

export function MarketDetail({ ticker }: { ticker: string }) {
  const { data: m, isLoading, isError, error } = useQuery({ queryKey: ["market", ticker], queryFn: () => api.market(ticker), refetchInterval: 15_000 });
  if (isLoading) return <Loader label={`Reading ${ticker}`} />;
  if (isError || !m) return <ErrorCard title={`No market called ${ticker}`} message={(error as Error)?.message ?? "Check the ticker against the markets list."} />;
  const feedAge = Math.max(0, Math.floor(Date.now() / 1000) - m.feedUpdatedAt);

  return (
    <div className="grid gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex min-w-0 flex-col gap-12">
        <section>
          <p className="flex flex-wrap items-center gap-3 text-sm text-ink-soft">
            <span>
              {companyName(m.ticker)}, as the bStock {m.ticker}
            </span>
            <RegimeBadge regime={m.regime} />
          </p>
          <p className="mt-1 font-heading text-[clamp(3.6rem,11vw,6rem)] leading-[0.95] font-semibold tracking-[-0.03em]">{money(m.price)}</p>
          <p className="mt-3 text-sm text-ink-soft">
            Lenders earn {pct(m.supplyRateApr)}, borrowers pay {pct(m.borrowRateApr)}, {pct(m.utilisation, 0)} of the pool is out
          </p>
          <p className="mt-5 max-w-[60ch] leading-relaxed text-ink-soft">{regimeExplainer(m.regime)}</p>
        </section>

        <section>
          <h2 className="font-heading text-[1.6rem] font-semibold tracking-[-0.3px]">Where the price comes from</h2>
          <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-ink-soft">Three sources that fail in different ways. The engine values debt at the highest, so it is never undervalued.</p>
          <div className="mt-4">
            <LineRow label="APRO feed, relayed on-chain" sub={`updated ${Math.floor(feedAge / 60)} min ago`} value={money(m.feedPrice)} />
            <LineRow label="PancakeSwap 30 minute average" sub="from the deepest pool" value={m.twapPrice ? money(m.twapPrice) : "–"} />
            <LineRow label="Last Binance reference print" sub="counts while the market is closed" value={m.anchorPrice ? money(m.anchorPrice) : "not pushed yet"} />
          </div>
        </section>

        <section>
          <h2 className="font-heading text-[1.6rem] font-semibold tracking-[-0.3px]">The pool</h2>
          <div className="mt-4">
            <LineRow label="Lent in total" value={`${fmt(m.totalAssets, 4)} ${m.ticker}`} />
            <LineRow label="Available to borrow" value={`${fmt(m.idle, 4)} ${m.ticker}`} />
            <LineRow label="Out on loan" value={`${fmt(m.totalBorrows, 4)} ${m.ticker}`} />
            <LineRow label="Borrow cap" value={`${fmt(m.borrowCapRaw, 2)} ${m.ticker}`} />
            <LineRow label="Multiplier" sub="shares per raw token, moves on dividends and splits" value={`${fmt(m.multiplier, 6)}${m.multiplierPending ? ", change pending" : ""}`} />
            <LineRow label="Collateral per $100 borrowed" sub="to open, and where liquidation starts" value={`$${fmt(Number(m.initialRatio) * 100, 0)} / $${fmt(Number(m.liqThreshold) * 100, 0)}`} />
            <LineRow label="Token" value={shortAddress(m.token)} />
            <LineRow label="Pool" value={shortAddress(m.lendingPool)} />
          </div>
        </section>
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
      <Card>
        <Tabs defaultValue="lend">
          <CardHeader>
            <TabsList className="w-full rounded-full bg-paper-3 p-1">
              <TabsTrigger value="lend" className="flex-1 rounded-full font-bold data-[selected]:bg-ink data-[selected]:text-paper">
                Lend
              </TabsTrigger>
              <TabsTrigger value="short" className="flex-1 rounded-full font-bold data-[selected]:bg-ink data-[selected]:text-paper">
                Short
              </TabsTrigger>
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
              <Button size="lg" disabled={!isConnected || busy || !(Number(lendAmount) > 0)} onClick={() => tx.mutate({ action: "lend", params: { ticker, amount: lendAmount } })}>
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
                    {needed > 0 && ` Needs about ${money(needed)} of collateral in total.`}
                  </FieldDescription>
                </Field>
              </FieldGroup>
              <Button variant="outline" disabled={!isConnected || busy || !(Number(collateral) > 0)} onClick={() => tx.mutate({ action: "deposit-collateral", params: { amount: collateral } })}>
                Add {collateral || ""} USDT collateral
              </Button>
              <Button variant="outline" disabled={!isConnected || busy} onClick={() => tx.mutate({ action: "set-operator", params: {} })}>
                Allow the short router, once
              </Button>
              <Button size="lg" disabled={!isConnected || busy || !borrowAllowed || !(Number(shortAmount) > 0)} onClick={() => tx.mutate({ action: "short", params: { ticker, amount: shortAmount } })}>
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
