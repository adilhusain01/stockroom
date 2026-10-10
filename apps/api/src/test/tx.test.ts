/**
 * Transaction builders and the /tx routes, against a fixture deployment. Nothing here touches the network: the
 * builders only encode calldata, and the Binance key is blanked so the dry-run path reports UNAVAILABLE.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodeFunctionData, getAddress, parseUnits } from "viem";
import type { PreparedTx } from "../tx.ts";

const here = import.meta.dirname;
process.env.DEPLOYMENT_FILE = resolve(here, "fixtures/deployment.json");
process.env.BINANCE_WEB3_API_KEY = "";
process.env.BINANCE_WEB3_API_SECRET = "";
process.env.API_NO_LISTEN = "1";

const fixture = JSON.parse(readFileSync(process.env.DEPLOYMENT_FILE, "utf8"));
const tx = await import("../tx.ts");
const { default: app } = await import("../server.ts");
const { ControllerAbi, LendingPoolAbi, bep677Abi } = await import("@stockroom/sdk");

// decoded calldata comes back checksummed, the fixture is lowercase: compare through getAddress
const USER = getAddress("0x1111111111111111111111111111111111111111");
const NVDAB = getAddress(fixture.tokens[0]);
const POOL = getAddress(fixture.lendingPools[0]);
const CONTROLLER = getAddress(fixture.controller);
const USDT = getAddress(fixture.usdt);
const SHORT_ROUTER = getAddress(fixture.shortRouter);
const MAX = (1n << 256n) - 1n;

function common(t: PreparedTx) {
  assert.equal(t.chainId, 56);
  assert.equal(t.value, "0");
  assert.match(t.data, /^0x[0-9a-f]+$/);
  assert.ok(t.description.length > 10, "every step carries a plain-language description");
}

function sameAddress(actual: string, expected: string) {
  assert.equal(getAddress(actual), getAddress(expected));
}

test("lend is approve-then-deposit on the ticker's pool, in raw units", () => {
  const txs = tx.lendTxs("nvdab", "2", USER);
  assert.equal(txs.length, 2);
  txs.forEach(common);
  sameAddress(txs[0].to, NVDAB);
  const approve = decodeFunctionData({ abi: bep677Abi, data: txs[0].data });
  assert.equal(approve.functionName, "approve");
  assert.deepEqual(approve.args, [POOL, parseUnits("2", 18)]);
  sameAddress(txs[1].to, POOL);
  const deposit = decodeFunctionData({ abi: LendingPoolAbi, data: txs[1].data });
  assert.equal(deposit.functionName, "deposit");
  assert.deepEqual(deposit.args, [parseUnits("2", 18), USER]);
  assert.match(txs[1].description, /NVDAB/);
});

test("withdraw-lend and claim target the pool with the owner as receiver", () => {
  const w = tx.withdrawLendTx("NVDAB", "0.5", USER);
  common(w);
  sameAddress(w.to, POOL);
  const d = decodeFunctionData({ abi: LendingPoolAbi, data: w.data });
  assert.equal(d.functionName, "withdraw");
  assert.deepEqual(d.args, [parseUnits("0.5", 18), USER, USER]);
  const c = tx.claimTx("NVDAB", USER);
  common(c);
  sameAddress(c.to, POOL);
  assert.equal(decodeFunctionData({ abi: LendingPoolAbi, data: c.data }).functionName, "claim");
});

test("collateral goes through USDT approve then the controller", () => {
  const txs = tx.depositCollateralTxs("150", USER);
  assert.equal(txs.length, 2);
  txs.forEach(common);
  sameAddress(txs[0].to, USDT);
  const approve = decodeFunctionData({ abi: bep677Abi, data: txs[0].data });
  assert.deepEqual(approve.args, [CONTROLLER, parseUnits("150", 18)]);
  sameAddress(txs[1].to, CONTROLLER);
  const dep = decodeFunctionData({ abi: ControllerAbi, data: txs[1].data });
  assert.equal(dep.functionName, "depositCollateral");
  assert.deepEqual(dep.args, [parseUnits("150", 18), USER]);
  const wd = tx.withdrawCollateralTx("10", USER);
  common(wd);
  const w = decodeFunctionData({ abi: ControllerAbi, data: wd.data });
  assert.equal(w.functionName, "withdrawCollateral");
  assert.deepEqual(w.args, [parseUnits("10", 18), USER]);
});

test("borrow and repay encode the market token; repay all uses the max uint", () => {
  const b = tx.borrowTx("NVDAB", "0.01", USER);
  common(b);
  sameAddress(b.to, CONTROLLER);
  const bd = decodeFunctionData({ abi: ControllerAbi, data: b.data });
  assert.equal(bd.functionName, "borrow");
  assert.deepEqual(bd.args, [NVDAB, parseUnits("0.01", 18), USER]);

  const all = tx.repayTxs("NVDAB", "all", USER);
  assert.equal(all.length, 2);
  all.forEach(common);
  const approve = decodeFunctionData({ abi: bep677Abi, data: all[0].data });
  assert.deepEqual(approve.args, [CONTROLLER, MAX]);
  const rp = decodeFunctionData({ abi: ControllerAbi, data: all[1].data });
  assert.equal(rp.functionName, "repay");
  assert.deepEqual(rp.args, [NVDAB, MAX, USER]);

  const some = tx.repayTxs("NVDAB", "0.004", USER);
  const rs = decodeFunctionData({ abi: ControllerAbi, data: some[1].data });
  assert.deepEqual(rs.args, [NVDAB, parseUnits("0.004", 18), USER]);
});

test("set-operator authorises the short router on the controller", () => {
  const t = tx.setOperatorTx();
  common(t);
  sameAddress(t.to, CONTROLLER);
  const d = decodeFunctionData({ abi: ControllerAbi, data: t.data });
  assert.equal(d.functionName, "setOperator");
  assert.ok((d.args as readonly unknown[]).some((a) => typeof a === "string" && a.toLowerCase() === SHORT_ROUTER.toLowerCase()));
});

test("an unknown ticker is refused before any calldata is built", () => {
  assert.throws(() => tx.lendTxs("AAPLB", "1", USER), /unknown market/);
  assert.throws(() => tx.borrowTx("", "1", USER), /unknown market/);
});

test("GET /tx/:action returns the prepared list, and insists on an account", async () => {
  const ok = await app.request(`/tx/lend?ticker=NVDAB&amount=2&account=${USER}`);
  assert.equal(ok.status, 200);
  const body = (await ok.json()) as { txs: PreparedTx[]; simulations?: unknown };
  assert.equal(body.txs.length, 2);
  assert.equal(body.simulations, undefined);

  const noAccount = await app.request("/tx/lend?ticker=NVDAB&amount=2");
  assert.equal(noAccount.status, 400);
  assert.match(((await noAccount.json()) as { error: string }).error, /account/);

  const unknown = await app.request("/tx/teleport?account=" + USER);
  assert.equal(unknown.status, 404);
  const u = (await unknown.json()) as { actions: string[] };
  assert.ok(u.actions.includes("short") && u.actions.includes("lend"));
});

test("simulate=1 adds one dry-run per step and degrades to UNAVAILABLE without a Binance key", async () => {
  const res = await app.request(`/tx/deposit-collateral?amount=5&account=${USER}&simulate=1`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { txs: PreparedTx[]; simulations: { status: string; failReason: string | null }[] };
  assert.equal(body.simulations.length, body.txs.length);
  for (const s of body.simulations) {
    assert.equal(s.status, "UNAVAILABLE");
    assert.match(String(s.failReason), /not configured/);
  }
});

test("/health and /deployment describe the loaded deployment without touching the chain", async () => {
  const h = (await (await app.request("/health")).json()) as { ok: boolean; markets: number; controller: string };
  assert.equal(h.ok, true);
  assert.equal(h.markets, fixture.tickers.length);
  sameAddress(h.controller, CONTROLLER);
  const d = (await (await app.request("/deployment")).json()) as { tickers: string[] };
  assert.deepEqual(d.tickers, fixture.tickers);
});
