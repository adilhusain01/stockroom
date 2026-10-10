import { config } from "dotenv";
import { resolve } from "node:path";
import { BinanceWeb3Client } from "@stockroom/sdk";

config({ path: resolve(process.cwd(), "../../.env"), quiet: true });

/**
 * B402 (Binance's x402 facilitator) gate for paid endpoints. A buyer gets a 402 with the payment requirements,
 * signs a Permit2 or EIP-3009 authorization with the Agentic Wallet (`baw x402-payment sign`), retries with the
 * payload, and the API verifies then settles through Binance before answering. The requirements come from
 * `POST /api/v2/b402/supported` at startup, so signer and spender addresses are never hard-coded.
 */
export interface PaymentRequirement {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
}

const USDT = "0x55d398326f99059fF775485246999027B3197955";
const PRICE_WEI = process.env.B402_PRICE_WEI ?? "10000000000000000"; // 0.01 USDT per call
const PAY_TO = process.env.B402_PAY_TO ?? "";

let client: BinanceWeb3Client | null = null;
let kinds: any[] | null = null;

function binance(): BinanceWeb3Client | null {
  if (client) return client;
  const apiKey = process.env.BINANCE_WEB3_API_KEY;
  const apiSecret = process.env.BINANCE_WEB3_API_SECRET;
  if (!apiKey || !apiSecret) return null;
  client = new BinanceWeb3Client({ apiKey, apiSecret });
  return client;
}

export function b402Enabled(): boolean {
  return !!binance() && !!PAY_TO;
}

async function supportedKinds(): Promise<any[]> {
  if (kinds) return kinds;
  const c = binance();
  if (!c) return [];
  const data = (await c.request<any>("POST", "/api/v2/b402/supported", {}, { body: {} })) as any;
  kinds = Array.isArray(data?.kinds) ? data.kinds : [];
  return kinds!;
}

/** Requirements for one call: USDT over Permit2 (exact), or whatever Binance reports for USDT. */
export async function requirementsFor(resourceUrl: string): Promise<{ requirements: PaymentRequirement[]; resource: { url: string; description: string; mimeType: string } }> {
  const list = await supportedKinds();
  const usdtKinds = list.filter((k) => String(k.asset ?? "").toLowerCase() === USDT.toLowerCase() && String(k.network) === "eip155:56");
  const requirements: PaymentRequirement[] = usdtKinds.map((k) => ({
    scheme: k.scheme ?? "exact",
    network: "eip155:56",
    amount: PRICE_WEI,
    asset: USDT,
    payTo: PAY_TO,
    maxTimeoutSeconds: 300,
    extra: k.extra ?? {},
  }));
  return {
    requirements,
    resource: { url: resourceUrl, description: "Stockroom live borrow and supply rates for bStocks on BNB Chain", mimeType: "application/json" },
  };
}

export function decodePaymentHeader(raw: string | undefined): any | null {
  if (!raw) return null;
  try {
    const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Verify and settle. Returns null on success, or an error message. */
export async function verifyAndSettle(paymentPayload: any, resourceUrl: string): Promise<{ ok: true; transaction?: string; payer?: string } | { ok: false; error: string }> {
  const c = binance();
  if (!c) return { ok: false, error: "B402 not configured" };
  const { requirements } = await requirementsFor(resourceUrl);
  const accepted = paymentPayload?.accepted;
  const match = requirements.find(
    (r) => r.scheme === accepted?.scheme && r.network === accepted?.network && r.asset.toLowerCase() === String(accepted?.asset).toLowerCase() && r.payTo.toLowerCase() === String(accepted?.payTo).toLowerCase() && r.amount === String(accepted?.amount),
  );
  if (!match) return { ok: false, error: "accepted requirement does not match what this server issued" };
  const body = { x402Version: 2, paymentPayload, paymentRequirements: match };
  const verify = (await c.request<any>("POST", "/api/v2/b402/verify", {}, { body })) as any;
  if (!verify?.isValid) return { ok: false, error: `verify failed: ${verify?.invalidReason ?? "unknown"} ${verify?.invalidMessage ?? ""}`.trim() };
  const settle = (await c.request<any>("POST", "/api/v2/b402/settle", {}, { body })) as any;
  if (!settle?.success) return { ok: false, error: `settle failed: ${settle?.errorReason ?? "unknown"}${settle?.transaction ? ` (tx ${settle.transaction} broadcast, reconcile before retrying)` : ""}` };
  return { ok: true, transaction: settle.transaction, payer: settle.payer };
}
