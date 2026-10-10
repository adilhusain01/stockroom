"use client";

// The right-hand rail every desk screen shares: where the US market is, and how the connected wallet stands.

import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { HealthMeter } from "@/components/health-meter";
import { SessionCard } from "@/components/session-card";
import { LineRow } from "@/components/sheet";
import { api, fmt, money } from "@/lib/api";

export function AccountAside() {
  const session = useQuery({ queryKey: ["session"], queryFn: api.session, refetchInterval: 30_000, retry: false });
  const { address, isConnected } = useAccount();
  const account = useQuery({ queryKey: ["account", address], queryFn: () => api.account(address!), enabled: !!address, refetchInterval: 15_000 });
  const a = account.data;
  const debt = a ? a.positions.reduce((s, p) => s + Number(p.valueUsd), 0) : 0;
  return (
    <aside className="flex flex-col gap-10 lg:border-l lg:border-line lg:pl-10">
      {session.data && <SessionCard session={session.data} />}
      <section aria-label="Account health">
        {isConnected && a ? (
          <>
            <HealthMeter health={a.healthFactor ? Number(a.healthFactor) : null} />
            <div className="mt-5">
              <LineRow label="USDT collateral" value={money(a.collateral)} />
              <LineRow label="Debt, at today's prices" value={money(debt)} />
              <LineRow label="Short positions" value={String(a.positions.length)} />
              <LineRow label="Stocks lent" value={String(a.lending.filter((l) => Number(l.assets) > 0).length)} />
              <LineRow label="Fees pending" value={`${fmt(a.pendingFees, 4)} USDT`} />
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-ink-soft">Your account</p>
            <p className="mt-1 font-heading text-[1.9rem] leading-none font-semibold tracking-[-0.4px]">{isConnected ? "Reading" : "Not connected"}</p>
            <p className="mt-4 text-sm leading-relaxed text-ink-soft">
              {isConnected ? "Fetching your collateral, debt and lending positions." : "Connect a wallet on BNB Chain to lend, borrow and see your health factor here. Reading the markets needs no wallet."}
            </p>
          </>
        )}
      </section>
    </aside>
  );
}
