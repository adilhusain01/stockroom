"use client";

// Night Desk is the keeper wallet; its positions are public, so the page reads them like any other account.

import { useQuery } from "@tanstack/react-query";
import { ErrorCard } from "@/components/error-card";
import { Loader } from "@/components/loader";
import { SessionCard } from "@/components/session-card";
import { LineRow } from "@/components/sheet";
import { API_URL, api, fmt, money, shortAddress } from "@/lib/api";

const LOOP = [
  { when: "Friday, 20:00 New York", title: "Borrow", body: "Deposit USDT collateral and borrow NVDAB from the pool. Borrowing is allowed while the session is closed, except in the last 30 minutes before the open." },
  { when: "The weekend", title: "Provide liquidity", body: "Mint a PancakeSwap v3 position two percent either side of the price. Weekend flow pays fees while the price sits near Friday's close." },
  { when: "Monday, 02:00 New York", title: "Repay", body: "Remove the liquidity, buy back whatever the pool took, repay the raw units in full and withdraw the collateral. The borrow fee it paid is the lenders' yield." },
];

export function DeskStatus() {
  const deployment = useQuery({ queryKey: ["deployment"], queryFn: api.deployment, staleTime: Infinity, retry: false });
  const keeper = deployment.data?.keeper;
  const account = useQuery({ queryKey: ["account", keeper], queryFn: () => api.account(keeper!), enabled: !!keeper, refetchInterval: 15_000 });
  const session = useQuery({ queryKey: ["session"], queryFn: api.session, refetchInterval: 30_000, retry: false });

  if (deployment.isError) return <ErrorCard title="Could not read the deployment" message={(deployment.error as Error).message + "."} />;
  if (!keeper || !account.data) return <Loader label="Reading the desk" />;
  const a = account.data;
  const open = a.positions.length > 0;

  return (
    <div className="grid gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-12">
        <section>
          <p className="text-sm text-ink-soft">Night Desk, the first borrower</p>
          <p className="mt-1 font-heading text-[clamp(2.8rem,8vw,4.6rem)] leading-[0.98] font-semibold tracking-[-0.03em]">{open ? "The desk is open." : "The desk is idle."}</p>
          <p className="mt-5 max-w-[60ch] leading-relaxed text-ink-soft">
            An agent run by the keeper wallet {shortAddress(keeper)}. Every Friday after the US close it borrows bStocks against USDT, provides PancakeSwap v3 liquidity while Wall Street is shut, pulls it before the Monday open, buys back any shortfall and repays. It has an ERC-8004 identity on BNB Chain and an agent card at{" "}
            <a className="font-bold text-ink underline" href={`${API_URL}/agent-card.json`}>
              /agent-card.json
            </a>
            . {open ? "Borrowed stock is out as liquidity right now." : "Waiting for the next Friday close."}
          </p>
          <div className="mt-6 max-w-xl">
            <LineRow label="USDT collateral" value={money(a.collateral)} />
            <LineRow label="Borrowed" value={open ? a.positions.map((p) => `${fmt(p.debtRaw, 3)} ${p.ticker}`).join(", ") : "nothing"} />
            <LineRow label="Health factor" value={a.healthFactor ? fmt(a.healthFactor) : "no debt"} />
            <LineRow label="Fees paid so far, pending" value={`${fmt(a.pendingFees, 4)} USDT`} />
          </div>
        </section>

        <section>
          <h2 className="font-heading text-[1.6rem] font-semibold tracking-[-0.3px]">The weekend loop</h2>
          <ol className="mt-8 grid gap-x-10 gap-y-10 md:grid-cols-3">
            {LOOP.map((step, i) => (
              <li key={step.title}>
                <span className="font-heading text-[3.4rem] leading-none font-semibold text-signal" aria-hidden>
                  {i + 1}
                </span>
                <p className="mt-3 text-[0.76rem] tracking-[0.5px] text-ink-faint uppercase">{step.when}</p>
                <h3 className="mt-1 font-heading text-[1.35rem] leading-tight font-semibold tracking-[-0.2px]">{step.title}</h3>
                <p className="mt-2 text-sm leading-[1.65] text-ink-soft">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <aside className="flex flex-col gap-10 lg:border-l lg:border-line lg:pl-10">
        {session.data && <SessionCard session={session.data} />}
        <section>
          <p className="text-sm text-ink-soft">Why it exists</p>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">The first borrow on any lending market has to come from somewhere. The desk pays the fee that becomes the first lenders&apos; yield, and publishes the live borrow rate at /rates.json for anyone else who wants to follow.</p>
        </section>
      </aside>
    </div>
  );
}
