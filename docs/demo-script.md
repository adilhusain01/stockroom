# Demo video, shot list (4 minutes or less)

Everything below is live on BSC mainnet as of 11 October 2026, 06:30 UTC. Record in this order; each shot has what to show and the one line to say. Keep the amounts as written: the wallets hold exactly these.

## 1. The idea (30 s)

Open https://stockroom.adilhusain.xyz. Scroll the hero and the chart once, stop on the worked example and drag the rate slider.

Say: "bStocks trade all weekend, Wall Street does not, and until now nobody could borrow one. Stockroom is the lending desk: lend the stock you hold, keep every dividend, earn the borrow fee in USDT."

## 2. The desk (40 s)

Open https://stockroom.adilhusain.xyz/app. Point at the lent total, the out-on-loan bar, the NVDAB row (25 percent out, a live supply rate), the session rail on the right (Weekend, gap premium).

Say: "Five markets, every price relayed from APRO and cross-checked against PancakeSwap and Binance's reference print. The market is shut, so short debt carries a 3 percent gap premium until Monday."

## 3. A lend through the web app (40 s)

Connect the burner wallet (or any wallet holding NVDAB) and open https://stockroom.adilhusain.xyz/app/market/NVDAB. Lend 0.005 NVDAB. The toast shows the Binance Transaction API dry-run before the wallet opens.

Say: "Every transaction is simulated through the Binance Transaction API before the wallet sees it."

## 4. The short that is already open (30 s)

Open https://stockroom.adilhusain.xyz/app/account with the burner connected. Show the borrowing row: 0.01 NVDAB owed, liquidation price, health factor. Press Cover all and confirm.

Say: "This short was opened against 3.9 USDT; the sale proceeds became margin. Cover buys it back and repays in one transaction."

## 5. The Agentic Wallet skill (50 s)

Terminal on the VPS (the CLI is paired there), from the repo root:

```bash
export STOCKROOM_API=https://stockroom.adilhusain.xyz/api
skills/stockroom/scripts/stockroom.sh market NVDAB
skills/stockroom/scripts/stockroom.sh preview lend ticker=NVDAB amount=0.02 account=0x7b6c346c69da73a1aaf9cbfedf4c07981fe263fc
skills/stockroom/scripts/stockroom.sh execute <requestId of step 1>
skills/stockroom/scripts/stockroom.sh preview lend ticker=NVDAB amount=0.02 account=0x7b6c346c69da73a1aaf9cbfedf4c07981fe263fc
skills/stockroom/scripts/stockroom.sh execute <requestId of step 2>
skills/stockroom/scripts/stockroom.sh account 0x7b6c346c69da73a1aaf9cbfedf4c07981fe263fc
```

Say: "The same calldata, driven by the Binance Agentic Wallet. Each step is dry-run by Binance, previewed by the wallet with its balance changes and risk check, and executed only after a yes. Developer Mode, daily limits and the token list are set in the Binance app."

## 6. The Desk Analyst agent (30 s)

```bash
curl -s https://stockroom.adilhusain.xyz/agent/.well-known/agent-card.json | jq '{name, skills: [.skills[].id]}'
curl -s -X POST https://stockroom.adilhusain.xyz/agent/ -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":"1","method":"message/send","params":{"message":{"kind":"message","messageId":"demo-1","role":"user","parts":[{"kind":"data","data":{"skill":"negotiate","task_description":"Desk brief for shorting 0.01 NVDAB against 10 USDT over the weekend","terms":{"deliverables":"borrow desk brief","quality_standards":"every number from live Stockroom data"}}}]}}}' | jq '.result.parts[0].data.response.terms'
```

Say: "A BNB Agent Studio seller, ERC-8004 agent 371009. It quotes a signed price for a borrow desk brief, takes payment through ERC-8183 escrow, and writes the brief from read-only Stockroom tools."

## 7. Close (10 s)

Back on the landing page, the closing line. Say: "Keep the dividend. Collect the rent. Stockroom, on BNB Chain."

## Before recording

- `baw wallet status --json` on the VPS must say CONNECTED (the session lasts until 12 October 23:50 CEST).
- Preview request ids expire; run the preview again right before each execute.
- The burner's position and the lending row are visible to anyone at `/api/account/0x8a3eAef16b6Ad7c9c678bDc32B5d4791b3A0bC2C`.
