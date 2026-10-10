"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { toast } from "@/components/ui/toast";
import { api, type PreparedTx } from "@/lib/api";

/**
 * Runs a prepared transaction list (from the API's /tx/:action) one after another through the connected wallet:
 * approve, then the action. Every step shows its description, and a failure stops the sequence.
 */
export function useTx() {
  const { address } = useAccount();
  const { data: wallet } = useWalletClient();
  const publicClient = usePublicClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ action, params }: { action: string; params: Record<string, string | number | undefined> }) => {
      if (!address || !wallet || !publicClient) throw new Error("Connect a wallet on BNB Chain first");
      const { txs, simulations } = await api.txWithSimulation(action, { ...params, account: address });
      const hashes: `0x${string}`[] = [];
      for (let i = 0; i < txs.length; i++) {
        const tx = txs[i];
        const sim = simulations?.[i];
        // the first step of a sequence is the only one the dry-run can judge before the earlier steps are mined
        if (i === 0 && sim && sim.status === "FAILED") {
          throw new Error(`Dry-run failed: ${sim.failReason ?? "unknown reason"}`);
        }
        const changes = sim?.balanceChanges?.length ? ` Dry-run: ${sim.balanceChanges.length} balance change${sim.balanceChanges.length === 1 ? "" : "s"}.` : "";
        toast.add({ title: tx.description, description: `Confirm in your wallet.${changes}` });
        const hash = await wallet.sendTransaction({ to: tx.to, data: tx.data, value: BigInt(0), chain: wallet.chain });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error(`Transaction reverted: ${hash}`);
        hashes.push(hash);
      }
      return hashes;
    },
    onSuccess: (hashes) => {
      toast.add({ type: "success", title: hashes.length === 1 ? "Done" : `Done, ${hashes.length} transactions` });
      queryClient.invalidateQueries({ queryKey: ["markets"] });
      queryClient.invalidateQueries({ queryKey: ["market"] });
      queryClient.invalidateQueries({ queryKey: ["account"] });
    },
    onError: (e: Error) => {
      toast.add({ type: "error", title: "Transaction failed", description: e.message.split("\n")[0].slice(0, 200) });
    },
  });
}
