"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { bsc } from "wagmi/chains";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { shortAddress } from "@/lib/api";

/**
 * Connect, switch chain, disconnect. Wallets announce themselves through EIP-6963 (Binance Wallet, MetaMask,
 * Rabby, Trust...), and wagmi lists each as its own connector next to the plain "Injected" fallback. One wallet
 * connects straight away; several open a small list; none shows what to install. Errors reach the user as toasts
 * instead of vanishing.
 */
export function WalletButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect({
    mutation: { onError: (e) => toast.add({ type: "error", title: "Could not connect", description: e.message.split("\n")[0].slice(0, 160) }) },
  });
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // the announced wallets, with the generic fallback only when nothing announced itself
  const announced = connectors.filter((c) => c.id !== "injected");
  const choices = announced.length > 0 ? announced : connectors;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!isConnected || !address) {
    const pick = () => {
      if (choices.length === 0) {
        toast.add({ type: "error", title: "No wallet found", description: "Install Binance Wallet, MetaMask or Rabby in this browser, then reload." });
        return;
      }
      if (choices.length === 1) {
        connect({ connector: choices[0] });
        return;
      }
      setOpen((v) => !v);
    };
    return (
      <div ref={box} className="relative">
        <Button size="sm" className="rounded-full px-4" onClick={pick} disabled={isPending} aria-haspopup={choices.length > 1 ? "menu" : undefined} aria-expanded={open}>
          {isPending ? "Connecting" : "Connect wallet"}
        </Button>
        {open && (
          <div role="menu" className="absolute right-0 z-20 mt-2 flex min-w-48 flex-col gap-1 rounded-lg bg-paper-2 p-1.5 shadow-[inset_0_0_0_1.5px_var(--line),var(--shadow-card)]">
            {choices.map((c) => (
              <button
                key={c.uid}
                type="button"
                role="menuitem"
                className="cursor-pointer rounded-md px-3 py-2 text-left text-sm font-bold text-ink transition-colors duration-150 hover:bg-ink/[0.06]"
                onClick={() => {
                  setOpen(false);
                  connect({ connector: c });
                }}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
  if (chainId !== bsc.id) {
    return (
      <Button size="sm" variant="destructive" className="rounded-full px-4" onClick={() => switchChain({ chainId: bsc.id })}>
        Switch to BNB Chain
      </Button>
    );
  }
  return (
    <span className="flex items-center rounded-full shadow-[inset_0_0_0_1.5px_var(--line)]">
      <span className="py-1.5 pr-2 pl-3.5 font-mono text-[0.78rem] text-ink-soft" title={address}>
        {shortAddress(address)}
      </span>
      <button type="button" onClick={() => disconnect()} className="cursor-pointer rounded-full py-1.5 pr-3.5 pl-2 text-[0.8rem] font-bold text-ink-soft transition-colors duration-150 hover:text-ink">
        Disconnect
      </button>
    </span>
  );
}
