"use client";

// The account: what the wallet has lent, what it owes, and how far it is from liquidation.

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { AccountAside } from "@/components/account-aside";
import { ErrorCard } from "@/components/error-card";
import { Loader } from "@/components/loader";
import { Monogram } from "@/components/sheet";
import { Button } from "@/components/ui/button";
import { useTx } from "@/hooks/use-tx";
import { api, companyName, fmt, money } from "@/lib/api";

export function AccountPanel() {
  const { address, isConnected } = useAccount();
  const account = useQuery({ queryKey: ["account", address], queryFn: () => api.account(address!), enabled: !!address, refetchInterval: 15_000 });
  const tx = useTx();

  if (!isConnected || !address) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="font-heading text-[2.4rem] leading-none font-semibold tracking-[-0.02em]">No wallet connected</p>
        <p className="mt-4 leading-relaxed text-ink-soft">Connect a wallet on BNB Chain, top right, to see what you have lent, what you owe and how far you are from liquidation.</p>
      </div>
    );
  }
  if (account.isError) return <ErrorCard title="Could not read the account" message={(account.error as Error).message + "."} />;
  if (!account.data) return <Loader label="Reading the account" />;
  const a = account.data;
  const debt = a.positions.reduce((s, p) => s + Number(p.valueUsd), 0);
  const lent = a.lending.filter((l) => Number(l.assets) > 0 || Number(l.claimableUsdt) > 0);

  return (
    <div className="grid gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-12">
        <section>
          <p className="text-sm text-ink-soft">USDT collateral</p>
          <p className="mt-1 font-heading text-[clamp(3.6rem,11vw,6rem)] leading-[0.95] font-semibold tracking-[-0.03em]">{money(a.collateral)}</p>
          <p className="mt-3 text-sm text-ink-soft">
            {money(debt)} of short debt at today&apos;s prices
            {Number(a.pendingFees) > 0 ? `, ${fmt(a.pendingFees, 4)} USDT of fees pending` : ""}
            {a.healthFactor ? `, health factor ${fmt(a.healthFactor)}` : ", no debt"}
          </p>
          {Number(a.collateral) > 0 && a.positions.length === 0 && (
            <div className="mt-6">
              <Button variant="secondary" className="rounded-full" disabled={tx.isPending} onClick={() => tx.mutate({ action: "withdraw-collateral", params: { amount: a.collateral } })}>
                Withdraw all collateral
              </Button>
            </div>
          )}
        </section>

        <section>
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-heading text-[1.6rem] font-semibold tracking-[-0.3px]">Lending</h2>
            <Link href="/app" className="text-sm font-bold text-signal-deep">
              Lend another stock
            </Link>
          </div>
          {lent.length === 0 ? (
            <p className="mt-4 max-w-md leading-relaxed text-ink-soft">Nothing lent yet. Pick a stock on the markets page; the shares show here with the USDT you can claim.</p>
          ) : (
            <ul className="mt-2">
              {lent.map((l) => (
                <li key={l.ticker} className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-line-soft py-5 last:border-b-0">
                  <Monogram>{l.ticker[0]}</Monogram>
                  <div className="min-w-0 flex-1">
                    <p className="text-[1.05rem] font-bold">
                      <Link href={`/app/market/${l.ticker}`} className="text-ink no-underline hover:underline">
                        {l.ticker}
                      </Link>
                    </p>
                    <p className="truncate text-sm text-ink-soft">{companyName(l.ticker)}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-[1.05rem]">
                      {fmt(l.assets, 4)} {l.ticker}
                    </p>
                    <p className="text-sm text-ink-soft">{fmt(l.effectiveShares, 4)} effective shares</p>
                  </div>
                  <div className="w-full text-sm sm:w-40 sm:text-right">
                    <p className="font-bold text-signal-deep">{fmt(l.claimableUsdt, 4)} USDT</p>
                    <p className="text-ink-soft">claimable now</p>
                  </div>
                  <Button variant="secondary" className="rounded-full" disabled={Number(l.claimableUsdt) === 0 || tx.isPending} onClick={() => tx.mutate({ action: "claim", params: { ticker: l.ticker } })}>
                    Claim
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="font-heading text-[1.6rem] font-semibold tracking-[-0.3px]">Borrowing</h2>
          {a.positions.length === 0 ? (
            <p className="mt-4 max-w-md leading-relaxed text-ink-soft">No open shorts. Open one from a stock&apos;s page; it shows here with its liquidation price.</p>
          ) : (
            <ul className="mt-2">
              {a.positions.map((p) => (
                <li key={p.ticker} className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-line-soft py-5 last:border-b-0">
                  <Monogram>{p.ticker[0]}</Monogram>
                  <div className="min-w-0 flex-1">
                    <p className="text-[1.05rem] font-bold">
                      <Link href={`/app/market/${p.ticker}`} className="text-ink no-underline hover:underline">
                        {p.ticker}
                      </Link>
                    </p>
                    <p className="truncate text-sm text-ink-soft">
                      owes {fmt(p.debtRaw, 4)} at {money(p.priceUsd)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-[1.05rem]">{money(p.valueUsd)}</p>
                    <p className="text-sm text-ink-soft">debt value</p>
                  </div>
                  <div className="w-full text-sm sm:w-40 sm:text-right">
                    <p className="font-bold">{p.liquidationPriceUsd ? money(p.liquidationPriceUsd) : "–"}</p>
                    <p className="text-ink-soft">liquidates above</p>
                  </div>
                  <Button className="rounded-full" disabled={tx.isPending} onClick={() => tx.mutate({ action: "cover", params: { ticker: p.ticker, amount: p.debtRaw } })}>
                    Cover all
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <AccountAside />
    </div>
  );
}
