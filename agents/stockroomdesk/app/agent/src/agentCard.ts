/**
 * A2A AgentCard — the seller agent's outward, discoverable identity.
 *
 * Built by `main.ts` and served at `/.well-known/agent-card.json`. When
 * deployed, `main.ts` overwrites `card.url` at boot with the deployed
 * AgentCore runtime URL (`$AGENTCORE_RUNTIME_URL`), so the `url` here is only
 * a local-dev placeholder.
 *
 * The card advertises exactly two skills — `negotiate` and `notify_funded` —
 * and the OAuth2 (Cognito) security scheme buyers must satisfy: AgentCore A2A
 * endpoints require an inbound OAuth2 bearer (there is no anonymous mode).
 * The token URL + scope come from the Cognito user pool
 * `bag deploy provision-cognito` creates (env `OAUTH_TOKEN_URL` /
 * `OAUTH_SCOPE`, injected at deploy); the runtime's inbound JWT authorizer
 * validates the same pool. Locally (no Cognito env) the card omits the scheme
 * so `bag dev` is reachable without a token.
 *
 * You own this file — edit the skill descriptions / card metadata for your
 * seller.
 */

import type { AgentCard, AgentSkill, SecurityScheme } from "@a2a-js/sdk";
import { loadStudioToml } from "@bnbagent/studio-runtime/config";

const NEGOTIATE: AgentSkill = {
  id: "negotiate",
  name: "Quote a Stockroom borrow desk brief",
  description:
    "Ask the Stockroom Desk Analyst for a borrow desk brief on one Binance bStock: whether to borrow or short " +
    "it on Stockroom now, the live borrow rate, how much can be borrowed, price cross-checks, required " +
    "collateral, liquidation prices while Wall Street is open and closed, and the exact Stockroom API calls to " +
    'send. Send a data part {"skill": "negotiate", "task_description": "Desk brief for shorting 0.01 NVDAB ' +
    'against 10 USDT over the weekend", "terms": {"deliverables": "borrow desk brief", "quality_standards": ' +
    '"every number from live Stockroom data"}} (both terms keys are REQUIRED) and receive a wallet-signed ' +
    "price quote (price, currency, negotiation_hash, provider_sig). Anchor the returned envelope on-chain via " +
    "createJob + fund, then send the `notify_funded` skill with the job_id to request delivery.",
  tags: ["erc8183", "negotiation", "bnb-chain", "stockroom", "bstocks", "stock-lending"],
  inputModes: ["application/json"],
  outputModes: ["application/json"],
};

const NOTIFY_FUNDED: AgentSkill = {
  id: "notify_funded",
  name: "Notify the seller a job is funded (request delivery)",
  description:
    'After you fund the job on-chain, send {"skill": "notify_funded", ' +
    '"job_id": <int>} to tell the seller "I funded job X — please deliver". ' +
    "The seller verifies the funded job carries its signed quote and replies " +
    'AT ONCE with {"status": "accepted"|"rejected", "job_id"}; delivery then ' +
    "runs in the background (work takes time). Do NOT wait on this call for " +
    "the result — read the deliverable back from the CHAIN once the job " +
    "reaches SUBMITTED (the `submit` tx carries the deliverable_url; " +
    "ERC-8183 `get_deliverable_url`). The agent serves no job-query endpoint.",
  tags: ["erc8183", "delivery", "bnb-chain"],
  inputModes: ["application/json"],
  outputModes: ["application/json"],
};

/** Card name from studio.toml `[project].name` (best-effort). */
function agentName(): string {
  let name = "";
  try {
    const cfg = loadStudioToml();
    name = String(
      ((cfg.project ?? {}) as Record<string, unknown>).name ?? "",
    );
  } catch {
    // a card label must never break boot
  }
  return name || "bnbagent-seller";
}

/** Public name and pitch; the studio.toml project name stays the runtime id. */
const CARD_NAME = "Stockroom Desk Analyst";
const CARD_DESCRIPTION =
  "Paid research desk for Stockroom, the on-chain stock lending market for Binance bStocks on BNB Chain. " +
  "Sells borrow desk briefs (ERC-8183 over A2A and MCP, x402 at /x402): live borrow rate, borrowable size, " +
  "price cross-checks, required collateral, liquidation prices open and closed, and the exact Stockroom API " +
  "calls to send. Reads only; every number comes from https://stockroom.adilhusain.xyz/api.";

/**
 * OAuth2 (Cognito client-credentials) scheme from env, or null locally.
 *
 * `bag deploy provision-cognito` emits a Cognito user pool + app client and
 * injects `OAUTH_TOKEN_URL` + `OAUTH_SCOPE`; the AgentCore runtime's inbound
 * JWT authorizer is wired to the same pool. Absent (local `bag dev`) →
 * return null so the card advertises no auth requirement.
 */
function oauth2Scheme(): SecurityScheme | null {
  const tokenUrl = process.env.OAUTH_TOKEN_URL;
  const scope = process.env.OAUTH_SCOPE;
  if (!tokenUrl || !scope) {
    return null;
  }
  return {
    type: "oauth2",
    flows: {
      clientCredentials: {
        tokenUrl,
        scopes: { [scope]: "Invoke the seller agent" },
      },
    },
  };
}

/** Build the A2A AgentCard, gating ERC-8183 skills on the configured rail. */
export function buildAgentCard(
  opts: { commerceSkills?: boolean } = {},
): AgentCard {
  const name = agentName();
  const extra: Partial<AgentCard> = {};
  const scheme = oauth2Scheme();
  if (scheme !== null) {
    const scope = process.env.OAUTH_SCOPE as string;
    extra.securitySchemes = { oauth2: scheme };
    extra.security = [{ oauth2: [scope] }];
  }
  return {
    name: CARD_NAME,
    description: `${CARD_DESCRIPTION} Runtime id: ${name}.`,
    // main.ts overwrites this with $AGENTCORE_RUNTIME_URL at boot.
    // Local-dev fallback: a client-routable localhost URL (not the 0.0.0.0
    // bind address). Host via AGENT_HOST (default localhost); port via the
    // same AGENT_PORT → 9000 resolution main.ts serves on. Do not honor the
    // AgentCore HTTP $PORT=8080 convention for this A2A runtime.
    url:
      process.env.AGENTCORE_RUNTIME_URL ??
      `http://${process.env.AGENT_HOST ?? "localhost"}:${process.env.AGENT_PORT || "9000"}/`,
    version: "1.0.0",
    protocolVersion: "0.3.0",
    preferredTransport: "JSONRPC",
    // Non-streaming: negotiate / notify_funded are request/response
    // (message/send). Do NOT flip this on to satisfy the AgentCore
    // inspector's chat box — that box can't drive a seller agent (it can
    // only send plain text, never the {"skill": ...} DataPart these skills
    // require, and its streaming view expects Task events). Test locally
    // with curl / an A2A client sending a DataPart (see the operating skill).
    capabilities: { streaming: false },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills:
      opts.commerceSkills === false ? [] : [NEGOTIATE, NOTIFY_FUNDED],
    ...extra,
  };
}
