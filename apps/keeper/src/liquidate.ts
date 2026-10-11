import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ControllerAbi, LiquidatorAbi } from "@stockroom/sdk";
import { encodePacked, parseAbiItem, type Address } from "viem";
import { deployment, log, logsClient, markets, publicClient, waitReceipt, walletClient } from "./env.ts";

const WAD = 1_000_000_000_000_000_000n;
const borrowedEvent = parseAbiItem("event Borrowed(address indexed account, address indexed token, address indexed to, uint256 rawAmount)");

/**
 * Accounts that have ever borrowed, from Borrowed logs (the controller has no account list on purpose). Public
 * BSC RPCs cap eth_getLogs at about 5,000 blocks per call ("Request exceeds defined limit"), so the scan walks
 * from DEPLOY_BLOCK in windows.
 */
export async function knownBorrowers(fromBlock: bigint): Promise<Set<Address>> {
  if (fromBlock === 0n) throw new Error("set DEPLOY_BLOCK to the block the controller was deployed in; scanning from genesis is refused by public RPCs");
  // Borrowers found so far are kept on disk, so each scan only reads the blocks since the last one. Public RPCs
  // treat blocks more than a few hours old as archive ("Archive requests require a personal token"), so a scan
  // that has fallen far behind resumes from the recent past and says so; the cached set keeps the rest.
  const cache = loadBorrowers();
  const set = new Set<Address>(cache.accounts as Address[]);
  const latest = await logsClient.getBlockNumber();
  let from = cache.lastBlock ? BigInt(cache.lastBlock) + 1n : fromBlock;
  const OLDEST = 2_000n; // about 100 minutes of BSC blocks
  if (latest - from > OLDEST) {
    log(`borrower scan ${latest - from} blocks behind; resuming from the last ${OLDEST}, older borrowers stay in the cache only`);
    from = latest - OLDEST;
  }
  const WINDOW = 1_000n; // bsc-dataseed refused 2,095 blocks on 2026-10-11 and accepted 2,000
  for (; from <= latest; from += WINDOW) {
    const to = from + WINDOW - 1n > latest ? latest : from + WINDOW - 1n;
    const logs = await logsClient.getLogs({ address: deployment().controller, event: borrowedEvent, fromBlock: from, toBlock: to });
    for (const l of logs) if (l.args.account) set.add(l.args.account);
  }
  saveBorrowers({ lastBlock: latest.toString(), accounts: [...set] });
  return set;
}

const BORROWERS_FILE = resolve(process.cwd(), "runs/borrowers.json");

function loadBorrowers(): { lastBlock: string | null; accounts: string[] } {
  if (!existsSync(BORROWERS_FILE)) return { lastBlock: null, accounts: [] };
  try {
    const raw = JSON.parse(readFileSync(BORROWERS_FILE, "utf8"));
    return { lastBlock: raw.lastBlock ?? null, accounts: Array.isArray(raw.accounts) ? raw.accounts : [] };
  } catch {
    return { lastBlock: null, accounts: [] };
  }
}

function saveBorrowers(data: { lastBlock: string; accounts: string[] }) {
  mkdirSync(resolve(process.cwd(), "runs"), { recursive: true });
  writeFileSync(BORROWERS_FILE, JSON.stringify(data, null, 2));
}

export function buyPathFor(token: Address): `0x${string}` {
  const idx = markets().findIndex((m) => m.token.toLowerCase() === token.toLowerCase());
  const fee = idx >= 0 ? poolFee(idx) : 2500;
  // exactOutput path: token out first, then the fee tier, then USDT
  return encodePacked(["address", "uint24", "address"], [token, fee, deployment().usdt]);
}

function poolFee(i: number): number {
  const fees = (process.env.POOL_FEES ?? "").split(",").map((x) => Number(x)).filter((x) => x > 0);
  return fees[i] ?? 2500;
}

/** One scan: liquidate every account below health 1 through the capital-free flash path. */
export async function liquidateOnce(opts: { dryRun?: boolean; fromBlock?: bigint } = {}): Promise<number> {
  const wallet = walletClient();
  const fromBlock = opts.fromBlock ?? BigInt(process.env.DEPLOY_BLOCK ?? "0");
  const borrowers = await knownBorrowers(fromBlock);
  let done = 0;
  for (const account of borrowers) {
    const health = await publicClient.readContract({ address: deployment().controller, abi: ControllerAbi, functionName: "healthFactor", args: [account] });
    if (health >= WAD) continue;
    const tokens = await publicClient.readContract({ address: deployment().controller, abi: ControllerAbi, functionName: "borrowedTokens", args: [account] });
    for (const token of tokens) {
      const debt = await publicClient.readContract({ address: deployment().controller, abi: ControllerAbi, functionName: "positionOf", args: [account, token] });
      if (debt === 0n) continue;
      log("liquidatable", account, token, "health", health.toString(), "debt", debt.toString());
      if (opts.dryRun) {
        done++;
        continue;
      }
      try {
        const { request } = await publicClient.simulateContract({
          address: deployment().liquidator,
          abi: LiquidatorAbi,
          functionName: "liquidateWithFlash",
          args: [account, token, debt, buyPathFor(token), 0n],
          account: wallet.account,
        });
        const hash = await wallet.writeContract(request);
        const receipt = await waitReceipt(hash);
        log("liquidated", account, token, "tx", hash, receipt.status);
        done++;
      } catch (e) {
        log("liquidation simulate failed", account, token, (e as Error).message.split("\n")[0]);
      }
    }
  }
  return done;
}
