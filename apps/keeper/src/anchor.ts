import { bep677Abi, OracleRouterAbi } from "@stockroom/sdk";
import { binanceClient, deployment, log, markets, publicClient, walletClient , waitReceipt } from "./env.ts";
import { anchorWad, bstockByAddress } from "./binance-prices.ts";

/**
 * Pushes the last reference print of each underlying stock into the OracleRouter as an anchor (USD per raw
 * token), so closed-session debt is valued at no less than the last close. Reads one bStocks list from the
 * Binance RWA Data API per pass and writes only when the value changed. Needs the API key.
 */
export async function anchorOnce(opts: { dryRun?: boolean } = {}): Promise<number> {
  const client = binanceClient();
  if (!client) {
    log("BINANCE_WEB3_API_KEY not set; anchors skipped");
    return 0;
  }
  const wallet = walletClient();
  const byAddr = await bstockByAddress();
  let writes = 0;
  for (const m of markets()) {
    const row = byAddr.get(m.token.toLowerCase());
    const ref = row?.referencePrice;
    if (!ref || Number(ref) <= 0) {
      log(m.ticker, "no reference price from Binance");
      continue;
    }
    const multiplier = await publicClient.readContract({ address: m.token, abi: bep677Abi, functionName: "uiMultiplier" });
    const priceWad = anchorWad(ref, multiplier);
    const [current] = await publicClient.readContract({ address: deployment().oracle, abi: OracleRouterAbi, functionName: "anchors", args: [m.token] });
    if (current === priceWad) continue;
    log(m.ticker, "anchor", current.toString(), "->", priceWad.toString(), `(reference ${ref}, open ${row?.statusInfo?.openState})`, opts.dryRun ? "(dry run)" : "");
    if (opts.dryRun) {
      writes++;
      continue;
    }
    const hash = await wallet.writeContract({ address: deployment().oracle, abi: OracleRouterAbi, functionName: "setAnchor", args: [m.token, priceWad] });
    await waitReceipt(hash);
    writes++;
  }
  return writes;
}
