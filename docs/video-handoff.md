# Demo video: handoff for the Claude session that will make it

Read this whole file first, then `docs/demo-script.md` (shot list), `docs/submission.md` (what is live, with hashes) and `README.md`. The vault note `Projects/Stockroom.md` has the history. Everything named here is live on BSC mainnet right now; nothing is mocked.

## The job

Produce one video, four minutes or less, 1920x1080, for the BNB Hack: Tokenized Stocks Edition submission (lock: Sunday 11 October 2026, 12:00 UTC). Screen recording of the real site and terminal, with narration generated from the script below through the ElevenLabs API, cut together with the video tooling available in this session (hyperframe and whatever else is installed). Title cards and lower thirds in the site's own look: concrete paper `#eef0ec`, blue-black ink `#161b1e`, signal orange `#d4541c`, Bricolage Grotesque for titles, Instrument Sans for everything else. No stock music that fights the voice; a quiet bed or none.

Adil is at the keyboard for the wallet. Claude in Chrome drives the site, fills the forms and presses the buttons; whenever the Binance Wallet extension opens, Adil approves and signs, and Claude waits for the page's "Done" toast before moving on. Claude never needs a key.

## What is live

- Site: https://stockroom.adilhusain.xyz (landing at `/`, desk at `/app`). API at `/api`. The Desk Analyst agent at `/agent/.well-known/agent-card.json`.
- Contracts on BSC mainnet, five markets (NVDAB, TSLAB, QQQB, SPCXB, CRCLB). Controller `0xbCD03d466a02adF97a953836D928548a660d1c9f`.
- The connected wallet in Chrome is the project's burner, `0x8a3eAef16b6Ad7c9c678bDc32B5d4791b3A0bC2C`, imported into the Binance Wallet extension. It holds about 0.0089 NVDAB, 1.6 USDT and 0.013 BNB in the wallet, plus, inside the contracts, 0.04 NVDAB lent and a 0.02 NVDAB short against 11.2 USDT of collateral (health factor about 1.9, liquidation near $448).
- Of that 0.02 owed, 0.01 is the demo short and 0.01 belongs to the Night Desk agent, which is holding a PancakeSwap v3 position (token 7653174) over the weekend and will repay on its own before Monday's open. So: cover 0.01, never "Cover all".
- The US market is closed all weekend; the site shows "Weekend" and a gap premium of about 3 percent. That is the point of the product, so leave it on screen.
- The Agentic Wallet skill runs from the VPS terminal (ssh to the VPS, `cd /root/Projects/stockroom`). The CLI is paired to Adil's Binance Agentic Wallet `0x7b6c346c69da73a1aaf9cbfedf4c07981fe263fc`, which holds 0.0477 NVDAB. Developer Mode is on.

## Amounts, exactly

| Shot | Action | Amount |
|---|---|---|
| 3 | Lend from the NVDAB page, Lend tab | 0.005 NVDAB |
| 4 | Cover from the NVDAB page, Short tab, "Cover" button | 0.01 NVDAB |
| 5 | Skill lend from the VPS terminal | 0.02 NVDAB |

Anything larger fails on balance or cap. Do not touch "Withdraw", "Add collateral" or "Cover all" on camera.

## Shots and the narration to generate

Narration is one voice, calm, plain, no hype. Target 3 minutes 40 seconds total. Each block below is one ElevenLabs request; keep the sentences as written.

**1. Landing, 0:00 to 0:35.** Open `/`, let the hero chart draw itself (it animates once on load; reload if you missed it), scroll to the worked example, drag the rate slider from 12 to 20 percent and press "A month".

> "Tokenized stocks on BNB Chain trade all weekend. Wall Street does not. And until now, nobody could borrow one. Stockroom is the lending desk. You lend the stock you already hold, you keep every dividend, and you earn the borrow fee in USDT. A borrower posts USDT and takes the stock, to short it, to hedge, or to make markets while New York sleeps."

**2. The desk, 0:35 to 1:10.** Open `/app`. Pause on the lent total and the orange out-on-loan bar, the NVDAB row, then the right rail: "Weekend", the four phases, the gap premium sentence.

> "Five markets, live on mainnet. Every price is relayed from APRO and cross-checked against the PancakeSwap average and Binance's own reference print; if they disagree, nobody can open new risk. The market is shut right now, so short debt carries a three percent gap premium until Monday. That premium is what pays for a Monday gap before it happens."

**3. A lend, 1:10 to 1:45.** Open `/app/market/NVDAB`. Type 0.005 in "Amount to lend", press Lend. Two wallet prompts (approve, deposit); Adil signs both. Keep the toast on screen: it names the step and says the Binance dry-run passed.

> "Lending is two signatures. Before the wallet even opens, the transaction has been simulated through the Binance Transaction API, and the page tells you so. You receive share tokens. The borrower owes the same number of raw units back, so dividends and splits land on you, not on them."

**4. The short, 1:45 to 2:20.** Open `/app/account`: the borrowing row, 0.02 owed, the liquidation price, the health factor. Then back on `/app/market/NVDAB`, Short tab, type 0.01 in "Amount to short" and press Cover. One signature. Then `/app/desk`.

> "This account also has a short open. It borrowed NVDAB against USDT and sold it on PancakeSwap in one transaction; the proceeds became margin. Covering buys it back and repays, in one transaction again. The other half of this debt belongs to our own agent, the Night Desk. It borrowed stock on Friday night, put it to work as PancakeSwap liquidity, and it will unwind and repay itself two hours before Monday's open."

**5. The Agentic Wallet skill, 2:20 to 3:05.** Terminal on the VPS, font large. Run, in order:

```bash
cd /root/Projects/stockroom && export STOCKROOM_API=https://stockroom.adilhusain.xyz/api
skills/stockroom/scripts/stockroom.sh market NVDAB
skills/stockroom/scripts/stockroom.sh preview lend ticker=NVDAB amount=0.02 account=0x7b6c346c69da73a1aaf9cbfedf4c07981fe263fc
skills/stockroom/scripts/stockroom.sh execute <requestId of step 1>
skills/stockroom/scripts/stockroom.sh preview lend ticker=NVDAB amount=0.02 account=0x7b6c346c69da73a1aaf9cbfedf4c07981fe263fc
skills/stockroom/scripts/stockroom.sh execute <requestId of step 2>
skills/stockroom/scripts/stockroom.sh account 0x7b6c346c69da73a1aaf9cbfedf4c07981fe263fc
```

The second preview exists because the deposit cannot pass simulation until the approve is mined. If an execute answers PENDING_CONFIRMATION, Adil confirms in the Binance app.

> "The same calldata works without a browser. This is Stockroom's Wallet Skill driving the Binance Agentic Wallet. Each step is dry-run by Binance, previewed by the wallet with its balance changes and a risk check, and executed only after a yes. Daily limits, the token list and Developer Mode are set in the Binance app, not by the agent."

**6. The Desk Analyst, 3:05 to 3:30.** Same terminal:

```bash
curl -s https://stockroom.adilhusain.xyz/agent/.well-known/agent-card.json | jq '{name, skills: [.skills[].id]}'
curl -s -X POST https://stockroom.adilhusain.xyz/agent/ -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":"1","method":"message/send","params":{"message":{"kind":"message","messageId":"demo-1","role":"user","parts":[{"kind":"data","data":{"skill":"negotiate","task_description":"Desk brief for shorting 0.01 NVDAB against 10 USDT over the weekend","terms":{"deliverables":"borrow desk brief","quality_standards":"every number from live Stockroom data"}}}]}}}' | jq '.result.parts[0].data.response.terms'
```

> "And a second agent sells research about the desk. The Stockroom Desk Analyst is a BNB Agent Studio seller, registered as ERC-8004 agent 371009. It quotes a signed price for a borrow desk brief, takes payment through ERC-8183 escrow, and writes the brief from read-only Stockroom tools."

**7. Close, 3:30 to 3:40.** Landing page, scrolled to the closing line "Keep the dividend. Collect the rent."

> "Keep the dividend. Collect the rent. Stockroom, on BNB Chain."

## Title cards

- Opening card, 2 seconds: "Stockroom" large, under it "Stock lending for bStocks on BNB Chain".
- Lower thirds, one per shot, small, bottom left: "Live on BSC mainnet", "Five markets, relayed prices", "Binance Transaction API dry-run", "Night Desk, ERC-8004 agent 371014", "Binance Agentic Wallet skill", "Desk Analyst, ERC-8004 agent 371009".
- Closing card, 3 seconds: "stockroom.adilhusain.xyz" and "github.com/adilhusain01/stockroom".

## Rules

- Record at 1920x1080, browser zoom 110 to 125 percent so the figures read, terminal font at least 18 px.
- Cut dead time (wallet prompts, confirmations) to a second or two; keep each toast visible for at least a second.
- No invented numbers in the narration; the words above are checked against what is live. If a transaction fails on camera, stop, paste the toast text to the VPS session, and do not improvise a retry with a different amount.
- Do not publish the video or any artifact from a Claude account that is not Adil's own; write the file to disk and let Adil upload it.
- Deliver `stockroom-demo.mp4` and the narration as separate `.mp3` files, named by shot, so a line can be re-recorded without a re-cut.
