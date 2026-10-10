"use client";

// The equity borrow rate on BNB Chain, one line per stock, the same numbers the API publishes as JSON.

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ErrorCard } from "@/components/error-card";
import { Loader } from "@/components/loader";
import { RegimeBadge } from "@/components/regime-badge";
import { Monogram } from "@/components/sheet";
import { API_URL, api, companyName, fmt, money, pct } from "@/lib/api";

export function RatesBoard() {
  const markets = useQuery({ queryKey: ["markets"], queryFn: api.markets, refetchInterval: 15_000 });
  if (markets.isError) return <ErrorCard title="Could not read the rates" message={(markets.error as Error).message + "."} />;
  if (!markets.data) return <Loader label="Reading the rates" />;

  return (
    <div className="mx-auto max-w-3xl">
      <section>
        <p className="text-sm text-ink-soft">The equity borrow rate on BNB Chain</p>
        <h1 className="mt-1 font-heading text-[clamp(2.2rem,6vw,3.4rem)] leading-[1.02] font-semibold tracking-[-0.02em]">What it costs to borrow a stock right now, and what lenders earn.</h1>
        <p className="mt-5 max-w-[60ch] leading-relaxed text-ink-soft">
          Rates follow how much of each pool is out on loan. The same numbers are published as JSON for dashboards and agents at{" "}
          <a className="font-bold text-ink underline" href={`${API_URL}/rates.json`}>
            /rates.json
          </a>
          , free, and at <span className="font-mono text-sm">/paid/rates</span> for 0.01 USDT a call over B402, with the TWAP, anchor and caps too.
        </p>
      </section>

      <ul className="mt-10">
        {markets.data.map((m) => (
          <li key={m.ticker} className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-line-soft py-5 last:border-b-0">
            <Monogram>{m.ticker[0]}</Monogram>
            {/* on a phone the name takes the first line and the three figures share the second */}
            <div className="min-w-0 flex-1 basis-[calc(100%-4rem)] sm:basis-0">
              <p className="flex items-center gap-2.5 text-[1.05rem] font-bold">
                <Link href={`/app/market/${m.ticker}`} className="text-ink no-underline hover:underline">
                  {m.ticker}
                </Link>
                <RegimeBadge regime={m.regime} />
              </p>
              <p className="truncate text-sm text-ink-soft">
                {companyName(m.ticker)}, {money(m.price)}, {pct(m.utilisation, 0)} of the pool out
              </p>
            </div>
            <div className="flex-1 text-left sm:flex-none sm:text-right">
              <p className="font-mono text-[1.05rem]">{pct(m.borrowRateApr)}</p>
              <p className="text-sm text-ink-soft">borrowers pay</p>
            </div>
            <div className="flex-1 text-left sm:w-28 sm:flex-none sm:text-right">
              <p className="font-mono text-[1.05rem] font-medium text-signal-deep">{pct(m.supplyRateApr)}</p>
              <p className="text-sm text-ink-soft">lenders earn</p>
            </div>
            <div className="flex-1 text-left sm:w-24 sm:flex-none sm:text-right">
              <p className="font-mono text-[1.05rem]">{fmt(m.idle, 2)}</p>
              <p className="text-sm text-ink-soft">idle</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
