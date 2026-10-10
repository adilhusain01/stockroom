import { config } from "dotenv";
import { resolve } from "node:path";
import { BinanceWeb3Client } from "@stockroom/sdk";

/** Signed smoke test for the Binance Web3 API key: platforms, the bStocks token list, NVDAB price and market data. */
config({ path: resolve(process.cwd(), "../../.env"), quiet: true });
const apiKey = process.env.BINANCE_WEB3_API_KEY;
const apiSecret = process.env.BINANCE_WEB3_API_SECRET;
if (!apiKey || !apiSecret) {
  console.error("BINANCE_WEB3_API_KEY or BINANCE_WEB3_API_SECRET missing");
  process.exit(1);
}
const client = new BinanceWeb3Client({ apiKey, apiSecret });
const NVDAB = "0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436";

async function show(name: string, fn: () => Promise<unknown>) {
  try {
    const data = await fn();
    console.log(`\n== ${name}: ok`);
    console.log(JSON.stringify(data, null, 1).slice(0, 1500));
  } catch (e) {
    console.log(`\n== ${name}: FAILED ${(e as Error).message}`);
  }
}

await show("rwa/platforms", () => client.rwaPlatforms());
await show("rwa/tokens platform=bStocks chain 56", () => client.rwaTokens({ platform: "bStocks", chainId: 56 }));
await show("rwa/price NVDAB", () => client.rwaPrice({ chainId: 56, contractAddresses: NVDAB }));
await show("rwa/underlying-market NVDAB", () => client.rwaUnderlyingMarket({ chainId: 56, contractAddress: NVDAB }));
await show("rwa/underlying-profile NVDAB", () => client.rwaUnderlyingProfile({ chainId: 56, contractAddress: NVDAB }));
await show("aggregator/supported/chain", () => client.request("GET", "/api/v1/dex/aggregator/supported/chain"));
await show("quote 10 USDT -> NVDAB", () =>
  client.quote({ chainId: 56, fromTokenAddress: "0x55d398326f99059fF775485246999027B3197955", toTokenAddress: NVDAB, amount: "10000000000000000000", slippage: 0.5 }),
);
