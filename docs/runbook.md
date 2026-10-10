# Runbook: Stockroom on BSC mainnet

Everything below runs from the repo root on the VPS. Secrets live in `.env` only.

## 1. Before deploying

- `.env` has `DEPLOYER_PRIVATE_KEY`, `DEPLOYER_ADDRESS`, `KEEPER_PRIVATE_KEY`, `KEEPER_ADDRESS` (the same burner for both is fine), `BSC_RPC_URL`, and when available `BINANCE_WEB3_API_KEY`, `BINANCE_WEB3_API_SECRET`, `BSCSCAN_API_KEY`.
- The deployer holds at least 0.03 BNB. The full 15-market deploy simulated at 74.7M gas, about 0.004 BNB at 0.05 gwei; the lean plan deploys five.
- `cd contracts && forge test` passes, and `forge test --match-path "test/fork/*" --no-match-path zzz` passes against the live chain.
- `contracts/script/config/bsc-markets.json` lists the markets in priority order. The lean plan is `DEPLOY_MARKET_COUNT=5` (NVDAB, TSLAB, QQQB, SPCXB, CRCLB, all with APRO feeds); the other ten deploy later with the same command and a higher count once the first five are listed (re-running redeploys everything, so decide the count before broadcasting).

## 2. Deploy

```bash
cd contracts
set -a; . ../.env; set +a
forge script script/DeployBsc.s.sol --rpc-url $BSC_RPC_URL --broadcast --slow -vv
cat deployments/56.json          # commit this file
```

Verify on BscScan (optional, needs the key; repeat per contract or use the broadcast file with `forge verify-contract`):

```bash
forge verify-contract --chain 56 --etherscan-api-key $BSCSCAN_API_KEY <controller> src/Controller.sol:Controller \
  --constructor-args $(cast abi-encode "constructor(address,address,address,address)" <usdt> <oracle> <riskEngine> <deployer>)
```

## 3. Prices on-chain

The RelayFeeds are empty right after the deploy, so every market quote reverts until the keeper has written once:

```bash
pnpm keeper relay --once        # reads APRO from the keeper wallet, writes 13 feeds (12 bStocks + USDT)
curl -s localhost:4310/markets | head -c 400   # after the API is up
```

Markets without an APRO feed (GOOGLB, AAPLB, MSTRB, SPYB, HOODB, AMZNB) stay unpriced until `BINANCE_WEB3_API_KEY` is set; the keeper then takes their on-chain price from the RWA Data API. Pause borrows on those markets until then: `cast send <controller> "setBorrowPaused(address,bool)" <token> true` from the keeper.

## 4. First live transactions

`scripts/fund-from-bnb.sh` turns part of the burner's BNB into USDT and NVDAB on PancakeSwap, so the only transfer needed is BNB. `scripts/seed-mainnet.sh` then lends 0.05 NVDAB, deposits 10 USDT, allows the short router, shorts 0.01 NVDAB and covers it. Budget: 0.05 BNB in the burner (about $37); about $8 is spent over the hackathon, the rest comes back. Every step prints its hash; record them in the submission.

## 5. Services

```bash
pm2 start ecosystem.config.cjs && pm2 save     # keeper, desk, api, web
pm2 logs stockroom-keeper --lines 50
```

Caddy block for `/etc/caddy/Caddyfile` (DNS: A record `stockroom.adilhusain.xyz` to the VPS IP first), then `systemctl reload caddy`:

```
stockroom.adilhusain.xyz {
    handle_path /api/* {
        reverse_proxy 127.0.0.1:4310
    }
    reverse_proxy 127.0.0.1:3020
}
```

The web app is built with `NEXT_PUBLIC_STOCKROOM_API=https://stockroom.adilhusain.xyz/api` in `apps/web/.env.local` before `pnpm --filter @stockroom/web build`.

## 6. Night Desk

```bash
pnpm keeper nightdesk register     # ERC-8004 identity, once, about $0.01 of gas
pnpm keeper nightdesk plan         # what it would do now
```

The pm2 `stockroom-desk` process runs the loop: borrow after the Friday close, LP on PancakeSwap, unwind two hours before the Monday open. Sizes come from `NIGHTDESK_BORROW` and `NIGHTDESK_COLLATERAL` in `ecosystem.config.cjs`; keep them small.

## 7. When APRO allowlists the OracleRouter

```bash
cast send <oracle> "setFeed(address,address,uint32)" <token> <aproFeed> 3600 --private-key $DEPLOYER_PRIVATE_KEY
```

per market, and the relay for that market becomes redundant (leave the keeper running; it keeps the cash feed and anchors).

## 8. Pausing

The keeper is the guardian: `setGlobalBorrowPause(true)` on the Controller stops every new borrow in one transaction; repay, withdraw and liquidate keep working. `setBorrowPaused(token, true)` does it per market.
