import type { Address } from "viem";
import { binanceClient, log } from "./env.ts";

/**
 * On-chain prices for tokens without an APRO feed, from the Binance RWA Data API (`/rwa/price` returns an
 * on-chain price and the underlying reference price per contract). Field names are read defensively because the
 * response schema is only documented behind the developer portal; the first live call logs the raw shape once.
 */
let loggedShape = false;

export async function binancePrices(tokens: Address[]): Promise<Map<string, { answer: bigint; updatedAt: bigint }>> {
  const out = new Map<string, { answer: bigint; updatedAt: bigint }>();
  if (tokens.length === 0) return out;
  const client = binanceClient();
  if (!client) {
    log("BINANCE_WEB3_API_KEY not set; markets without an APRO feed stay unpriced");
    return out;
  }
  const data = (await client.rwaPrice({ chainId: 56, contractAddresses: tokens.join(",") })) as any;
  if (!loggedShape) {
    log("rwa/price shape:", JSON.stringify(data).slice(0, 600));
    loggedShape = true;
  }
  const rows: any[] = Array.isArray(data) ? data : Array.isArray(data?.list) ? data.list : Array.isArray(data?.prices) ? data.prices : [];
  const now = BigInt(Math.floor(Date.now() / 1000));
  for (const row of rows) {
    const addr = String(row.contractAddress ?? row.tokenAddress ?? row.address ?? "").toLowerCase();
    const price = row.onchainPrice ?? row.onChainPrice ?? row.price ?? row.tokenPrice;
    if (!addr || price === undefined) continue;
    const answer = toAnswer8(String(price));
    const ts = row.updateTime ?? row.updatedAt ?? row.timestamp;
    const updatedAt = ts ? BigInt(Math.floor(Number(ts) > 1e12 ? Number(ts) / 1000 : Number(ts))) : now;
    out.set(addr, { answer, updatedAt });
  }
  return out;
}

/** "230.0258" -> 23002580000n (8 decimals, truncated). */
export function toAnswer8(decimal: string): bigint {
  const [whole, frac = ""] = decimal.split(".");
  const fracPadded = (frac + "00000000").slice(0, 8);
  return BigInt(whole) * 100_000_000n + BigInt(fracPadded);
}

/** Underlying reference price (USD per share) times the BEP-677 multiplier -> USD per raw token, WAD. */
export function anchorWad(referencePrice: string, multiplierWad: bigint): bigint {
  const price8 = toAnswer8(referencePrice);
  return (price8 * 10_000_000_000n * multiplierWad) / 1_000_000_000_000_000_000n;
}
