import { config } from "dotenv";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";
import { loadDeployment, marketsOf, BinanceWeb3Client, type Deployment, type Market } from "@stockroom/sdk";

config({ path: resolve(process.cwd(), "../../.env"), quiet: true });
config({ path: resolve(process.cwd(), ".env"), override: false, quiet: true });

export const RPC_URL = process.env.BSC_RPC_URL ?? "https://bsc-rpc.publicnode.com";

export const publicClient = createPublicClient({ chain: bsc, transport: http(RPC_URL, { batch: true }) });
/**
 * Log queries go to their own RPC, unbatched: on 2026-10-11 bsc-dataseed refused every eth_getLogs ("limit
 * exceeded") while publicnode answered a 1,000-block window in half a second. LOGS_RPC_URL overrides.
 */
export const LOGS_RPC_URL = process.env.LOGS_RPC_URL ?? "https://bsc-rpc.publicnode.com";
export const logsClient = createPublicClient({ chain: bsc, transport: http(LOGS_RPC_URL) });

export function keeperAccount() {
  const key = process.env.KEEPER_PRIVATE_KEY as Hex | undefined;
  if (!key) throw new Error("KEEPER_PRIVATE_KEY missing from .env");
  return privateKeyToAccount(key);
}

export function walletClient() {
  return createWalletClient({ chain: bsc, transport: http(RPC_URL), account: keeperAccount() });
}

/**
 * Poll for a receipt the plain way. viem's waitForTransactionReceipt also fetches whole blocks to detect
 * replacements, and public BSC RPCs answered that with "HTTP request failed" right after every send.
 */
export async function waitReceipt(hash: Hex, timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      return await publicClient.getTransactionReceipt({ hash });
    } catch {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw new Error(`no receipt for ${hash} after ${Math.round(timeoutMs / 1000)}s`);
}

let cachedDeployment: Deployment | null = null;

/** The deployment file is read on first use so unit tests can import this module without one. */
export function deployment(): Deployment {
  if (!cachedDeployment) {
    cachedDeployment = loadDeployment(process.env.DEPLOYMENT_FILE ?? resolve(process.cwd(), "../../contracts/deployments/56.json"));
  }
  return cachedDeployment;
}

export function markets(): Market[] {
  return marketsOf(deployment());
}

export function binanceClient(): BinanceWeb3Client | null {
  const apiKey = process.env.BINANCE_WEB3_API_KEY;
  const apiSecret = process.env.BINANCE_WEB3_API_SECRET;
  if (!apiKey || !apiSecret) return null;
  return new BinanceWeb3Client({ apiKey, apiSecret });
}

export function log(...args: unknown[]) {
  console.log(new Date().toISOString(), ...args);
}

export type { Address };
