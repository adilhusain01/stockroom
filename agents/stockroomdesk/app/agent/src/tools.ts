/**
 * Read-only chain tools exposed to this agent's LLM (AI SDK `tool` wrap).
 *
 * Each entry in `LLM_READ_TOOLS` is a function from
 * `@bnbagent/studio-runtime/tools` wrapped as a Vercel AI SDK tool. The LLM
 * may call any tool in this set while producing the deliverable (the
 * `notify_funded` work step); the `description` is what the LLM sees.
 *
 * You own this file — edit `LLM_READ_TOOLS` to control exactly what your
 * agent can read on-chain. Entries for features your project doesn't use are
 * commented out by default; uncomment after you've added the dependency to
 * `studio.toml`.
 *
 * **All tools are read-only** by the studio definition: no on-chain state
 * change, no transferable authority, no transaction signing, no EIP-712
 * typed-data signing. The agent IS the sole on-chain signer, but ALL of its
 * signing — quote-sign, submitResult, settle, plus the automatic
 * budget-gated Pieverse LLM-credit auto-renew inside `buildModel()` — lives
 * in `signing.ts` / `model.ts` as FIXED entrypoint code and is NEVER a tool
 * the LLM can invoke. The LLM only produces work text after a job is
 * verified funded; it can never price, sign, spend, or mutate chain state.
 * Keep this set read-only.
 *
 * (`pieverseUsage` is the one exception in the underlying module: it does a
 * SIWE EIP-191 personal_sign, domain-locked to llm.pieverse.io, no on-chain
 * effect. It is commented out below.)
 */

import * as cr from "@bnbagent/studio-runtime/tools";
import { loadStudioToml } from "@bnbagent/studio-runtime/config";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { READ_TOOL_CATALOG } from "./readToolCatalog.js";
import * as desk from "./stockroomDesk.js";

/**
 * The project-wide default network (`[network].default`) — tool calls that
 * omit `network` fall back to it, never to a hardcoded name.
 */
function defaultNetwork(): string {
  try {
    const cfg = loadStudioToml();
    return String(
      ((cfg.network ?? {}) as Record<string, unknown>).default ?? "bsc-testnet",
    );
  } catch {
    return "bsc-testnet";
  }
}

/**
 * Stockroom reads: plain GETs against the Stockroom API (market state, rates, session, accounts) plus the
 * deterministic short-plan maths. No key, no write, no signing; the API itself only reads the chain.
 */
export const STOCKROOM_TOOLS: ToolSet = {
  stockroom_market: tool({
    description:
      "Live Stockroom market for one bStock ticker (NVDAB, TSLAB, QQQB, SPCXB, CRCLB...): the price the risk engine uses, regime (Open, Closed, Paused, Degraded), whether borrowing is allowed now, borrow and supply APR, utilisation, idle liquidity, borrow cap, relayed feed price, PancakeSwap TWAP, Binance reference anchor, tier ratios, BEP-677 multiplier state.",
    inputSchema: z.object({ ticker: z.string().describe("bStock ticker, e.g. NVDAB") }),
    execute: async ({ ticker }) => desk.stockroomMarket(ticker),
  }),
  stockroom_rates: tool({
    description: "Borrow APR, supply APR, utilisation, regime and price for every Stockroom market in one call.",
    inputSchema: z.object({}),
    execute: async () => desk.stockroomRates(),
  }),
  stockroom_session: tool({
    description:
      "Reference session state: whether US extended hours are open, the next open (unix seconds), how long the market has been closed, and the gap premium applied to debt while closed.",
    inputSchema: z.object({}),
    execute: async () => desk.stockroomSession(),
  }),
  stockroom_account: tool({
    description:
      "A wallet's Stockroom account: USDT collateral, pending fees, health factor, short positions with liquidation prices, lending positions.",
    inputSchema: z.object({ address: z.string().describe("0x wallet address") }),
    execute: async ({ address }) => desk.stockroomAccount(address),
  }),
  stockroom_desk_brief: tool({
    description:
      "Everything needed for a borrow desk brief: shorting `amount` of `ticker` against `collateral_usdt` USDT for `days` days. Returns regime, borrow allowed, how much can still be borrowed, APRs, price cross-checks (TWAP and anchor vs feed in percent), next open, gap premium, required collateral, margin after the sale, liquidation prices while open and while closed, fee, notes on anything that does not fit, and the exact API calls to send.",
    inputSchema: z.object({
      ticker: z.string().describe("bStock ticker, e.g. NVDAB"),
      amount: z.number().positive().describe("stock amount to short, in whole tokens"),
      collateral_usdt: z.number().nonnegative().describe("USDT the borrower will post"),
      days: z.number().int().positive().optional().describe("holding period in days (default 3)"),
    }),
    execute: async ({ ticker, amount, collateral_usdt, days }) => desk.deskBrief(ticker, amount, collateral_usdt, days ?? 3),
  }),
};

export const LLM_READ_TOOLS: ToolSet = {
  ...STOCKROOM_TOOLS,

  // --- Wallet & chain basics ---
  wallet_info: tool({
    description: READ_TOOL_CATALOG.wallet_info.description,
    inputSchema: z.object(READ_TOOL_CATALOG.wallet_info.inputSchema),
    execute: async () => cr.walletInfo(),
  }),
  balance_native: tool({
    description: READ_TOOL_CATALOG.balance_native.description,
    inputSchema: z.object(READ_TOOL_CATALOG.balance_native.inputSchema),
    execute: async ({ address, network }) =>
      cr.balanceNative(address ?? null, network ?? defaultNetwork()),
  }),
  balance_u: tool({
    // requires [u_token] in studio.toml
    description: READ_TOOL_CATALOG.balance_u.description,
    inputSchema: z.object(READ_TOOL_CATALOG.balance_u.inputSchema),
    execute: async ({ address, network }) =>
      cr.balanceU(address ?? null, network ?? defaultNetwork()),
  }),
  network_info: tool({
    description: READ_TOOL_CATALOG.network_info.description,
    inputSchema: z.object(READ_TOOL_CATALOG.network_info.inputSchema),
    execute: async ({ network }) => cr.networkInfo(network ?? defaultNetwork()),
  }),
  tx_status: tool({
    description: READ_TOOL_CATALOG.tx_status.description,
    inputSchema: z.object(READ_TOOL_CATALOG.tx_status.inputSchema),
    execute: async ({ tx_hash, network }) =>
      cr.txStatus(tx_hash, network ?? defaultNetwork()),
  }),

  // --- LLM provider ---
  // pieverse_usage: tool({
  //   // SIWE personal_sign; requires [llm.provider=pieverse-llm]
  //   description: "Pieverse LLM usage/credit summary for the last N days.",
  //   inputSchema: z.object({ days: z.number().int().optional() }),
  //   execute: async ({ days }) => cr.pieverseUsage(days ?? 7),
  // }),

  // --- ERC-8004 identity (read-only lookups the LLM may want for context) ---
  agent_info: tool({
    // requires [erc8004] in studio.toml
    description: READ_TOOL_CATALOG.agent_info.description,
    inputSchema: z.object(READ_TOOL_CATALOG.agent_info.inputSchema),
    execute: async ({ agent_id, network }) =>
      cr.agentInfo(agent_id, network ?? defaultNetwork()),
  }),
  agent_by_address: tool({
    // requires [erc8004] in studio.toml
    description: READ_TOOL_CATALOG.agent_by_address.description,
    inputSchema: z.object(READ_TOOL_CATALOG.agent_by_address.inputSchema),
    execute: async ({ address, network }) =>
      cr.agentByAddress(address, network ?? defaultNetwork()),
  }),

  // --- ERC-8183 jobs (READ-ONLY status/list — writes live in signing.ts) ---
  job_status: tool({
    // requires [erc8183] in studio.toml
    description: READ_TOOL_CATALOG.job_status.description,
    inputSchema: z.object(READ_TOOL_CATALOG.job_status.inputSchema),
    execute: async ({ job_id, network }) =>
      cr.jobStatus(job_id, network ?? defaultNetwork()),
  }),
  job_list: tool({
    // requires [erc8183] in studio.toml
    description: READ_TOOL_CATALOG.job_list.description,
    inputSchema: z.object(READ_TOOL_CATALOG.job_list.inputSchema),
    execute: async ({ limit, mine, network }) =>
      cr.jobList({ limit, mine, network: network ?? defaultNetwork() }),
  }),
  // job_count: ...        // network-wide stat — usually noise

  // --- Advanced / footguns (commented by default) ---
  // contract_call_view: ...  // accepts any ABI — LLM-callable footgun
  // block_info: ...
  // wallet_list: ...          // multi-wallet management — dev concern
  // wallet_address: ...       // alias of wallet_info
};
