import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Address } from "viem";

/** Shape of contracts/deployments/<chainId>.json written by DeployBsc.s.sol. */
export interface Deployment {
  chainId: number;
  deployer: Address;
  keeper: Address;
  usdt: Address;
  swapRouter: Address;
  calendar: Address;
  oracle: Address;
  riskEngine: Address;
  controller: Address;
  shortRouter: Address;
  liquidator: Address;
  usdtFeed: Address;
  usdtAproFeed: Address;
  tickers: string[];
  tokens: Address[];
  aproFeeds: Address[];
  dexPools: Address[];
  feeds: Address[];
  lendingPools: Address[];
}

export interface Market {
  ticker: string;
  token: Address;
  aproFeed: Address | null;
  dexPool: Address;
  feed: Address;
  lendingPool: Address;
}

const ZERO = "0x0000000000000000000000000000000000000000";

export function loadDeployment(path?: string): Deployment {
  const file = path ?? process.env.DEPLOYMENT_FILE ?? resolve(process.cwd(), "../../contracts/deployments/56.json");
  const raw = JSON.parse(readFileSync(file, "utf8"));
  return raw as Deployment;
}

export function marketsOf(d: Deployment): Market[] {
  return d.tickers.map((ticker, i) => ({
    ticker,
    token: d.tokens[i],
    aproFeed: d.aproFeeds[i] && d.aproFeeds[i].toLowerCase() !== ZERO ? d.aproFeeds[i] : null,
    dexPool: d.dexPools[i],
    feed: d.feeds[i],
    lendingPool: d.lendingPools[i],
  }));
}
