import { config } from "dotenv";
import { resolve } from "node:path";
import { createPublicClient, formatUnits, http, type Address } from "viem";
import { bsc } from "viem/chains";
import {
  bep677Abi,
  ControllerAbi,
  LendingPoolAbi,
  OracleRouterAbi,
  RelayFeedAbi,
  RiskMathRefAbi,
  loadDeployment,
  marketsOf,
  pancakeV3PoolAbi,
} from "@stockroom/sdk";

config({ path: resolve(process.cwd(), "../../.env") });
config({ path: resolve(process.cwd(), ".env"), override: false });

export const RPC_URL = process.env.BSC_RPC_URL ?? "https://bsc-rpc.publicnode.com";
export const client = createPublicClient({ chain: bsc, transport: http(RPC_URL, { batch: true }) });
export const deployment = loadDeployment(process.env.DEPLOYMENT_FILE ?? resolve(process.cwd(), "../../contracts/deployments/56.json"));
export const markets = marketsOf(deployment);

const WAD = 1_000_000_000_000_000_000n;
const REGIMES = ["Open", "Closed", "Paused", "Degraded"] as const;

export interface MarketView {
  ticker: string;
  token: Address;
  lendingPool: Address;
  feed: Address;
  aproFeed: Address | null;
  dexPool: Address;
  multiplier: string; // shares per raw token
  multiplierPending: boolean;
  totalAssets: string; // raw tokens lent into the pool
  idle: string;
  totalBorrows: string;
  utilisation: string; // 0..1
  borrowRateApr: string; // 0..1, yearly, paid in USDT on the USD value of the debt
  supplyRateApr: string; // borrowRate x utilisation x 0.9
  borrowCapRaw: string;
  borrowPaused: boolean;
  price: string; // USD per raw token the risk engine uses
  regime: (typeof REGIMES)[number];
  feedPrice: string;
  feedUpdatedAt: number;
  twapPrice: string | null;
  anchorPrice: string | null;
  borrowAllowed: boolean;
  initialRatio: string;
  liqThreshold: string;
  dexLiquidity: string;
}

function f18(x: bigint) {
  return formatUnits(x, 18);
}

export async function marketViews(): Promise<MarketView[]> {
  const out: MarketView[] = [];
  for (const m of markets) {
    const [multiplier, effectiveAt, market, totalAssets, idle, totalBorrows, util, quote, borrowAllowed, feedData, twap, anchor, liquidity] = await Promise.all([
      client.readContract({ address: m.token, abi: bep677Abi, functionName: "uiMultiplier" }),
      client.readContract({ address: m.token, abi: bep677Abi, functionName: "effectiveAt" }).catch(() => 0n),
      client.readContract({ address: deployment.controller, abi: ControllerAbi, functionName: "market", args: [m.token] }),
      client.readContract({ address: m.lendingPool, abi: LendingPoolAbi, functionName: "totalAssets" }),
      client.readContract({ address: m.lendingPool, abi: LendingPoolAbi, functionName: "idle" }),
      client.readContract({ address: m.lendingPool, abi: LendingPoolAbi, functionName: "totalBorrows" }),
      client.readContract({ address: m.lendingPool, abi: LendingPoolAbi, functionName: "utilisation" }),
      client.readContract({ address: deployment.oracle, abi: OracleRouterAbi, functionName: "quote", args: [m.token] }).catch(() => null),
      client.readContract({ address: deployment.oracle, abi: OracleRouterAbi, functionName: "borrowAllowed", args: [m.token] }).catch(() => false),
      client.readContract({ address: m.feed, abi: RelayFeedAbi, functionName: "latestRoundData" }),
      client.readContract({ address: deployment.oracle, abi: OracleRouterAbi, functionName: "twapPrice", args: [m.token] }).catch(() => [false, 0n] as const),
      client.readContract({ address: deployment.oracle, abi: OracleRouterAbi, functionName: "anchors", args: [m.token] }),
      client.readContract({ address: m.dexPool, abi: pancakeV3PoolAbi, functionName: "liquidity" }).catch(() => 0n),
    ]);
    const borrowRate = await client.readContract({
      address: deployment.riskEngine,
      abi: RiskMathRefAbi,
      functionName: "borrowRate",
      args: [util, market.params.irm],
    });
    const supplyRate = (borrowRate * util * 9000n) / (WAD * 10000n);
    out.push({
      ticker: m.ticker,
      token: m.token,
      lendingPool: m.lendingPool,
      feed: m.feed,
      aproFeed: m.aproFeed,
      dexPool: m.dexPool,
      multiplier: f18(multiplier),
      multiplierPending: effectiveAt > BigInt(Math.floor(Date.now() / 1000)),
      totalAssets: f18(totalAssets),
      idle: f18(idle),
      totalBorrows: f18(totalBorrows),
      utilisation: f18(util),
      borrowRateApr: f18(borrowRate),
      supplyRateApr: f18(supplyRate),
      borrowCapRaw: f18(market.params.borrowCapRaw),
      borrowPaused: market.borrowPaused,
      price: quote ? f18(quote.priceWad) : "0",
      regime: quote ? REGIMES[quote.regime] : "Degraded",
      feedPrice: formatUnits(feedData[1], 8),
      feedUpdatedAt: Number(feedData[3]),
      twapPrice: twap[0] ? f18(twap[1]) : null,
      anchorPrice: anchor[1] > 0n ? f18(anchor[0]) : null,
      borrowAllowed,
      initialRatio: f18(market.params.initialRatioWad),
      liqThreshold: f18(market.params.liqThresholdWad),
      dexLiquidity: liquidity.toString(),
    });
  }
  return out;
}

export interface AccountView {
  address: Address;
  collateral: string;
  pendingFees: string;
  unpaidFees: string;
  healthFactor: string | null; // null when there is no debt
  auctionStartedAt: number;
  positions: { ticker: string; token: Address; debtRaw: string; priceUsd: string; valueUsd: string }[];
  lending: { ticker: string; lendingPool: Address; shares: string; assets: string; effectiveShares: string; claimableUsdt: string }[];
}

export async function accountView(address: Address): Promise<AccountView> {
  const [collateral, pendingFees, unpaidFees, health, auctionStart, borrowed] = await Promise.all([
    client.readContract({ address: deployment.controller, abi: ControllerAbi, functionName: "collateralOf", args: [address] }),
    client.readContract({ address: deployment.controller, abi: ControllerAbi, functionName: "pendingFees", args: [address] }),
    client.readContract({ address: deployment.controller, abi: ControllerAbi, functionName: "unpaidFeesOf", args: [address] }),
    client.readContract({ address: deployment.controller, abi: ControllerAbi, functionName: "healthFactor", args: [address] }),
    client.readContract({ address: deployment.controller, abi: ControllerAbi, functionName: "auctionStartOf", args: [address] }),
    client.readContract({ address: deployment.controller, abi: ControllerAbi, functionName: "borrowedTokens", args: [address] }),
  ]);
  const positions = [];
  for (const token of borrowed) {
    const m = markets.find((x) => x.token.toLowerCase() === token.toLowerCase());
    const [debt, quote] = await Promise.all([
      client.readContract({ address: deployment.controller, abi: ControllerAbi, functionName: "positionOf", args: [address, token] }),
      client.readContract({ address: deployment.oracle, abi: OracleRouterAbi, functionName: "quote", args: [token] }).catch(() => null),
    ]);
    const price = quote?.priceWad ?? 0n;
    positions.push({ ticker: m?.ticker ?? token, token, debtRaw: f18(debt), priceUsd: f18(price), valueUsd: f18((debt * price) / WAD) });
  }
  const lending = [];
  for (const m of markets) {
    const shares = await client.readContract({ address: m.lendingPool, abi: LendingPoolAbi, functionName: "balanceOf", args: [address] });
    if (shares === 0n) continue;
    const [assets, effective, claimable] = await Promise.all([
      client.readContract({ address: m.lendingPool, abi: LendingPoolAbi, functionName: "convertToAssets", args: [shares] }),
      client.readContract({ address: m.lendingPool, abi: LendingPoolAbi, functionName: "balanceOfUI", args: [address] }),
      client.readContract({ address: m.lendingPool, abi: LendingPoolAbi, functionName: "claimable", args: [address] }),
    ]);
    lending.push({ ticker: m.ticker, lendingPool: m.lendingPool, shares: formatUnits(shares, 24), assets: f18(assets), effectiveShares: f18(effective), claimableUsdt: f18(claimable) });
  }
  const maxUint = (1n << 256n) - 1n;
  return {
    address,
    collateral: f18(collateral),
    pendingFees: f18(pendingFees),
    unpaidFees: f18(unpaidFees),
    healthFactor: health === maxUint ? null : f18(health),
    auctionStartedAt: Number(auctionStart),
    positions,
    lending,
  };
}
