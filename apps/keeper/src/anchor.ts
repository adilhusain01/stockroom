import { bep677Abi, OracleRouterAbi } from "@stockroom/sdk";
import { binanceClient, deployment, log, markets, publicClient, walletClient } from "./env.ts";
import { anchorWad } from "./binance-prices.ts";

/**
 * Pushes the last reference print of each underlying stock into the OracleRouter as an anchor (USD per raw
 * token), so closed-session debt is valued at no less than Friday's close. Needs the Binance Web3 API key.
 */
let loggedShape = false;

export async function anchorOnce(opts: { dryRun?: boolean } = {}): Promise<number> {
  const client = binanceClient();
  if (!client) {
    log("BINANCE_WEB3_API_KEY not set; anchors skipped");
    return 0;
  }
  const wallet = walletClient();
  let writes = 0;
  for (const m of markets()) {
    let ref: string | undefined;
    try {
      const data = (await client.rwaUnderlyingMarket({ chainId: 56, contractAddress: m.token })) as any;
      if (!loggedShape) {
        log("rwa/underlying-market shape:", JSON.stringify(data).slice(0, 600));
        loggedShape = true;
      }
      ref = String(data?.price ?? data?.lastPrice ?? data?.underlyingPrice ?? data?.referencePrice ?? data?.close ?? "");
    } catch (e) {
      log(m.ticker, "underlying-market failed:", (e as Error).message);
      continue;
    }
    if (!ref || Number.isNaN(Number(ref)) || Number(ref) <= 0) {
      log(m.ticker, "no reference price in response");
      continue;
    }
    const multiplier = await publicClient.readContract({ address: m.token, abi: bep677Abi, functionName: "uiMultiplier" });
    const priceWad = anchorWad(ref, multiplier);
    const [current] = await publicClient.readContract({ address: deployment().oracle, abi: OracleRouterAbi, functionName: "anchors", args: [m.token] });
    if (current === priceWad) continue;
    log(m.ticker, "anchor", current.toString(), "->", priceWad.toString(), opts.dryRun ? "(dry run)" : "");
    if (opts.dryRun) {
      writes++;
      continue;
    }
    const hash = await wallet.writeContract({ address: deployment().oracle, abi: OracleRouterAbi, functionName: "setAnchor", args: [m.token, priceWad] });
    await publicClient.waitForTransactionReceipt({ hash });
    writes++;
  }
  return writes;
}
