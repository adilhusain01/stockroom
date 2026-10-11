# Runbook: Stockroom on BSC mainnet

Everything below runs from the repo root on the VPS. Secrets live in `.env` only. Live since 11 October 2026: controller `0xbCD03d466a02adF97a953836D928548a660d1c9f`, five markets, addresses in `contracts/deployments/56.json`.

## 1. The machine

| Process (pm2) | What | Port |
|---|---|---|
| `stockroom-api` | Hono read API and transaction builders | 127.0.0.1:4310, public at `/api` |
| `stockroom-web` | Next.js app | 127.0.0.1:3020, public at `/` |
| `stockroom-keeper` | relay every 2 minutes, liquidation scan every 30 seconds, anchors hourly | |
| `stockroom-desk` | the Night Desk loop, one step every 5 minutes | |
| `stockroom-agent` | the Desk Analyst (BNB Agent Studio, `bag dev`) | 127.0.0.1:9010, public at `/agent` |

```bash
pnpm exec pm2 list
pnpm exec pm2 logs stockroom-keeper --lines 50
pnpm exec pm2 restart stockroom-keeper stockroom-desk stockroom-api --update-env   # after a .env change
```

Caddy (`/etc/caddy/Caddyfile`): `handle_path /api/*` to 4310, `handle_path /agent/*` to 9010, everything else to 3020. The web app is built with `NEXT_PUBLIC_STOCKROOM_API=https://stockroom.adilhusain.xyz/api` in `apps/web/.env.local`.

## 2. RPCs, learned the hard way

- `BSC_RPC_URL=https://bsc-dataseed.binance.org` for reads, sends and receipts. publicnode gated receipt reads with "Archive requests require a personal token" in the middle of the first swap.
- `LOGS_RPC_URL=https://bsc-rpc.publicnode.com` for `eth_getLogs`; dataseed refuses every log query and refuses logs inside a JSON-RPC batch. The keeper reads logs unbatched in 1,000-block windows from `DEPLOY_BLOCK=126968300`.
- The sending scripts (`go-live.sh`, `fund-from-bnb.sh`, `seed-mainnet.sh`, `recover.sh`, `transfer-ownership.sh`) use dataseed unless `GO_LIVE_RPC` says otherwise.
- Anvil forks of BSC die within seconds on every public RPC; `scripts/fork-sandbox.sh` needs a keyed archive RPC.

## 3. Deploying again (only if ever needed)

`contracts/deployments/56.json` exists, and `scripts/go-live.sh` refuses to redeploy while it does. To deploy a fresh set, move the file away, then `MARKETS=5 scripts/go-live.sh`: it swaps BNB into USDT and NVDAB (skipping what is already there), deploys, relays the first prices, runs the first lend and short, starts the services, funds the Desk Analyst wallet with 0.003 BNB and registers its ERC-8004 identity. The deployer needs 0.02 BNB once the USDT is in place, 0.03 from scratch.

## 4. Night Desk

State lives in `apps/keeper/runs/nightdesk.json` next to the process that runs it; if a position is opened by hand from another checkout, copy that file over before restarting the pm2 loop or the loop will try to open a second one. `pnpm keeper nightdesk plan` prints what the loop would do now. Sizes come from `NIGHTDESK_BORROW` and `NIGHTDESK_COLLATERAL` in `ecosystem.config.cjs` (0.01 NVDAB against 5 USDT). The loop opens while the session is closed and closes two hours before the next open, buying back any shortfall with the burner's USDT; keep a few USDT in the burner for that.

## 5. Desk Analyst

```bash
cd agents/stockroomdesk/app/agent
bag wallet status            # keystore 0xf38eD31AcD342c17AA38ca0fA02215AFD1EBa265, secrets in ../../.studio (never in git)
bag erc8004 show --network bsc-mainnet   # agent 371009
pnpm test                    # desk maths, no network
```

The agent card is at `/agent/.well-known/agent-card.json`, MCP at `/agent/mcp`, the x402 face stays dormant until a B402 merchant is approved for that wallet. `.studio/` holds the keystore and the Pieverse LLM key; it is copied by hand between checkouts.

## 6. Agentic Wallet skill

The `baw` CLI is paired on the VPS to Adil's Agentic Wallet `0x7b6c346c69da73a1aaf9cbfedf4c07981fe263fc` (session to 12 October 23:50 CEST; `baw wallet status --json` is the truth). `skills/stockroom/scripts/stockroom.sh preview lend ticker=NVDAB amount=0.02 account=0x7b6c…` previews each step with the Binance dry-run and the wallet's own simulation; `execute <requestId>` sends one step. Previews expire, so preview again right before each execute. Developer Mode is on in the Binance app until 17 October.

## 7. Pausing and emergencies

The keeper is the guardian: `setGlobalBorrowPause(true)` on the Controller stops every new borrow in one transaction; repay, withdraw and liquidate keep working. `setBorrowPaused(token, true)` does it per market. `scripts/recover.sh` unwinds everything the burner holds (desk close, cover or repay, withdraw, redeem, claim, sell bStocks to USDT) and sends it to `RECOVER_TO` (default: Adil's Binance deposit address); it also sweeps the analyst wallet's BNB.

## 8. When APRO allowlists the OracleRouter

```bash
cast send <oracle> "setFeed(address,address,uint32)" <token> <aproFeed> 3600 --private-key $DEPLOYER_PRIVATE_KEY
```

per market, and the relay for that market becomes redundant (leave the keeper running; it keeps the cash feed and anchors).
