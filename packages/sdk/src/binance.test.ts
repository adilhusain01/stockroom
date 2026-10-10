import { test } from "node:test";
import assert from "node:assert/strict";
import { BinanceWeb3Client, buildQuery, preHash, sign } from "./binance.ts";

// Requirement: the signed string is timestamp + METHOD + requestPath (with /build and the raw query) + body,
// exactly as the Binance authentication page shows for its ETH USDT example (read 2026-10-10).
test("pre-hash matches the documented example", () => {
  const pre = preHash("2026-05-11T10:08:57.715Z", "GET", "/build/api/v1/dex/market/price?chainId=1&symbol=ETH%20USDT");
  assert.equal(pre, "2026-05-11T10:08:57.715ZGET/build/api/v1/dex/market/price?chainId=1&symbol=ETH%20USDT");
});

test("signature is base64 HMAC-SHA256 of the pre-hash", () => {
  // independently computed with: printf '%s' "abc" | openssl dgst -sha256 -hmac "key" -binary | base64
  assert.equal(sign("key", "abc"), "nBluMtwBdfhvSxy4konWYZ3mvuaZ5MN45oMJ7Zehpqs=");
});

test("prepare builds the headers, path and query the server expects", () => {
  const client = new BinanceWeb3Client({ apiKey: "k", apiSecret: "s" });
  const now = new Date("2026-05-11T10:08:57.715Z");
  const req = client.prepare("GET", "/api/v1/dex/market/price", { chainId: 1, symbol: "ETH USDT" }, undefined, now);
  assert.equal(req.url, "https://web3.binance.com/build/api/v1/dex/market/price?chainId=1&symbol=ETH%20USDT");
  assert.equal(req.headers["X-OC-APIKEY"], "k");
  assert.equal(req.headers["X-OC-TIMESTAMP"], "2026-05-11T10:08:57.715Z");
  assert.equal(req.headers["X-OC-SIGN"], sign("s", "2026-05-11T10:08:57.715ZGET/build/api/v1/dex/market/price?chainId=1&symbol=ETH%20USDT"));
  assert.equal(req.body, undefined);
});

test("POST bodies are signed and sent as JSON", () => {
  const client = new BinanceWeb3Client({ apiKey: "k", apiSecret: "s" });
  const now = new Date("2026-05-11T10:08:57.715Z");
  const body = { chainId: "56", from: "0xabc" };
  const req = client.prepare("POST", "/api/v1/dex/pre-transaction/simulate", {}, body, now);
  assert.equal(req.url, "https://web3.binance.com/build/api/v1/dex/pre-transaction/simulate");
  assert.equal(req.body, JSON.stringify(body));
  assert.equal(req.headers["Content-Type"], "application/json");
  assert.equal(req.headers["X-OC-SIGN"], sign("s", `2026-05-11T10:08:57.715ZPOST/build/api/v1/dex/pre-transaction/simulate${JSON.stringify(body)}`));
});

test("query encoding skips undefined values", () => {
  assert.equal(buildQuery({ a: 1, b: undefined, c: "x y" }), "?a=1&c=x%20y");
  assert.equal(buildQuery({}), "");
});
