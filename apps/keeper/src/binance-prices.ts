import type { Address } from "viem";
import { binanceClient, log } from "./env.ts";

/**
 * Prices from the Binance RWA Data API. `/rwa/tokens?platform=bstock&binanceChainId=56` (checked live
 * 2026-10-10) returns every bStock with `tokenPrice` (on-chain), `referencePrice` (the underlying stock),
 * `tokenToShareRatio` (the BEP-677 multiplier) and `statusInfo` (`openState`, `nextOpenTime`), so one call per
 * cycle feeds both the relay for markets without an APRO feed and the reference anchors.
 */
export interface RwaToken {
  binanceChainId: string;
  tokenContractAddress: string;
  platformId: string;
  tokenSymbol: string;
  underlyingTicker: string;
  tokenToShareRatio: string;
  tokenPrice: string | null;
  referencePrice: string | null;
  statusInfo?: { openState: boolean; marketStatus: string | null; reasonCode: string | null; nextOpenTime: string | number | null; nextCloseTime: string | number | null };
}

let cache: { at: number; rows: RwaToken[] } | null = null;

export async function bstockTokens(maxAgeMs = 60_000): Promise<RwaToken[]> {
  if (cache && Date.now() - cache.at < maxAgeMs) return cache.rows;
  const client = binanceClient();
  if (!client) return [];
  const data = (await client.rwaTokens({ platform: "bstock", chainId: 56 })) as any;
  const rows: RwaToken[] = Array.isArray(data) ? data : Array.isArray(data?.list) ? data.list : [];
  cache = { at: Date.now(), rows };
  return rows;
}

export async function bstockByAddress(): Promise<Map<string, RwaToken>> {
  const m = new Map<string, RwaToken>();
  for (const r of await bstockTokens()) m.set(String(r.tokenContractAddress).toLowerCase(), r);
  return m;
}

/**
 * On-chain prices (8 decimals) for tokens without an APRO feed, from `/rwa/price` (batch), which also returns
 * `tokenPriceUpdatedAt` in milliseconds so the relay keeps an honest timestamp.
 */
export async function binancePrices(tokens: Address[]): Promise<Map<string, { answer: bigint; updatedAt: bigint }>> {
  const out = new Map<string, { answer: bigint; updatedAt: bigint }>();
  if (tokens.length === 0) return out;
  const client = binanceClient();
  if (!client) {
    log("BINANCE_WEB3_API_KEY not set; markets without an APRO feed stay unpriced");
    return out;
  }
  const data = (await client.rwaPrice({ chainId: 56, contractAddresses: tokens.join(",") })) as any;
  const rows: any[] = Array.isArray(data) ? data : [];
  const now = BigInt(Math.floor(Date.now() / 1000));
  for (const row of rows) {
    const addr = String(row.tokenContractAddress ?? "").toLowerCase();
    if (!addr || !row.tokenPrice) continue;
    const ms = Number(row.tokenPriceUpdatedAt ?? 0);
    const updatedAt = ms > 0 ? BigInt(Math.floor(ms / 1000)) : now;
    out.set(addr, { answer: toAnswer8(String(row.tokenPrice)), updatedAt: updatedAt > now ? now : updatedAt });
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
