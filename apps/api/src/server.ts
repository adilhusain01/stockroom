import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { isAddress, type Address } from "viem";
import { accountView, deployment, markets, marketViews, sessionView, type MarketView } from "./chain.ts";
import * as tx from "./tx.ts";
import * as b402 from "./b402.ts";
import { simulateTx } from "./binance.ts";

/**
 * Stockroom read API. Everything here is derived from chain state; the frontend and the agents read it, and
 * /rates.json is the public borrow-rate feed (the first on-chain equity borrow rate on BNB Chain).
 */
const app = new Hono();
app.use("*", cors());

let cache: { at: number; data: MarketView[] } | null = null;
const CACHE_MS = Number(process.env.MARKETS_CACHE_MS ?? 10_000);

async function cachedMarkets(): Promise<MarketView[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  const data = await marketViews();
  cache = { at: Date.now(), data };
  return data;
}

app.get("/health", (c) => c.json({ ok: true, chainId: deployment.chainId, controller: deployment.controller, markets: markets.length }));

app.get("/deployment", (c) => c.json(deployment));

/** Reference session state from the on-chain calendar plus the current gap premium. */
app.get("/session", async (c) => {
  try {
    return c.json(await sessionView());
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

app.get("/markets", async (c) => {
  try {
    return c.json({ updatedAt: new Date().toISOString(), markets: await cachedMarkets() });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

app.get("/markets/:ticker", async (c) => {
  const ticker = c.req.param("ticker").toUpperCase();
  const all = await cachedMarkets();
  const m = all.find((x) => x.ticker === ticker);
  return m ? c.json(m) : c.json({ error: "unknown market" }, 404);
});

/** Public rate feed: one line per ticker, the shape a dashboard or an agent can poll. */
app.get("/rates.json", async (c) => {
  const all = await cachedMarkets();
  return c.json({
    source: "Stockroom on BNB Chain",
    updatedAt: new Date().toISOString(),
    rates: all.map((m) => ({
      ticker: m.ticker,
      borrowApr: Number(m.borrowRateApr),
      supplyApr: Number(m.supplyRateApr),
      utilisation: Number(m.utilisation),
      regime: m.regime,
      priceUsd: Number(m.price),
      borrowAllowed: m.borrowAllowed,
    })),
  });
});

/**
 * Transaction builders for wallets that take prepared calldata (Binance Agentic Wallet `contract-call`, the web
 * app). Query: ticker, amount, account, slippageBps. Each returns {to, data, value, chainId, description}.
 */
app.get("/tx/:action", async (c) => {
  const action = c.req.param("action");
  const q = c.req.query();
  const account = q.account as Address | undefined;
  const ticker = q.ticker ?? "";
  const amount = q.amount ?? "";
  const slippage = q.slippageBps ? Number(q.slippageBps) : 100;
  const needAccount = () => {
    if (!account || !isAddress(account)) throw new Error("account query parameter must be an address");
    return account;
  };
  try {
    let txs: tx.PreparedTx[];
    switch (action) {
      case "lend":
        txs = tx.lendTxs(ticker, amount, needAccount());
        break;
      case "withdraw-lend":
        txs = [tx.withdrawLendTx(ticker, amount, needAccount())];
        break;
      case "claim":
        txs = [tx.claimTx(ticker, needAccount())];
        break;
      case "deposit-collateral":
        txs = tx.depositCollateralTxs(amount, needAccount());
        break;
      case "withdraw-collateral":
        txs = [tx.withdrawCollateralTx(amount, needAccount())];
        break;
      case "borrow":
        txs = [tx.borrowTx(ticker, amount, needAccount())];
        break;
      case "repay":
        txs = tx.repayTxs(ticker, amount === "all" ? "all" : amount, needAccount());
        break;
      case "set-operator":
        txs = [tx.setOperatorTx()];
        break;
      case "short":
        txs = [await tx.shortTx(ticker, amount, slippage)];
        break;
      case "cover":
        txs = [await tx.coverTx(ticker, amount, slippage)];
        break;
      default:
        return c.json({ error: "unknown action", actions: ["lend", "withdraw-lend", "claim", "deposit-collateral", "withdraw-collateral", "borrow", "repay", "set-operator", "short", "cover"] }, 404);
    }
    // simulate=1: dry-run every transaction through the Binance Transaction API before it is handed to a wallet.
    // A multi-step list (approve, then act) is simulated step by step; later steps may report an allowance
    // failure until the earlier ones are mined, which the response says plainly.
    if (q.simulate === "1" && account && isAddress(account)) {
      const simulations = [];
      for (const t of txs) simulations.push(await simulateTx(account, t));
      return c.json({ txs, simulations });
    }
    return c.json({ txs });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

/** Paid rate feed for agents: x402 over Binance's B402 facilitator, 0.01 USDT per call. */
app.get("/paid/rates", async (c) => {
  const url = new URL(c.req.url).toString();
  if (!b402.b402Enabled()) {
    return c.json({ error: "paid feed not configured on this server; use /rates.json" }, 503);
  }
  const header = c.req.header("X-PAYMENT") ?? c.req.header("PAYMENT-SIGNATURE") ?? c.req.header("payment-signature");
  const payload = b402.decodePaymentHeader(header);
  if (!payload) {
    const { requirements, resource } = await b402.requirementsFor(url);
    const body = { x402Version: 2, error: "payment required", resource, accepts: requirements };
    c.header("PAYMENT-REQUIRED", Buffer.from(JSON.stringify(body)).toString("base64"));
    return c.json(body, 402);
  }
  const result = await b402.verifyAndSettle(payload, url);
  if (!result.ok) return c.json({ x402Version: 2, error: result.error }, 402);
  const all = await cachedMarkets();
  c.header("PAYMENT-RESPONSE", Buffer.from(JSON.stringify({ success: true, transaction: result.transaction, network: "eip155:56", payer: result.payer })).toString("base64"));
  return c.json({ paidBy: result.payer, transaction: result.transaction, updatedAt: new Date().toISOString(), rates: all.map((m) => ({ ticker: m.ticker, borrowApr: Number(m.borrowRateApr), supplyApr: Number(m.supplyRateApr), utilisation: Number(m.utilisation), regime: m.regime, priceUsd: Number(m.price), twapUsd: m.twapPrice ? Number(m.twapPrice) : null, anchorUsd: m.anchorPrice ? Number(m.anchorPrice) : null, idle: Number(m.idle), borrowCap: Number(m.borrowCapRaw) })) });
});

/** ERC-8004 agent card for the Night Desk agent. */
app.get("/agent-card.json", (c) =>
  c.json({
    name: "Stockroom Night Desk",
    description: "Borrows bStocks on Stockroom every Friday after the US close, provides PancakeSwap v3 liquidity while Wall Street is shut, unwinds before the Monday open and repays. Pays the borrow fee that becomes lenders' yield. Publishes the live equity borrow rate on BNB Chain.",
    url: process.env.PUBLIC_API_URL ?? "https://stockroom.adilhusain.xyz/api",
    version: "0.1.0",
    chain: "eip155:56",
    operator: deployment.keeper,
    contracts: { controller: deployment.controller, oracle: deployment.oracle, shortRouter: deployment.shortRouter, liquidator: deployment.liquidator },
    services: [
      { name: "rates", path: "/rates.json", price: "free" },
      { name: "paid-rates", path: "/paid/rates", price: "0.01 USDT per call over B402 (x402 V2)" },
      { name: "markets", path: "/markets", price: "free" },
    ],
    skills: ["lend", "borrow", "short", "cover", "weekend-market-making"],
  }),
);

app.get("/account/:address", async (c) => {
  const address = c.req.param("address");
  if (!isAddress(address)) return c.json({ error: "bad address" }, 400);
  try {
    return c.json(await accountView(address as Address));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

const port = Number(process.env.API_PORT ?? 4310);
// API_NO_LISTEN=1 lets tests import the app and call app.request() without binding the port.
if (process.env.API_NO_LISTEN !== "1") {
  serve({ fetch: app.fetch, port }, () => console.log(`stockroom api on :${port}`));
}

export default app;
