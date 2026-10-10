import { aggregatorV3Abi, RelayFeedAbi } from "@stockroom/sdk";
import type { Address } from "viem";
import { deployment, keeperAccount, log, markets, publicClient, walletClient } from "./env.ts";
import { binancePrices } from "./binance-prices.ts";

/**
 * Relays prices into the RelayFeeds. APRO's bStocks feeds only answer externally owned accounts, so the keeper
 * reads them with an eth_call whose `from` is its own wallet (tx.origin == msg.sender passes their access check)
 * and writes the same answer and timestamp on-chain. Markets without an APRO feed get the Binance RWA Data API's
 * on-chain price instead, stamped with the time of the read.
 */
export interface RelayTarget {
  ticker: string;
  token: Address | null; // null for the USDT feed
  relay: Address;
  source: Address | null;
}

export function relayTargets(): RelayTarget[] {
  const list: RelayTarget[] = markets().map((m) => ({ ticker: m.ticker, token: m.token, relay: m.feed, source: m.aproFeed }));
  list.push({ ticker: "USDT", token: null, relay: deployment().usdtFeed, source: deployment().usdtAproFeed });
  return list;
}

export async function readSource(source: Address, from: Address): Promise<{ answer: bigint; updatedAt: bigint }> {
  const [, answer, , updatedAt] = await publicClient.readContract({
    address: source,
    abi: aggregatorV3Abi,
    functionName: "latestRoundData",
    account: from,
  });
  return { answer, updatedAt };
}

export async function currentRelay(relay: Address): Promise<{ answer: bigint; updatedAt: bigint }> {
  const [, answer, , updatedAt] = await publicClient.readContract({ address: relay, abi: RelayFeedAbi, functionName: "latestRoundData" });
  return { answer, updatedAt };
}

/** One pass over every feed. Returns the number of on-chain writes. */
export async function relayOnce(opts: { dryRun?: boolean; minIntervalSec?: number } = {}): Promise<number> {
  const account = keeperAccount();
  const wallet = walletClient();
  const minInterval = BigInt(opts.minIntervalSec ?? 60);
  const now = BigInt(Math.floor(Date.now() / 1000));
  let writes = 0;
  const fromBinance = await binancePrices(markets().filter((m) => !m.aproFeed).map((m) => m.token)).catch((e) => {
    log("binance prices unavailable:", (e as Error).message);
    return new Map<string, { answer: bigint; updatedAt: bigint }>();
  });

  for (const t of relayTargets()) {
    let next: { answer: bigint; updatedAt: bigint } | undefined;
    try {
      if (t.source) next = await readSource(t.source, account.address);
      else if (t.token) next = fromBinance.get(t.token.toLowerCase());
    } catch (e) {
      log(t.ticker, "source read failed:", (e as Error).message);
      continue;
    }
    if (!next || next.answer <= 0n) {
      log(t.ticker, "no price available");
      continue;
    }
    const cur = await currentRelay(t.relay);
    const changed = cur.answer !== next.answer || cur.updatedAt !== next.updatedAt;
    const dueForHeartbeat = now - cur.updatedAt >= 1800n; // re-stamp every 30 minutes even if unchanged
    if (!changed && !dueForHeartbeat) continue;
    if (next.updatedAt < cur.updatedAt) continue; // never move a feed backwards
    const updatedAt = next.updatedAt > now ? now : next.updatedAt;
    if (!changed && now - cur.updatedAt < minInterval) continue;
    log(t.ticker, "relay", cur.answer.toString(), "->", next.answer.toString(), "updatedAt", updatedAt.toString(), opts.dryRun ? "(dry run)" : "");
    if (opts.dryRun) {
      writes++;
      continue;
    }
    const hash = await wallet.writeContract({
      address: t.relay,
      abi: RelayFeedAbi,
      functionName: "setAnswer",
      args: [next.answer, changed ? updatedAt : now],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    writes++;
  }
  return writes;
}
