"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";
import { WalletButton } from "@/components/wallet-button";

const links = [
  { href: "/", label: "Markets" },
  { href: "/account", label: "Account" },
  { href: "/rates", label: "Rates" },
  { href: "/desk", label: "Night Desk" },
];

export function TopBar() {
  const pathname = usePathname();
  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4">
        <Link href="/" className="flex items-baseline gap-2 font-semibold tracking-tight">
          <span className="inline-block size-2.5 bg-accent-strong" aria-hidden />
          Stockroom
        </Link>
        <nav className="ml-2 hidden items-center gap-1 sm:flex" aria-label="Main">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                (pathname === l.href || (l.href !== "/" && pathname.startsWith(l.href))) && "bg-muted text-foreground",
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <WalletButton />
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto border-t border-border px-2 py-1 sm:hidden" aria-label="Main, phone">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={cn(
              "shrink-0 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground",
              (pathname === l.href || (l.href !== "/" && pathname.startsWith(l.href))) && "bg-muted text-foreground",
            )}
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
