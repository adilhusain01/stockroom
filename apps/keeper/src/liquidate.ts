import { ControllerAbi, LiquidatorAbi } from "@stockroom/sdk";
import { encodePacked, parseAbiItem, type Address } from "viem";
import { deployment, log, logsClient, markets, publicClient, walletClient } from "./env.ts";

const WAD = 1_000_000_000_000_000_000n;
const borrowedEvent = parseAbiItem("event Borrowed(address indexed account, address indexed token, address indexed to, uint256 rawAmount)");

/**
 * Accounts that have ever borrowed, from Borrowed logs (the controller has no account list on purpose). Public
 * BSC RPCs cap eth_getLogs at about 5,000 blocks per call ("Request exceeds defined limit"), so the scan walks
 * from DEPLOY_BLOCK in windows.
 */
export async function knownBorrowers(fromBlock: bigint): Promise<Set<Address>> {
  if (fromBlock === 0n) throw new Error("set DEPLOY_BLOCK to the block the controller was deployed in; scanning from genesis is refused by public RPCs");
  const latest = await logsClient.getBlockNumber();
  const WINDOW = 1_000n; // bsc-dataseed refused 2,095 blocks on 2026-10-11 and accepted 2,000
  const set = new Set<Address>();
  for (let from = fromBlock; from <= latest; from += WINDOW) {
    const to = from + WINDOW - 1n > latest ? latest : from + WINDOW - 1n;
    const logs = await logsClient.getLogs({ address: deployment().controller, event: borrowedEvent, fromBlock: from, toBlock: to });
    for (const l of logs) if (l.args.account) set.add(l.args.account);
  }
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
