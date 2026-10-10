import { log } from "./env.ts";
import { relayOnce } from "./relay.ts";
import { anchorOnce } from "./anchor.ts";
import { liquidateOnce } from "./liquidate.ts";

/**
 * Stockroom keeper. `relay` mirrors APRO (and Binance) prices into the RelayFeeds, `anchor` pushes reference
 * prints into the OracleRouter, `liquidate` runs the flash liquidator, `all` loops over the three.
 *   pnpm keeper all            run forever
 *   pnpm keeper relay --once   one pass
 *   DRY_RUN=1 pnpm keeper all  read everything, write nothing
 */
const job = process.argv[2] ?? "all";
const once = process.argv.includes("--once");
const dryRun = process.env.DRY_RUN === "1";
const RELAY_EVERY = Number(process.env.RELAY_INTERVAL_SEC ?? 120) * 1000;
const ANCHOR_EVERY = Number(process.env.ANCHOR_INTERVAL_SEC ?? 300) * 1000;
const LIQ_EVERY = Number(process.env.LIQUIDATE_INTERVAL_SEC ?? 30) * 1000;

async function safe(name: string, fn: () => Promise<number>) {
  try {
    const n = await fn();
    log(name, "done, writes:", n);
  } catch (e) {
    log(name, "failed:", (e as Error).message.split("\n")[0]);
  }
}

async function loop(name: string, fn: () => Promise<number>, every: number) {
  for (;;) {
    await safe(name, fn);
    if (once) return;
    await new Promise((r) => setTimeout(r, every));
  }
}

const jobs: Record<string, () => Promise<void>> = {
  relay: () => loop("relay", () => relayOnce({ dryRun }), RELAY_EVERY),
  anchor: () => loop("anchor", () => anchorOnce({ dryRun }), ANCHOR_EVERY),
  liquidate: () => loop("liquidate", () => liquidateOnce({ dryRun }), LIQ_EVERY),
  all: async () => {
    await Promise.all([
      loop("relay", () => relayOnce({ dryRun }), RELAY_EVERY),
      loop("anchor", () => anchorOnce({ dryRun }), ANCHOR_EVERY),
      loop("liquidate", () => liquidateOnce({ dryRun }), LIQ_EVERY),
    ]);
  },
};

if (!jobs[job]) {
  console.error("usage: main.ts [relay|anchor|liquidate|all] [--once]");
  process.exit(1);
}
log("keeper", job, once ? "(once)" : "", dryRun ? "(dry run)" : "");
jobs[job]().catch((e) => {
  console.error(e);
  process.exit(1);
});
