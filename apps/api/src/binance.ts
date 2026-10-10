import { config } from "dotenv";
import { resolve } from "node:path";
import { BinanceWeb3Client } from "@stockroom/sdk";
import type { PreparedTx } from "./tx.ts";

config({ path: resolve(process.cwd(), "../../.env"), quiet: true });

/** The API's Binance Web3 client (null when the key is not configured; every caller degrades gracefully). */
let client: BinanceWeb3Client | null | undefined;
export function binance(): BinanceWeb3Client | null {
  if (client !== undefined) return client;
  const apiKey = process.env.BINANCE_WEB3_API_KEY;
  const apiSecret = process.env.BINANCE_WEB3_API_SECRET;
  client = apiKey && apiSecret ? new BinanceWeb3Client({ apiKey, apiSecret }) : null;
  return client;
}

export interface Simulation {
  status: string; // SUCCESS or FAILED, as Binance reports it
  failReason: string | null;
  balanceChanges: { contractAddress: string; tokenType?: string; change: string; owner: string }[];
  allowanceChanges: { tokenAddress: string; owner: string; spender: string; preAmount: string; postAmount: string }[];
}

/**
 * Dry-run a prepared transaction through the Binance Transaction API (`/pre-transaction/simulate` with an
 * `evmTx`). The hackathon rules ask for exactly this before anything is broadcast.
 */
export async function simulateTx(from: string, tx: PreparedTx): Promise<Simulation | { status: "UNAVAILABLE"; failReason: string }> {
  const c = binance();
  if (!c) return { status: "UNAVAILABLE", failReason: "Binance API key not configured on this server" };
  try {
    const data = (await c.simulate({ binanceChainId: "56", evmTx: { from, to: tx.to, data: tx.data, value: tx.value } })) as any;
    return {
      status: String(data?.status ?? "UNKNOWN"),
      failReason: data?.failReason ?? null,
      balanceChanges: Array.isArray(data?.balanceChanges) ? data.balanceChanges : [],
      allowanceChanges: Array.isArray(data?.allowanceChanges) ? data.allowanceChanges : [],
    };
  } catch (e) {
    return { status: "UNAVAILABLE", failReason: (e as Error).message };
  }
}

/** Expected output of selling `amountIn` of `from` for `to` on Binance's aggregator, in the smallest unit. */
export async function aggregatorQuote(from: string, to: string, amountIn: bigint, user?: string): Promise<{ amountOut: bigint; vendor: string; priceImpactPercent: string } | null> {
  const c = binance();
  if (!c) return null;
  try {
    const data = (await c.quoteSwap({ chainId: 56, fromTokenAddress: from, toTokenAddress: to, amount: amountIn.toString(), slippage: 0.5, userAddress: user })) as any;
    const q = Array.isArray(data) ? data[0] : data;
    if (!q?.toTokenAmount) return null;
    return { amountOut: BigInt(q.toTokenAmount), vendor: String(q.vendorName ?? ""), priceImpactPercent: String(q.priceImpactPercent ?? "") };
  } catch {
    return null;
  }
}
