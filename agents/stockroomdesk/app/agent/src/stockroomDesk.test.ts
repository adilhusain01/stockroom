/** Unit tests for the Stockroom desk tools. Run with: pnpm test (node:test through tsx). No network. */
import test from "node:test";
import assert from "node:assert/strict";
import * as desk from "./stockroomDesk.js";

const MARKET = {
  ticker: "NVDAB",
  price: "230",
  feedPrice: "230",
  twapPrice: "231.15",
  anchorPrice: "229.54",
  regime: "Closed",
  borrowAllowed: true,
  initialRatio: "1.5",
  liqThreshold: "1.1",
  borrowRateApr: "0.2",
  supplyRateApr: "0.036",
  utilisation: "0.2",
  borrowCapRaw: "0.05",
  totalBorrows: "0.01",
  idle: "0.04",
  multiplier: "1.0011",
  multiplierPending: false,
};
const SESSION = { now: 1760100000, isOpen: false, nextOpen: 1760108400, closedForSec: 3600, gapPremium: "0.05" };

function stub(routes: Record<string, unknown>) {
  desk.setFetcher(async (url) => {
    const hit = Object.entries(routes).find(([suffix]) => url.endsWith(suffix));
    if (hit) return { ok: true, status: 200, json: async () => hit[1] };
    return { ok: false, status: 404, json: async () => ({ error: "unknown market" }) };
  });
}

test("short plan numbers for a small NVDAB short", () => {
  const p = desk.shortPlan({ priceUsd: 230, amount: 0.01, collateralUsdt: 10, initialRatio: 1.5, liqThreshold: 1.1, borrowApr: 0.2, days: 3 });
  assert.ok(Math.abs(p.debtUsd - 2.3) < 1e-9);
  assert.ok(Math.abs(p.requiredCollateralUsd - 3.45) < 1e-9);
  assert.equal(p.enoughCollateral, true);
  assert.ok(Math.abs(p.marginAfterUsd - 12.3) < 1e-9, "sale proceeds join the collateral");
  assert.ok(Math.abs(p.liquidationPriceUsd - 12.3 / (0.01 * 1.1)) < 1e-6, "liquidation when margin < debt x threshold");
  assert.ok(Math.abs(p.feeUsdt - (2.3 * 0.2 * 3) / 365) < 1e-12);
  assert.ok(Math.abs(p.maxAmountForCollateral - 10 / (230 * 1.5)) < 1e-12);
});

test("the gap premium lowers the liquidation price while the market is closed", () => {
  const p = desk.shortPlan({ priceUsd: 230, amount: 0.01, collateralUsdt: 10, initialRatio: 1.5, liqThreshold: 1.1, borrowApr: 0.2, gapPremium: 0.05 });
  assert.ok(Math.abs(p.liquidationPriceWhileClosedUsd - p.liquidationPriceUsd / 1.05) < 1e-9);
});

test("too little collateral is flagged, not hidden", () => {
  const p = desk.shortPlan({ priceUsd: 230, amount: 1, collateralUsdt: 10, initialRatio: 1.5, liqThreshold: 1.1, borrowApr: 0.2 });
  assert.equal(p.enoughCollateral, false);
  assert.ok(Math.abs(p.requiredCollateralUsd - 345) < 1e-9);
  assert.ok(Math.abs(p.collateralShortfallUsd - 335) < 1e-9);
});

test("nonsense inputs are refused", () => {
  assert.throws(() => desk.shortPlan({ priceUsd: 0, amount: 1, collateralUsdt: 10, initialRatio: 1.5, liqThreshold: 1.1, borrowApr: 0.2 }));
  assert.throws(() => desk.shortPlan({ priceUsd: 230, amount: -1, collateralUsdt: 10, initialRatio: 1.5, liqThreshold: 1.1, borrowApr: 0.2 }));
});

test("the desk brief combines market, session and plan", async () => {
  stub({ "/markets/NVDAB": MARKET, "/session": SESSION });
  const b = await desk.deskBrief("nvdab", 0.01, 10, 3);
  assert.equal(b.ticker, "NVDAB");
  assert.equal(b.regime, "Closed");
  assert.equal(b.borrowAllowed, true);
  assert.ok(Math.abs(b.availableToBorrow - 0.04) < 1e-12, "min(cap headroom, idle)");
  assert.ok(Math.abs(b.borrowAprPct - 20) < 1e-9);
  assert.ok(Math.abs((b.prices.twapVsFeedPct ?? 0) - (231.15 / 230 - 1) * 100) < 1e-9);
  assert.ok(Math.abs((b.prices.anchorVsFeedPct ?? 0) - (229.54 / 230 - 1) * 100) < 1e-9);
  assert.equal(b.session.nextOpenUnix, 1760108400);
  assert.ok(Math.abs(b.session.gapPremiumPct - 5) < 1e-9);
  assert.ok(Math.abs(b.plan.liquidationPriceUsd - 12.3 / (0.01 * 1.1)) < 1e-6);
  assert.deepEqual(b.notes, []);
  assert.ok(b.apiCallsToSend[2].includes("ticker=NVDAB&amount=0.01"));
});

test("a request that does not fit is explained in the notes", async () => {
  stub({ "/markets/NVDAB": { ...MARKET, borrowAllowed: false, regime: "Degraded" }, "/session": SESSION });
  const b = await desk.deskBrief("NVDAB", 1, 10);
  assert.equal(b.borrowAllowed, false);
  assert.ok(b.notes.some((n) => n.includes("borrowing is off")));
  assert.ok(b.notes.some((n) => n.includes("does not fit")));
  assert.ok(b.notes.some((n) => n.includes("collateral is short")));
});

test("an unknown ticker is a clear error", async () => {
  stub({ "/session": SESSION });
  await assert.rejects(() => desk.deskBrief("AAPLB", 0.01, 10), /unknown market/);
});
