"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { WalletButton } from "@/components/wallet-button";
import { Loader } from "@/components/loader";
import { api, duration, sessionWord } from "@/lib/api";

const NAV = [
  { href: "/app", label: "Markets" },
  { href: "/app/account", label: "Account" },
  { href: "/app/desk", label: "Night Desk" },
  { href: "/app/rates", label: "Rates" },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1240px] flex-col px-5 pb-16 sm:px-8">
      {/* URL hooks only resolve at request time; Suspense lets the shell prerender around them. */}
      <Suspense fallback={<div className="h-[72px]" />}>
        <Header />
      </Suspense>
      <main className="flex-1 pt-8 sm:pt-10">
        <Suspense fallback={<Loader />}>{children}</Suspense>
      </main>
      <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-line pt-6 text-xs text-ink-faint">
        <span>A hackathon prototype on BNB Smart Chain. Contracts are unaudited; keep sizes small.</span>
        <span>bStocks are not available to US persons. Not investment advice.</span>
      </footer>
    </div>
  );
}

function Header() {
  const pathname = usePathname();
  const session = useQuery({ queryKey: ["session"], queryFn: api.session, refetchInterval: 30_000, retry: false });
  // A market page belongs to the Markets section.
  const section = NAV.slice(1).find((n) => pathname.startsWith(n.href))?.href ?? "/app";
  const s = session.data;

  return (
    <header className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-3 border-b border-line py-4 md:grid-cols-[1fr_auto_1fr]">
      <Link href="/" className="justify-self-start font-heading text-[1.5rem] font-semibold tracking-[-0.01em] text-ink no-underline">
        Stockroom
      </Link>

      <nav aria-label="Sections" className="order-3 col-span-2 flex gap-1 rounded-full bg-paper-3 p-1 shadow-[inset_0_0_0_1px_var(--line)] md:order-none md:col-span-1">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={section === item.href ? "page" : undefined}
            className={`flex-1 rounded-full px-3 py-2 text-center text-sm font-bold whitespace-nowrap no-underline transition-[color,background-color] duration-150 ease-out-strong sm:px-5 md:flex-none ${
              section === item.href ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="flex items-center justify-end gap-3 justify-self-end text-sm md:col-start-3">
        {s && (
          <span className="hidden items-center gap-2 text-ink-soft sm:flex" title={s.isOpen ? "US extended hours are open" : `Wall Street reopens in ${duration(s.nextOpen - s.now)}`}>
            <span className={`size-2 rounded-full ${s.isOpen ? "bg-ink" : "bg-signal"}`} aria-hidden />
            {sessionWord(s)}
          </span>
        )}
        <WalletButton />
      </div>
    </header>
  );
}
