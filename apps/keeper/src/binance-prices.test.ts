import { test } from "node:test";
import assert from "node:assert/strict";
import { anchorWad, toAnswer8 } from "./binance-prices.ts";

test("decimal strings become 8-decimal feed answers without floating point", () => {
  assert.equal(toAnswer8("230.02589067"), 23002589067n);
  assert.equal(toAnswer8("230"), 23000000000n);
  assert.equal(toAnswer8("0.5"), 50000000n);
  assert.equal(toAnswer8("1026.340089210371"), 102634008921n); // extra digits truncated
});

test("anchors scale the underlying price by the multiplier into WAD per raw token", () => {
  // 1 raw NVDAB = 1.001107 shares; NVDA at 229.77 -> 230.024...
  assert.equal(anchorWad("229.77", 1_001_107_000_000_000_000n), 230_024_355_390_000_000_000n / 1n);
  assert.equal(anchorWad("100", 2_000_000_000_000_000_000n), 200_000_000_000_000_000_000n);
});
