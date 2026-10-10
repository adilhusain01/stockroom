import { ControllerAbi, LiquidatorAbi } from "@stockroom/sdk";
import { encodePacked, parseAbiItem, type Address } from "viem";
import { deployment, log, markets, publicClient, walletClient } from "./env.ts";

const WAD = 1_000_000_000_000_000_000n;
const borrowedEvent = parseAbiItem("event Borrowed(address indexed account, address indexed token, address indexed to, uint256 rawAmount)");

/** Accounts that have ever borrowed, from Borrowed logs (the controller has no account list on purpose). */
export async function knownBorrowers(fromBlock: bigint): Promise<Set<Address>> {
  const logs = await publicClient.getLogs({ address: deployment().controller, event: borrowedEvent, fromBlock, toBlock: "latest" });
  const set = new Set<Address>();
  for (const l of logs) if (l.args.account) set.add(l.args.account);
  return set;
}

export function buyPathFor(token: Address): `0x${string}` {
  const idx = markets().findIndex((m) => m.token.toLowerCase() === token.toLowerCase());
  const fee = idx >= 0 ? poolFee(idx) : 2500;
  // exactOutput path: token out first, then the fee tier, then USDT
  return encodePacked(["address", "uint24", "address"], [token, fee, deployment().usdt]);
}

function poolFee(i: number): number {
  const fees = (process.env.POOL_FEES ?? "").split(",").map((x) => Number(x)).filter((x) => x > 0);
  return fees[i] ?? 2500;
}

/** One scan: liquidate every account below health 1 through the capital-free flash path. */
export async function liquidateOnce(opts: { dryRun?: boolean; fromBlock?: bigint } = {}): Promise<number> {
  const wallet = walletClient();
  const fromBlock = opts.fromBlock ?? BigInt(process.env.DEPLOY_BLOCK ?? "0");
  const borrowers = await knownBorrowers(fromBlock);
  let done = 0;
  for (const account of borrowers) {
    const health = await publicClient.readContract({ address: deployment().controller, abi: ControllerAbi, functionName: "healthFactor", args: [account] });
    if (health >= WAD) continue;
    const tokens = await publicClient.readContract({ address: deployment().controller, abi: ControllerAbi, functionName: "borrowedTokens", args: [account] });
    for (const token of tokens) {
      const debt = await publicClient.readContract({ address: deployment().controller, abi: ControllerAbi, functionName: "positionOf", args: [account, token] });
      if (debt === 0n) continue;
      log("liquidatable", account, token, "health", health.toString(), "debt", debt.toString());
      if (opts.dryRun) {
        done++;
        continue;
      }
      try {
        const { request } = await publicClient.simulateContract({
          address: deployment().liquidator,
          abi: LiquidatorAbi,
          functionName: "liquidateWithFlash",
          args: [account, token, debt, buyPathFor(token), 0n],
          account: wallet.account,
        });
        const hash = await wallet.writeContract(request);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        log("liquidated", account, token, "tx", hash, receipt.status);
        done++;
      } catch (e) {
        log("liquidation simulate failed", account, token, (e as Error).message.split("\n")[0]);
      }
    }
  }
  return done;
}
