export const API_URL = process.env.NEXT_PUBLIC_STOCKROOM_API ?? "http://localhost:4310";

export type Regime = "Open" | "Closed" | "Paused" | "Degraded";

export interface Market {
  ticker: string;
  token: `0x${string}`;
  lendingPool: `0x${string}`;
  feed: `0x${string}`;
  aproFeed: `0x${string}` | null;
  dexPool: `0x${string}`;
  multiplier: string;
  multiplierPending: boolean;
  totalAssets: string;
  idle: string;
  totalBorrows: string;
  utilisation: string;
  borrowRateApr: string;
  supplyRateApr: string;
  borrowCapRaw: string;
  borrowPaused: boolean;
  price: string;
  regime: Regime;
  feedPrice: string;
  feedUpdatedAt: number;
  twapPrice: string | null;
  anchorPrice: string | null;
  borrowAllowed: boolean;
  initialRatio: string;
  liqThreshold: string;
  dexLiquidity: string;
}

export interface Session {
  now: number;
  isOpen: boolean;
  nextOpen: number;
  closedForSec: number;
  gapPremium: string;
  openSeconds: number;
  closeSeconds: number;
}

export interface Account {
  address: `0x${string}`;
  collateral: string;
  pendingFees: string;
  unpaidFees: string;
  healthFactor: string | null;
  auctionStartedAt: number;
  positions: { ticker: string; token: `0x${string}`; debtRaw: string; priceUsd: string; valueUsd: string }[];
  lending: { ticker: string; lendingPool: `0x${string}`; shares: string; assets: string; effectiveShares: string; claimableUsdt: string }[];
}

export interface PreparedTx {
  to: `0x${string}`;
  data: `0x${string}`;
  value: "0";
  chainId: 56;
  description: string;
}

export interface Deployment {
  chainId: number;
  controller: `0x${string}`;
  oracle: `0x${string}`;
  shortRouter: `0x${string}`;
  liquidator: `0x${string}`;
  usdt: `0x${string}`;
  keeper: `0x${string}`;
  tickers: string[];
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? `${res.status} from the API`);
  return body as T;
}

export const api = {
  markets: () => get<{ updatedAt: string; markets: Market[] }>("/markets").then((r) => r.markets),
  market: (ticker: string) => get<Market>(`/markets/${ticker}`),
  session: () => get<Session>("/session"),
  account: (address: string) => get<Account>(`/account/${address}`),
  deployment: () => get<Deployment>("/deployment"),
  tx: (action: string, params: Record<string, string | number | undefined>) => {
    const q = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    return get<{ txs: PreparedTx[] }>(`/tx/${action}${q ? `?${q}` : ""}`).then((r) => r.txs);
  },
};

export function fmt(n: string | number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || n === "") return "–";
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return "–";
  return x.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function pct(n: string | number | null | undefined, digits = 2): string {
  if (n === null || n === undefined) return "–";
  return `${fmt(Number(n) * 100, digits)}%`;
}

export function shortAddress(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function duration(seconds: number): string {
  if (seconds <= 0) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
