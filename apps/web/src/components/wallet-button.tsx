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
      <Button onClick={() => connector && connect({ connector })} disabled={!connector || isPending}>
        {isPending ? "Connecting" : "Connect wallet"}
      </Button>
    );
  }
  if (chainId !== bsc.id) {
    return (
      <Button variant="destructive" onClick={() => switchChain({ chainId: bsc.id })}>
        Switch to BNB Chain
      </Button>
    );
  }
  return (
    <Button variant="outline" onClick={() => disconnect()} title="Disconnect">
      {shortAddress(address)}
    </Button>
  );
}
