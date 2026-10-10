import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { isAddress, type Address } from "viem";
import { accountView, deployment, markets, marketViews, type MarketView } from "./chain.ts";

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
serve({ fetch: app.fetch, port }, () => console.log(`stockroom api on :${port}`));

export default app;
