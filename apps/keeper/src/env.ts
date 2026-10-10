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

export function keeperAccount() {
  const key = process.env.KEEPER_PRIVATE_KEY as Hex | undefined;
  if (!key) throw new Error("KEEPER_PRIVATE_KEY missing from .env");
  return privateKeyToAccount(key);
}

export function walletClient() {
  return createWalletClient({ chain: bsc, transport: http(RPC_URL), account: keeperAccount() });
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
