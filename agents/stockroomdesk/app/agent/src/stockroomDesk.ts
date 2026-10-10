/**
 * Read-only Stockroom desk tools: the numbers the seller agent uses to write a borrow desk brief.
 *
 * Everything here is a GET against the Stockroom API plus arithmetic. Nothing signs, nothing writes, nothing
 * holds a key. The LLM calls these while producing a paid deliverable; the maths is deterministic so a brief can
 * be checked line by line against the API.
 */

export const STOCKROOM_API = (process.env.STOCKROOM_API ?? "https://stockroom.adilhusain.xyz/api").replace(/\/$/, "");

export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

let fetcher: Fetcher = (url) =>
  fetch(url, { headers: { accept: "application/json", "user-agent": "stockroom-desk-agent/0.1" } });

/** Test seam: replace the HTTP layer. */
export function setFetcher(f: Fetcher): void {
  fetcher = f;
}

type Json = Record<string, unknown>;

export async function fetchJson<T = Json>(path: string): Promise<T> {
  const res = await fetcher(`${STOCKROOM_API}${path}`);
  const body = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) {
    throw new Error(`Stockroom API ${res.status} for ${path}: ${String(body.error ?? "request failed")}`);
  }
  return body as T;
}

const num = (v: unknown, fallback = 0): number => {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : fallback;
};

// --- thin API reads -------------------------------------------------------------------------------------------

/** Live Stockroom market for one bStock ticker such as NVDAB or TSLAB. */
export const stockroomMarket = (ticker: string) => fetchJson(`/markets/${ticker.trim().toUpperCase()}`);
/** Borrow APR, supply APR, utilisation, regime and price for every market in one call. */
export const stockroomRates = () => fetchJson("/rates.json");
/** Reference session state: open or closed, next open, time closed, gap premium. */
export const stockroomSession = () => fetchJson("/session");
/** A wallet's collateral, fees, health factor, short positions and lending positions. */
export const stockroomAccount = (address: string) => fetchJson(`/account/${address.trim()}`);

// --- deterministic maths ----------------------------------------------------------------------------------------

export interface ShortPlanInput {
  priceUsd: number;
  amount: number;
  collateralUsdt: number;
  initialRatio: number;
  liqThreshold: number;
  borrowApr: number;
  days?: number;
  gapPremium?: number;
}

export interface ShortPlan {
  debtUsd: number;
  requiredCollateralUsd: number;
  enoughCollateral: boolean;
  collateralShortfallUsd: number;
  maxAmountForCollateral: number;
  marginAfterUsd: number;
  liquidationPriceUsd: number;
  liquidationPriceWhileClosedUsd: number;
  priceBufferPct: number;
  feeUsdt: number;
  days: number;
}

/**
 * Numbers for shorting `amount` of a stock at `priceUsd` against `collateralUsdt` of USDT.
 *
 * The rules are the ones the contracts apply: the borrow must be covered by collateral worth at least
 * debt x initialRatio before the sale proceeds count (the conservative reading), the proceeds then join the
 * collateral as margin, and the position can be liquidated once margin < debt value x liqThreshold. While the
 * reference market is closed the debt is valued with the gap premium on top, which pulls the liquidation price
 * down. The fee is simple interest on the USD value of the debt for `days` days.
 */
export function shortPlan(i: ShortPlanInput): ShortPlan {
  const days = i.days ?? 3;
  const gap = i.gapPremium ?? 0;
  if (!(i.priceUsd > 0) || !(i.amount > 0) || i.collateralUsdt < 0 || !(i.initialRatio > 0) || !(i.liqThreshold > 0)) {
    throw new Error("price, amount and ratios must be positive and collateral cannot be negative");
  }
  const debtUsd = i.amount * i.priceUsd;
  const required = debtUsd * i.initialRatio;
  const marginAfter = i.collateralUsdt + debtUsd;
  const liq = marginAfter / (i.amount * i.liqThreshold);
  return {
    debtUsd,
    requiredCollateralUsd: required,
    enoughCollateral: i.collateralUsdt >= required,
    collateralShortfallUsd: Math.max(0, required - i.collateralUsdt),
    maxAmountForCollateral: i.collateralUsdt / (i.priceUsd * i.initialRatio),
    marginAfterUsd: marginAfter,
    liquidationPriceUsd: liq,
    liquidationPriceWhileClosedUsd: liq / (1 + gap),
    priceBufferPct: (liq / i.priceUsd - 1) * 100,
    feeUsdt: (debtUsd * i.borrowApr * days) / 365,
    days,
  };
}

function pctDiff(a: unknown, b: unknown): number | null {
  const x = num(a);
  const y = num(b);
  if (x <= 0 || y <= 0) return null;
  return (x / y - 1) * 100;
}

/**
 * Everything needed to write a borrow desk brief for shorting `amount` of `ticker` against `collateralUsdt` USDT
 * for `days` days: regime, whether borrowing is allowed, how much can still be borrowed (the smaller of cap
 * headroom and idle liquidity), APRs, price cross-checks (TWAP and Binance anchor against the relayed feed, in
 * percent), next open, gap premium, and the position numbers. Throws for an unknown ticker.
 */
export async function deskBrief(ticker: string, amount: number, collateralUsdt: number, days = 3) {
  const market = await stockroomMarket(ticker);
  const session = await stockroomSession();
  const price = num(market.price);
  const gap = num(session.gapPremium);
  const plan = shortPlan({
    priceUsd: price,
    amount,
    collateralUsdt,
    initialRatio: num(market.initialRatio, 1.5),
    liqThreshold: num(market.liqThreshold, 1.1),
    borrowApr: num(market.borrowRateApr),
    days,
    gapPremium: gap,
  });
  const capHeadroom = num(market.borrowCapRaw) - num(market.totalBorrows);
  const available = Math.max(0, Math.min(capHeadroom, num(market.idle)));
  const notes: string[] = [];
  if (!market.borrowAllowed) notes.push(`borrowing is off right now (regime ${String(market.regime)}); the brief must say wait`);
  if (market.multiplierPending) notes.push("a dividend or split is scheduled on this token; borrows pause until it applies");
  if (amount > available) notes.push(`only ${available.toFixed(6)} can be borrowed now (cap headroom or idle liquidity); the requested amount does not fit`);
  if (!plan.enoughCollateral) notes.push(`collateral is short by ${plan.collateralShortfallUsd.toFixed(2)} USDT for this size`);
  const tick = String(market.ticker ?? ticker.toUpperCase());
  return {
    ticker: tick,
    regime: market.regime,
    borrowAllowed: Boolean(market.borrowAllowed),
    priceUsedUsd: price,
    borrowAprPct: num(market.borrowRateApr) * 100,
    supplyAprPct: num(market.supplyRateApr) * 100,
    utilisationPct: num(market.utilisation) * 100,
    availableToBorrow: available,
    idle: num(market.idle),
    borrowCap: num(market.borrowCapRaw),
    totalBorrows: num(market.totalBorrows),
    multiplier: market.multiplier,
    multiplierPending: Boolean(market.multiplierPending),
    prices: {
      feedUsd: num(market.feedPrice),
      twapUsd: num(market.twapPrice) || null,
      anchorUsd: num(market.anchorPrice) || null,
      twapVsFeedPct: pctDiff(market.twapPrice, market.feedPrice),
      anchorVsFeedPct: pctDiff(market.anchorPrice, market.feedPrice),
      feedUpdatedAtUnix: market.feedUpdatedAt,
    },
    session: {
      isOpen: Boolean(session.isOpen),
      nextOpenUnix: session.nextOpen,
      closedForSec: session.closedForSec,
      gapPremiumPct: gap * 100,
    },
    plan,
    notes,
    apiCallsToSend: [
      `/tx/deposit-collateral?amount=${collateralUsdt}&account=<wallet>`,
      "/tx/set-operator",
      `/tx/short?ticker=${tick}&amount=${amount}&slippageBps=100`,
    ],
  };
}
