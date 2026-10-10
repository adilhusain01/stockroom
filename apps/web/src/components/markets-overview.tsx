"use client";

// The desk: everything lent across the pools, how much of it is out, and one row per stock.

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { AccountAside } from "@/components/account-aside";
import { ErrorCard } from "@/components/error-card";
import { Loader } from "@/components/loader";
import { RegimeBadge } from "@/components/regime-badge";
import { Monogram } from "@/components/sheet";
import { Button } from "@/components/ui/button";
import { api, companyName, fmt, money, pct, type Market } from "@/lib/api";

export function MarketsOverview() {
  const markets = useQuery({ queryKey: ["markets"], queryFn: api.markets, refetchInterval: 15_000 });

  if (markets.isError) return <ErrorCard title="Could not read the markets" message={(markets.error as Error).message + "."} />;
  if (!markets.data) return <Loader label="Reading the pools" />;

  const rows = markets.data;
  const lentUsd = rows.reduce((s, m) => s + Number(m.totalAssets) * Number(m.price), 0);
  const outUsd = rows.reduce((s, m) => s + Number(m.totalBorrows) * Number(m.price), 0);
  const avgUtil = rows.length ? rows.reduce((s, m) => s + Number(m.utilisation), 0) / rows.length : 0;
  const bestSupply = rows.reduce((best, m) => (Number(m.supplyRateApr) > Number(best?.supplyRateApr ?? -1) ? m : best), rows[0]);

  return (
    <div className="grid gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-12">
        <section>
          <p className="text-sm text-ink-soft">Lent on Stockroom</p>
          <p className="mt-1 font-heading text-[clamp(3.6rem,11vw,6rem)] leading-[0.95] font-semibold tracking-[-0.03em]">{money(lentUsd)}</p>
          <p className="mt-3 text-sm text-ink-soft">
            {money(outUsd)} out on loan across {rows.length} {rows.length === 1 ? "stock" : "stocks"}, {pct(avgUtil, 0)} of the pools in use
            {bestSupply && Number(bestSupply.supplyRateApr) > 0 ? `, ${bestSupply.ticker} pays lenders the most at ${pct(bestSupply.supplyRateApr)}` : ""}
          </p>
          <div className="mt-7 max-w-xl">
            <LentBar out={outUsd} total={lentUsd} />
          </div>
        </section>

        <section>
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-heading text-[1.6rem] font-semibold tracking-[-0.3px]">Stocks</h2>
            <Link href="/app/rates" className="text-sm font-bold text-signal-deep">
              Rates as a table
            </Link>
          </div>
          {rows.length === 0 && <p className="mt-4 max-w-md leading-relaxed text-ink-soft">No markets listed yet. The first five bStocks appear here once the contracts are deployed.</p>}
          <ul className="mt-2">
            {rows.map((m) => (
              <MarketRow key={m.ticker} m={m} />
            ))}
          </ul>
        </section>
      </div>

      <AccountAside />
    </div>
  );
}

function MarketRow({ m }: { m: Market }) {
  return (
    <li className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-line-soft py-5 last:border-b-0">
      <Monogram>{m.ticker[0]}</Monogram>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2.5 text-[1.05rem] font-bold">
          <Link href={`/app/market/${m.ticker}`} className="text-ink no-underline hover:underline">
            {m.ticker}
          </Link>
          <RegimeBadge regime={m.regime} />
        </p>
        <p className="truncate text-sm text-ink-soft">{companyName(m.ticker)}</p>
      </div>
      <div className="text-right">
        <p className="font-mono text-[1.05rem]">{money(m.price)}</p>
        <p className="text-sm text-ink-soft">
          {fmt(m.totalAssets, 3)} lent, {fmt(m.idle, 3)} idle
        </p>
      </div>
      <div className="w-full text-sm sm:w-44 sm:text-right">
        <p className="font-bold text-signal-deep">{pct(m.supplyRateApr)} to lenders</p>
        <p className="text-ink-soft">
          borrowers pay {pct(m.borrowRateApr)}, {pct(m.utilisation, 0)} out
        </p>
      </div>
      <Button nativeButton={false} render={<Link href={`/app/market/${m.ticker}`} />} className="rounded-full">
        Lend
      </Button>
    </li>
  );
}

/** How much of what is lent is out on loan right now. Signal is out, bare paper is idle. */
function LentBar({ out, total }: { out: number; total: number }) {
  const share = total > 0 ? Math.min(1, Math.max(0, out / total)) : 0;
  const percent = Math.round(share * 100);
  return (
    <div>
      <div role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={`${percent} percent of lent stock is out on loan`} className="h-3 overflow-hidden rounded-full bg-paper-3 shadow-[inset_0_0_0_1px_var(--line)]">
        <div className="h-full origin-left rounded-full bg-signal transition-transform duration-500 ease-out-strong" style={{ transform: `scaleX(${share})` }} />
      </div>
      <div className="mt-2.5 flex items-baseline justify-between gap-4 text-sm">
        <span>
          <span className="font-bold">{money(out)}</span> <span className="text-ink-soft">out on loan</span>
        </span>
        <span>
          <span className="font-bold">{money(Math.max(0, total - out))}</span> <span className="text-ink-soft">idle in the pools</span>
        </span>
      </div>
    </div>
  );
}
