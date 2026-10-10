"use client";

import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { bsc } from "wagmi/chains";
import { Button } from "@/components/ui/button";
import { shortAddress } from "@/lib/api";

export function WalletButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  if (!isConnected || !address) {
    const connector = connectors[0];
    return (
      <Button size="sm" className="rounded-full px-4" onClick={() => connector && connect({ connector })} disabled={!connector || isPending}>
        {isPending ? "Connecting" : "Connect wallet"}
      </Button>
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
