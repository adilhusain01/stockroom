import { createHmac } from "node:crypto";

/**
 * Binance Web3 Wallet API client. Every request is signed with HMAC-SHA256 over
 * `timestamp + METHOD + requestPath (with the /build prefix and query string) + body`,
 * as documented at web3.binance.com/en/dev-docs/authentication (read 2026-10-10).
 */
export interface BinanceClientOptions {
  apiKey: string;
  apiSecret: string;
  baseUrl?: string; // default https://web3.binance.com/build
  recvWindowMs?: number;
  fetchImpl?: typeof fetch;
}

export interface SignedRequest {
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export const BINANCE_BASE_URL = "https://web3.binance.com/build";

export function preHash(timestamp: string, method: string, requestPath: string, body = ""): string {
  return `${timestamp}${method.toUpperCase()}${requestPath}${body}`;
}

export function sign(secret: string, pre: string): string {
  return createHmac("sha256", secret).update(pre, "utf8").digest("base64");
}

export function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

export class BinanceWeb3Client {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly baseUrl: string;
  private readonly recvWindowMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: BinanceClientOptions) {
    this.apiKey = opts.apiKey;
    this.apiSecret = opts.apiSecret;
    this.baseUrl = (opts.baseUrl ?? BINANCE_BASE_URL).replace(/\/$/, "");
    this.recvWindowMs = opts.recvWindowMs ?? 5000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Build the signed request for `path` (e.g. "/api/v1/dex/market/rwa/tokens"), without sending it. */
  prepare(method: "GET" | "POST", path: string, query: Record<string, string | number | boolean | undefined> = {}, body?: unknown, now = new Date()): SignedRequest {
    const prefix = new URL(this.baseUrl).pathname.replace(/\/$/, ""); // "/build"
    const requestPath = `${prefix}${path}${method === "GET" ? buildQuery(query) : ""}`;
    const bodyText = method === "POST" && body !== undefined ? JSON.stringify(body) : "";
    const timestamp = now.toISOString();
    const signature = sign(this.apiSecret, preHash(timestamp, method, requestPath, bodyText));
    const headers: Record<string, string> = {
      "X-OC-APIKEY": this.apiKey,
      "X-OC-TIMESTAMP": timestamp,
      "X-OC-SIGN": signature,
      "X-OC-RECV-WINDOW": String(this.recvWindowMs),
      Accept: "application/json",
    };
    if (bodyText) headers["Content-Type"] = "application/json";
    const origin = new URL(this.baseUrl).origin;
    return { url: `${origin}${requestPath}`, headers, body: bodyText || undefined };
  }

  async request<T>(method: "GET" | "POST", path: string, query: Record<string, string | number | boolean | undefined> = {}, body?: unknown): Promise<T> {
    const req = this.prepare(method, path, query, body);
    const res = await this.fetchImpl(req.url, { method, headers: req.headers, body: req.body });
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Binance ${method} ${path}: HTTP ${res.status}, non-JSON body: ${text.slice(0, 200)}`);
    }
    if (!res.ok || (json && typeof json.code !== "undefined" && String(json.code) !== "000000" && String(json.code) !== "0")) {
      throw new Error(`Binance ${method} ${path}: HTTP ${res.status} code=${json?.code} ${json?.message ?? ""}`.trim());
    }
    return (json.data ?? json) as T;
  }

  // ---------------------------------------------------------------- RWA Data

  rwaPlatforms() {
    return this.request<unknown>("GET", "/api/v1/dex/market/rwa/platforms");
  }

  // Parameter names below were found by probing on 2026-10-10 (the docs list none): the chain is always
  // `binanceChainId`, platforms are `ondo` and `bstock`, and the price endpoint takes a comma list.

  rwaTokens(params: { platform?: string; sectorTab?: string; chainId?: string | number } = {}) {
    const { chainId, ...rest } = params;
    return this.request<unknown>("GET", "/api/v1/dex/market/rwa/tokens", { ...rest, binanceChainId: chainId });
  }

  rwaPrice(params: { chainId: string | number; contractAddresses: string }) {
    return this.request<unknown>("GET", "/api/v1/dex/market/rwa/price", { binanceChainId: params.chainId, tokenContractAddresses: params.contractAddresses });
  }

  rwaUnderlyingMarket(params: { chainId: string | number; contractAddress: string }) {
    return this.request<unknown>("GET", "/api/v1/dex/market/rwa/underlying-market", { binanceChainId: params.chainId, tokenContractAddress: params.contractAddress });
  }

  rwaUnderlyingProfile(params: { chainId: string | number; contractAddress: string }) {
    return this.request<unknown>("GET", "/api/v1/dex/market/rwa/underlying-profile", { binanceChainId: params.chainId, tokenContractAddress: params.contractAddress });
  }

  rwaSearch(params: { keyword: string; chainId?: string | number }) {
    return this.request<unknown>("GET", "/api/v1/dex/market/rwa/search", { keyword: params.keyword, binanceChainId: params.chainId });
  }

  /** Aggregated quote; `amount` is in the smallest unit of `fromTokenAddress`, `slippage` in percent. */
  quoteSwap(params: { chainId: string | number; fromTokenAddress: string; toTokenAddress: string; amount: string; slippage?: number; userAddress?: string }) {
    return this.request<unknown>("GET", "/api/v1/dex/aggregator/quote", {
      binanceChainId: params.chainId,
      fromTokenAddress: params.fromTokenAddress,
      toTokenAddress: params.toTokenAddress,
      amount: params.amount,
      slippage: params.slippage ?? 0.5,
      userAddress: params.userAddress,
    });
  }

  // ---------------------------------------------------------------- Trading

  quote(params: Record<string, string | number | boolean | undefined>) {
    return this.request<unknown>("GET", "/api/v1/dex/aggregator/quote", params);
  }

  swap(params: Record<string, string | number | boolean | undefined>) {
    return this.request<unknown>("GET", "/api/v1/dex/aggregator/swap", params);
  }

  approveTransaction(params: Record<string, string | number | boolean | undefined>) {
    return this.request<unknown>("GET", "/api/v1/dex/aggregator/approve-transaction", params);
  }

  // ---------------------------------------------------------------- Transaction

  simulate(body: unknown) {
    return this.request<unknown>("POST", "/api/v1/dex/pre-transaction/simulate", {}, body);
  }

  broadcast(body: unknown) {
    return this.request<unknown>("POST", "/api/v1/dex/pre-transaction/broadcast-transaction", {}, body);
  }

  gasPrice(params: { chainId: string | number }) {
    return this.request<unknown>("GET", "/api/v1/dex/pre-transaction/gas-price", params);
  }

  // ---------------------------------------------------------------- Wallet

  balances(params: { chainId: string | number; address: string }) {
    return this.request<unknown>("GET", "/api/v1/dex/balance/all-token-balances-by-address", params);
  }

  // ---------------------------------------------------------------- DeFi

  defiProtocols(body: unknown) {
    return this.request<unknown>("POST", "/api/v1/defi/data/protocol/list", {}, body);
  }

  defiPositions(body: unknown) {
    return this.request<unknown>("POST", "/api/v1/defi/data/position/list", {}, body);
  }

  defiDeposit(body: unknown) {
    return this.request<unknown>("POST", "/api/v1/defi/transaction/deposit", {}, body);
  }

  defiRedeem(body: unknown) {
    return this.request<unknown>("POST", "/api/v1/defi/transaction/redeem", {}, body);
  }

  defiLpAdd(body: unknown) {
    return this.request<unknown>("POST", "/api/v1/defi/transaction/lp-add", {}, body);
  }

  defiLpRemove(body: unknown) {
    return this.request<unknown>("POST", "/api/v1/defi/transaction/lp-remove", {}, body);
  }
}
