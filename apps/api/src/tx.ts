import { encodeFunctionData, encodePacked, parseUnits, type Address, type Hex } from "viem";
import { bep677Abi, ControllerAbi, LendingPoolAbi, OracleRouterAbi, ShortRouterAbi } from "@stockroom/sdk";
import { client, deployment, markets } from "./chain.ts";

/**
 * Calldata builders for wallets that only know how to send a prepared transaction (the Binance Agentic Wallet's
 * `contract-call preview --to --inputData`, the web app, or any other signer). Nothing here signs or sends.
 */
export interface PreparedTx {
  to: Address;
  data: Hex;
  value: "0";
  chainId: 56;
  description: string;
}

const WAD = 1_000_000_000_000_000_000n;
const MAX = (1n << 256n) - 1n;

export function marketByTicker(ticker: string) {
  const m = markets.find((x) => x.ticker === ticker.toUpperCase());
  if (!m) throw new Error(`unknown market ${ticker}`);
  return m;
}

function poolFee(ticker: string): number {
  const fees = (process.env.POOL_FEES ?? "").split(",").map((x) => Number(x)).filter((x) => x > 0);
  const idx = markets.findIndex((m) => m.ticker === ticker.toUpperCase());
  return fees[idx] ?? 2500;
}

export function approveTx(token: Address, spender: Address, amount: bigint, what: string): PreparedTx {
  return {
    to: token,
    data: encodeFunctionData({ abi: bep677Abi, functionName: "approve", args: [spender, amount] }),
    value: "0",
    chainId: 56,
    description: `Approve ${what}`,
  };
}

/** Lend: approve the pool, then deposit raw units. `amount` is in whole tokens ("1.5"). */
export function lendTxs(ticker: string, amount: string, receiver: Address): PreparedTx[] {
  const m = marketByTicker(ticker);
  const raw = parseUnits(amount, 18);
  return [
    approveTx(m.token, m.lendingPool, raw, `${amount} ${m.ticker} for the Stockroom ${m.ticker} pool`),
    {
      to: m.lendingPool,
      data: encodeFunctionData({ abi: LendingPoolAbi, functionName: "deposit", args: [raw, receiver] }),
      value: "0",
      chainId: 56,
      description: `Lend ${amount} ${m.ticker}: receive s${m.ticker} shares, earn USDT while borrowed`,
    },
  ];
}

export function withdrawLendTx(ticker: string, amount: string, owner: Address): PreparedTx {
  const m = marketByTicker(ticker);
  const raw = parseUnits(amount, 18);
  return {
    to: m.lendingPool,
    data: encodeFunctionData({ abi: LendingPoolAbi, functionName: "withdraw", args: [raw, owner, owner] }),
    value: "0",
    chainId: 56,
    description: `Withdraw ${amount} ${m.ticker} from the pool (limited by idle liquidity)`,
  };
}

export function claimTx(ticker: string, to: Address): PreparedTx {
  const m = marketByTicker(ticker);
  return {
    to: m.lendingPool,
    data: encodeFunctionData({ abi: LendingPoolAbi, functionName: "claim", args: [to] }),
    value: "0",
    chainId: 56,
    description: `Claim accrued USDT lending fees for ${m.ticker}`,
  };
}

export function depositCollateralTxs(amountUsdt: string, onBehalfOf: Address): PreparedTx[] {
  const raw = parseUnits(amountUsdt, 18);
  return [
    approveTx(deployment.usdt, deployment.controller, raw, `${amountUsdt} USDT for Stockroom collateral`),
    {
      to: deployment.controller,
      data: encodeFunctionData({ abi: ControllerAbi, functionName: "depositCollateral", args: [raw, onBehalfOf] }),
      value: "0",
      chainId: 56,
      description: `Deposit ${amountUsdt} USDT as collateral`,
    },
  ];
}

export function withdrawCollateralTx(amountUsdt: string, to: Address): PreparedTx {
  const raw = parseUnits(amountUsdt, 18);
  return {
    to: deployment.controller,
    data: encodeFunctionData({ abi: ControllerAbi, functionName: "withdrawCollateral", args: [raw, to] }),
    value: "0",
    chainId: 56,
    description: `Withdraw ${amountUsdt} USDT of collateral (must keep the initial ratio)`,
  };
}

export function borrowTx(ticker: string, amount: string, to: Address): PreparedTx {
  const m = marketByTicker(ticker);
  return {
    to: deployment.controller,
    data: encodeFunctionData({ abi: ControllerAbi, functionName: "borrow", args: [m.token, parseUnits(amount, 18), to] }),
    value: "0",
    chainId: 56,
    description: `Borrow ${amount} ${m.ticker} against USDT collateral and take delivery`,
  };
}

export function repayTxs(ticker: string, amount: string | "all", onBehalfOf: Address): PreparedTx[] {
  const m = marketByTicker(ticker);
  const raw = amount === "all" ? MAX : parseUnits(amount, 18);
  return [
    approveTx(m.token, deployment.controller, raw, `${amount === "all" ? "all" : amount} ${m.ticker} to repay`),
    {
      to: deployment.controller,
      data: encodeFunctionData({ abi: ControllerAbi, functionName: "repay", args: [m.token, raw, onBehalfOf] }),
      value: "0",
      chainId: 56,
      description: `Repay ${amount === "all" ? "all" : amount} ${m.ticker}`,
    },
  ];
}

export function setOperatorTx(): PreparedTx {
  return {
    to: deployment.controller,
    data: encodeFunctionData({ abi: ControllerAbi, functionName: "setOperator", args: [deployment.shortRouter, true] }),
    value: "0",
    chainId: 56,
    description: "Allow the Stockroom ShortRouter to short and cover for this account (one-time)",
  };
}

/** Short: borrow and sell on PancakeSwap in one transaction. `slippageBps` guards the proceeds. */
export async function shortTx(ticker: string, amount: string, slippageBps = 100): Promise<PreparedTx> {
  const m = marketByTicker(ticker);
  const raw = parseUnits(amount, 18);
  const price = await referencePrice(m.token);
  const minOut = (raw * price * BigInt(10_000 - slippageBps)) / (WAD * 10_000n);
  const path = encodePacked(["address", "uint24", "address"], [m.token, poolFee(m.ticker), deployment.usdt]);
  return {
    to: deployment.shortRouter,
    data: encodeFunctionData({ abi: ShortRouterAbi, functionName: "short", args: [m.token, raw, path, minOut] }),
    value: "0",
    chainId: 56,
    description: `Short ${amount} ${m.ticker}: borrow, sell for at least ${(Number(minOut) / 1e18).toFixed(2)} USDT, proceeds become margin`,
  };
}

/** Cover: buy back on PancakeSwap and repay in one transaction. `slippageBps` caps the USDT spent. */
export async function coverTx(ticker: string, amount: string, slippageBps = 100): Promise<PreparedTx> {
  const m = marketByTicker(ticker);
  const raw = parseUnits(amount, 18);
  const price = await referencePrice(m.token);
  const maxIn = (raw * price * BigInt(10_000 + slippageBps)) / (WAD * 10_000n);
  const path = encodePacked(["address", "uint24", "address"], [m.token, poolFee(m.ticker), deployment.usdt]);
  return {
    to: deployment.shortRouter,
    data: encodeFunctionData({ abi: ShortRouterAbi, functionName: "cover", args: [m.token, raw, path, maxIn] }),
    value: "0",
    chainId: 56,
    description: `Cover ${amount} ${m.ticker}: buy back for at most ${(Number(maxIn) / 1e18).toFixed(2)} USDT of collateral and repay`,
  };
}

/** The on-chain price the router uses, or the TWAP if the feed is not relayed yet. */
async function referencePrice(token: Address): Promise<bigint> {
  try {
    const q = await client.readContract({ address: deployment.oracle, abi: OracleRouterAbi, functionName: "quote", args: [token] });
    return q.priceWad;
  } catch {
    const [ok, twap] = await client.readContract({ address: deployment.oracle, abi: OracleRouterAbi, functionName: "twapPrice", args: [token] });
    if (!ok) throw new Error("no price available for this market yet");
    return twap;
  }
}
