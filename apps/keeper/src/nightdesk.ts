import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { encodeFunctionData, formatUnits, parseAbi, parseUnits, type Address, type Hex } from "viem";
import { bep677Abi, ControllerAbi, LendingPoolAbi, MarketCalendarAbi, OracleRouterAbi, pancakeV3PoolAbi } from "@stockroom/sdk";
import { deployment, keeperAccount, log, markets, publicClient, walletClient } from "./env.ts";

/**
 * Night Desk: the first borrower on Stockroom. Every Friday after the US close it borrows bStocks against USDT,
 * puts them to work as PancakeSwap v3 liquidity while Wall Street is shut (the weekend flow keeps paying fees
 * while the price sits near the last close), pulls the liquidity before the Monday open, buys back any
 * shortfall and repays. The borrow fee it pays is the lenders' yield. It registers an ERC-8004 identity on BSC
 * so other agents can find and rate it.
 *
 *   pnpm keeper nightdesk plan     print what it would do now
 *   pnpm keeper nightdesk run      act on the current state (idempotent; run it every few minutes)
 *   pnpm keeper nightdesk close    unwind whatever is open right now
 *   pnpm keeper nightdesk register register the ERC-8004 identity (once)
 */
const POSITION_MANAGER: Address = "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364"; // PancakeSwap v3 NonfungiblePositionManager
const ERC8004_REGISTRY: Address = (process.env.ERC8004_REGISTRY as Address) ?? "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const SWAP_ROUTER: Address = "0x1b81D678ffb9C0263b24A97847620C99d213eB14";
const WAD = 1_000_000_000_000_000_000n;

const positionManagerAbi = parseAbi([
  "function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline) params) payable returns (uint256 tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)",
  "function decreaseLiquidity((uint256 tokenId,uint128 liquidity,uint256 amount0Min,uint256 amount1Min,uint256 deadline) params) payable returns (uint256 amount0,uint256 amount1)",
  "function collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max) params) payable returns (uint256 amount0,uint256 amount1)",
  "function burn(uint256 tokenId) payable",
  "function positions(uint256 tokenId) view returns (uint96 nonce,address operator,address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint128 liquidity,uint256 feeGrowthInside0LastX128,uint256 feeGrowthInside1LastX128,uint128 tokensOwed0,uint128 tokensOwed1)",
]);
const swapRouterAbi = parseAbi([
  "function exactOutputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountOut,uint256 amountInMaximum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountIn)",
]);
const registryAbi = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "function balanceOf(address owner) view returns (uint256)",
]);

interface DeskState {
  phase: "idle" | "open";
  ticker?: string;
  tokenId?: string;
  borrowedRaw?: string;
  collateralUsdt?: string;
  openedAt?: number;
  agentId?: string;
  history: { at: number; event: string; detail?: string }[];
}

const RUNS = resolve(process.cwd(), "runs");
const STATE_FILE = resolve(RUNS, "nightdesk.json");

function loadState(): DeskState {
  if (!existsSync(STATE_FILE)) return { phase: "idle", history: [] };
  return JSON.parse(readFileSync(STATE_FILE, "utf8"));
}

function saveState(s: DeskState) {
  mkdirSync(RUNS, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

function note(s: DeskState, event: string, detail?: string) {
  s.history.push({ at: Math.floor(Date.now() / 1000), event, detail });
  log("nightdesk", event, detail ?? "");
  saveState(s);
}

export interface DeskConfig {
  ticker: string;
  borrowAmount: string; // whole tokens
  collateralUsdt: string; // whole USDT
  rangeBps: number; // half-width of the LP range around the current tick
  fee: number; // pool fee tier
  closeBeforeOpenSec: number; // unwind this long before the next session open
}

export function deskConfig(): DeskConfig {
  return {
    ticker: process.env.NIGHTDESK_TICKER ?? "NVDAB",
    borrowAmount: process.env.NIGHTDESK_BORROW ?? "0.5",
    collateralUsdt: process.env.NIGHTDESK_COLLATERAL ?? "250",
    rangeBps: Number(process.env.NIGHTDESK_RANGE_BPS ?? 200),
    fee: Number(process.env.NIGHTDESK_FEE ?? 2500),
    closeBeforeOpenSec: Number(process.env.NIGHTDESK_CLOSE_BEFORE_OPEN_SEC ?? 7200),
  };
}

async function sessionInfo() {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const d = deployment();
  const [isOpen, nextOpen] = await Promise.all([
    publicClient.readContract({ address: d.calendar, abi: MarketCalendarAbi, functionName: "isOpen", args: [now] }),
    publicClient.readContract({ address: d.calendar, abi: MarketCalendarAbi, functionName: "nextOpen", args: [now] }),
  ]);
  return { now, isOpen, nextOpen, secondsToOpen: nextOpen - now };
}

/** Ticks rounded to the pool's spacing (50 for the 0.25 percent tier, 1 for 0.01 percent). */
export function rangeTicks(currentTick: number, rangeBps: number, fee: number): { lower: number; upper: number } {
  const spacing = fee === 100 ? 1 : fee === 500 ? 10 : fee === 2500 ? 50 : 200;
  const width = Math.round(Math.log(1 + rangeBps / 10_000) / Math.log(1.0001));
  const lower = Math.floor((currentTick - width) / spacing) * spacing;
  const upper = Math.ceil((currentTick + width) / spacing) * spacing;
  return { lower, upper: upper === lower ? lower + spacing : upper };
}

export async function plan(): Promise<string> {
  const cfg = deskConfig();
  const s = loadState();
  const sess = await sessionInfo();
  const m = markets().find((x) => x.ticker === cfg.ticker);
  if (!m) return `unknown ticker ${cfg.ticker}`;
  const d = deployment();
  const [allowed, quote, idle, borrowed] = await Promise.all([
    publicClient.readContract({ address: d.oracle, abi: OracleRouterAbi, functionName: "borrowAllowed", args: [m.token] }).catch(() => false),
    publicClient.readContract({ address: d.oracle, abi: OracleRouterAbi, functionName: "quote", args: [m.token] }).catch(() => null),
    publicClient.readContract({ address: m.lendingPool, abi: LendingPoolAbi, functionName: "idle" }),
    publicClient.readContract({ address: d.controller, abi: ControllerAbi, functionName: "positionOf", args: [keeperAccount().address, m.token] }),
  ]);
  const lines = [
    `phase ${s.phase}, session ${sess.isOpen ? "open" : "closed"}, next open in ${(Number(sess.secondsToOpen) / 3600).toFixed(1)}h`,
    `${cfg.ticker}: borrowAllowed ${allowed}, price ${quote ? formatUnits(quote.priceWad, 18) : "n/a"}, idle ${formatUnits(idle, 18)}, our debt ${formatUnits(borrowed, 18)}`,
  ];
  if (s.phase === "idle") {
    if (sess.isOpen) lines.push("wait: the desk only works the closed session");
    else if (!allowed) lines.push("wait: borrows are not allowed right now");
    else if (idle < parseUnits(cfg.borrowAmount, 18)) lines.push("wait: not enough idle liquidity to borrow");
    else lines.push(`would borrow ${cfg.borrowAmount} ${cfg.ticker} against ${cfg.collateralUsdt} USDT and LP it +-${cfg.rangeBps} bps`);
  } else {
    lines.push(sess.secondsToOpen <= BigInt(cfg.closeBeforeOpenSec) ? "would unwind now (open is near)" : "holding the LP position");
  }
  return lines.join("\n");
}

async function send(to: Address, data: Hex, what: string): Promise<Hex> {
  const wallet = walletClient();
  const hash = await wallet.sendTransaction({ to, data });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${what} reverted: ${hash}`);
  log("nightdesk tx", what, hash);
  return hash;
}

async function approve(token: Address, spender: Address, amount: bigint, what: string) {
  await send(token, encodeFunctionData({ abi: bep677Abi, functionName: "approve", args: [spender, amount] }), `approve ${what}`);
}

export async function open(): Promise<void> {
  const cfg = deskConfig();
  const s = loadState();
  if (s.phase !== "idle") throw new Error("already open");
  const m = markets().find((x) => x.ticker === cfg.ticker);
  if (!m) throw new Error(`unknown ticker ${cfg.ticker}`);
  const d = deployment();
  const me = keeperAccount().address;
  const borrowRaw = parseUnits(cfg.borrowAmount, 18);
  const collateral = parseUnits(cfg.collateralUsdt, 18);

  await approve(d.usdt, d.controller, collateral, "USDT collateral");
  await send(d.controller, encodeFunctionData({ abi: ControllerAbi, functionName: "depositCollateral", args: [collateral, me] }), "deposit collateral");
  await send(d.controller, encodeFunctionData({ abi: ControllerAbi, functionName: "borrow", args: [m.token, borrowRaw, me] }), `borrow ${cfg.borrowAmount} ${cfg.ticker}`);
  note(s, "borrowed", `${cfg.borrowAmount} ${cfg.ticker} against ${cfg.collateralUsdt} USDT`);

  const [slot0, token0] = await Promise.all([
    publicClient.readContract({ address: m.dexPool, abi: pancakeV3PoolAbi, functionName: "slot0" }),
    publicClient.readContract({ address: m.dexPool, abi: pancakeV3PoolAbi, functionName: "token0" }),
  ]);
  const stockIsToken0 = token0.toLowerCase() === m.token.toLowerCase();
  const { lower, upper } = rangeTicks(slot0[1], cfg.rangeBps, cfg.fee);
  const price = await publicClient.readContract({ address: d.oracle, abi: OracleRouterAbi, functionName: "quote", args: [m.token] });
  const usdtSide = (borrowRaw * price.priceWad) / WAD; // pair the stock with the same value in USDT
  const usdtBalance = await publicClient.readContract({ address: d.usdt, abi: bep677Abi, functionName: "balanceOf", args: [me] });
  const usdtAmount = usdtSide < usdtBalance ? usdtSide : usdtBalance;

  await approve(m.token, POSITION_MANAGER, borrowRaw, `${cfg.ticker} for the LP`);
  await approve(d.usdt, POSITION_MANAGER, usdtAmount, "USDT for the LP");
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const params = {
    token0: stockIsToken0 ? m.token : d.usdt,
    token1: stockIsToken0 ? d.usdt : m.token,
    fee: cfg.fee,
    tickLower: lower,
    tickUpper: upper,
    amount0Desired: stockIsToken0 ? borrowRaw : usdtAmount,
    amount1Desired: stockIsToken0 ? usdtAmount : borrowRaw,
    amount0Min: 0n,
    amount1Min: 0n,
    recipient: me,
    deadline,
  };
  const { result } = await publicClient.simulateContract({ address: POSITION_MANAGER, abi: positionManagerAbi, functionName: "mint", args: [params], account: me });
  await send(POSITION_MANAGER, encodeFunctionData({ abi: positionManagerAbi, functionName: "mint", args: [params] }), "mint LP position");
  s.phase = "open";
  s.ticker = cfg.ticker;
  s.tokenId = result[0].toString();
  s.borrowedRaw = borrowRaw.toString();
  s.collateralUsdt = collateral.toString();
  s.openedAt = Math.floor(Date.now() / 1000);
  note(s, "lp-opened", `tokenId ${s.tokenId}, ticks ${lower}..${upper}, liquidity ${result[1]}`);
}

export async function close(): Promise<void> {
  const s = loadState();
  if (s.phase !== "open" || !s.tokenId || !s.ticker) throw new Error("nothing open");
  const m = markets().find((x) => x.ticker === s.ticker);
  if (!m) throw new Error(`unknown ticker ${s.ticker}`);
  const d = deployment();
  const me = keeperAccount().address;
  const tokenId = BigInt(s.tokenId);
  const pos = await publicClient.readContract({ address: POSITION_MANAGER, abi: positionManagerAbi, functionName: "positions", args: [tokenId] });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  if (pos[7] > 0n) {
    await send(POSITION_MANAGER, encodeFunctionData({ abi: positionManagerAbi, functionName: "decreaseLiquidity", args: [{ tokenId, liquidity: pos[7], amount0Min: 0n, amount1Min: 0n, deadline }] }), "remove liquidity");
  }
  const max = (1n << 128n) - 1n;
  await send(POSITION_MANAGER, encodeFunctionData({ abi: positionManagerAbi, functionName: "collect", args: [{ tokenId, recipient: me, amount0Max: max, amount1Max: max }] }), "collect tokens and fees");
  await send(POSITION_MANAGER, encodeFunctionData({ abi: positionManagerAbi, functionName: "burn", args: [tokenId] }), "burn position").catch((e) => log("burn skipped:", (e as Error).message.split("\n")[0]));
  note(s, "lp-closed", `tokenId ${s.tokenId}`);

  // buy back whatever the pool took, then repay in full
  const debt = await publicClient.readContract({ address: d.controller, abi: ControllerAbi, functionName: "positionOf", args: [me, m.token] });
  const have = await publicClient.readContract({ address: m.token, abi: bep677Abi, functionName: "balanceOf", args: [me] });
  if (have < debt) {
    const shortfall = debt - have;
    const price = await publicClient.readContract({ address: d.oracle, abi: OracleRouterAbi, functionName: "quote", args: [m.token] });
    const maxIn = (shortfall * price.priceWad * 103n) / (WAD * 100n);
    await approve(d.usdt, SWAP_ROUTER, maxIn, "USDT for the buyback");
    await send(
      SWAP_ROUTER,
      encodeFunctionData({ abi: swapRouterAbi, functionName: "exactOutputSingle", args: [{ tokenIn: d.usdt, tokenOut: m.token, fee: deskConfig().fee, recipient: me, deadline, amountOut: shortfall, amountInMaximum: maxIn, sqrtPriceLimitX96: 0n }] }),
      `buy back ${formatUnits(shortfall, 18)} ${m.ticker}`,
    );
  }
  await approve(m.token, d.controller, debt, `${m.ticker} to repay`);
  await send(d.controller, encodeFunctionData({ abi: ControllerAbi, functionName: "repay", args: [m.token, debt, me] }), "repay");
  const collateral = await publicClient.readContract({ address: d.controller, abi: ControllerAbi, functionName: "collateralOf", args: [me] });
  if (collateral > 0n) {
    await send(d.controller, encodeFunctionData({ abi: ControllerAbi, functionName: "withdrawCollateral", args: [collateral, me] }), "withdraw collateral");
  }
  const usdtAfter = await publicClient.readContract({ address: d.usdt, abi: bep677Abi, functionName: "balanceOf", args: [me] });
  s.phase = "idle";
  note(s, "closed", `repaid ${formatUnits(debt, 18)} ${m.ticker}; USDT balance now ${formatUnits(usdtAfter, 18)}`);
  delete s.tokenId;
  delete s.borrowedRaw;
  delete s.collateralUsdt;
  saveState(s);
}

/** One idempotent step of the weekend state machine. */
export async function run(): Promise<number> {
  const cfg = deskConfig();
  const s = loadState();
  const sess = await sessionInfo();
  if (s.phase === "idle") {
    if (sess.isOpen) return 0;
    const m = markets().find((x) => x.ticker === cfg.ticker);
    if (!m) throw new Error(`unknown ticker ${cfg.ticker}`);
    const allowed = await publicClient.readContract({ address: deployment().oracle, abi: OracleRouterAbi, functionName: "borrowAllowed", args: [m.token] }).catch(() => false);
    if (!allowed || sess.secondsToOpen <= BigInt(cfg.closeBeforeOpenSec)) return 0;
    await open();
    return 1;
  }
  if (sess.secondsToOpen <= BigInt(cfg.closeBeforeOpenSec) || sess.isOpen) {
    await close();
    return 1;
  }
  return 0;
}

/** Register the desk as an ERC-8004 agent (once). The agent URI points at the API's agent card. */
export async function register(): Promise<string> {
  const s = loadState();
  const me = keeperAccount().address;
  const already = await publicClient.readContract({ address: ERC8004_REGISTRY, abi: registryAbi, functionName: "balanceOf", args: [me] });
  if (already > 0n && s.agentId) return `already registered as agent ${s.agentId}`;
  const uri = process.env.NIGHTDESK_AGENT_URI ?? "https://stockroom.adilhusain.xyz/api/agent-card.json";
  const { result } = await publicClient.simulateContract({ address: ERC8004_REGISTRY, abi: registryAbi, functionName: "register", args: [uri], account: me });
  await send(ERC8004_REGISTRY, encodeFunctionData({ abi: registryAbi, functionName: "register", args: [uri] }), "register ERC-8004 identity");
  s.agentId = result.toString();
  note(s, "registered", `ERC-8004 agent ${s.agentId} at ${ERC8004_REGISTRY}`);
  return `registered agent ${s.agentId}`;
}
