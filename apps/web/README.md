# Stockroom web app

Next.js 16 (App Router, Cache Components), shadcn on Base UI, Tailwind v4, wagmi with the injected connector, TanStack Query. It reads the Stockroom API and sends the API's prepared calldata through whichever wallet the browser injects.

Pages: `/` is the landing page (the idea in one chart, a worked example, how it works, safeguards). The desk lives under `/app`: markets overview, `/app/market/[ticker]` with the lend and short panel, `/app/account`, `/app/desk` (Night Desk), `/app/rates`. Old paths redirect.

```bash
cp .env.example .env.local        # NEXT_PUBLIC_STOCKROOM_API, default http://localhost:4310
pnpm dev                          # http://localhost:3000, needs the API running (pnpm api from the repo root)
pnpm build && pnpm start          # production; pm2 runs this as stockroom-web on 127.0.0.1:3020
```

Design tokens live in `src/app/globals.css` (concrete paper, blue-black ink, signal orange; Bricolage Grotesque, Instrument Sans, JetBrains Mono). Shared pieces are in `src/components/sheet.tsx`; the app frame is `src/components/app-shell.tsx`. Every transaction goes through `src/hooks/use-tx.ts`, which asks the API for the steps with `simulate=1` so the Binance Transaction API dry-run is shown before the wallet opens.

`AGENTS.md` here is written by `next dev` and points at the bundled Next.js docs; leave it alone.
