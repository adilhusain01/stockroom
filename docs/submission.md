# Submission: Stockroom

**One line.** Stock lending for bStocks on BNB Chain: lend tokenized stocks and earn USDT while keeping every dividend; borrow them to short, hedge or make markets while Wall Street sleeps.

**Links.** Site: https://stockroom.adilhusain.xyz. Repo: https://github.com/adilhusain01/stockroom. API: https://stockroom.adilhusain.xyz/api (`/markets`, `/rates.json`, `/session`, `/account/:address`, `/tx/:action`, `/agent-card.json`). Contracts: `contracts/deployments/56.json`.

## What it is

Binance runs Fully Paid Securities Lending for its stock accounts off-chain. On-chain, 91 bStocks sit in wallets and on Venus with borrow caps of zero: nobody can borrow the stock itself anywhere on BSC. Stockroom is that market. Holders deposit raw BEP-677 units into an ERC-4626 pool per ticker and earn a USDT fee; borrowers post USDT and take the stock. Because the borrower owes raw units back, the dividend and split multiplier accrues to the lender by construction, which Binance's own off-chain program cannot do (it pays cash-in-lieu). The first borrower is an agent, Night Desk, which provides PancakeSwap liquidity with borrowed stock over the weekend and returns it before the Monday open.

## What is new

- A borrow market for the stock itself, not stock as collateral. Venus, Aave's Equities Hub, Kamino, Euler and Morpho are all collateral-only.
- A price router built for a 24/7 token with a 24/5 reference: the APRO feed, the PancakeSwap v3 TWAP and the last Binance reference print, the highest of the three, plus a gap premium that grows 0.1 percent per hour the US market is closed, capped at 5 percent. Borrows pause while a multiplier change is pending.
- Capital-free liquidations through an ERC-3156 flash loan from the pool and a PancakeSwap buyback.
- The first on-chain equity borrow rate on BNB Chain, published free at `/rates.json` and over B402 at `/paid/rates`.

## How the Binance Web3 API is used (module by module)

| Module | Where | What for |
|---|---|---|
| RWA Data `/rwa/tokens?platform=bstock` | `apps/keeper/src/binance-prices.ts` | the 91-token list with `tokenToShareRatio` and `statusInfo.nextOpenTime` |
| RWA Data `/rwa/price` | `apps/keeper/src/relay.ts` | on-chain prices for markets without an APRO feed, with `tokenPriceUpdatedAt` kept as the on-chain timestamp |
| RWA Data `/rwa/underlying-market`, `/rwa/underlying-profile` | `apps/keeper/src/anchor.ts`, `apps/keeper/src/binance-check.ts` | reference prints for the closed-session anchor, company facts |
| Trading `/aggregator/quote` | `apps/api/src/tx.ts` | live quotes behind the short and cover calldata (minimum out, maximum in) |
| Transaction `/pre-transaction/simulate`, `/gas-price` | `apps/api/src/tx.ts` | every prepared transaction is simulated before it is handed to a wallet |
| Wallet `/balance/all-token-balances-by-address` | `apps/api/src/chain.ts` | wallet balances on the account page |
| DeFi `/defi/data/investment/list` | `apps/keeper/src/nightdesk.ts` | the PancakeSwap v3 pool investment for Night Desk's position |
| B402 `/supported`, `/verify`, `/settle` | `apps/api/src/b402.ts` | the paid rate feed |
| Agentic Wallet (`baw contract-call`, `sign-message`) | `skills/stockroom/SKILL.md`, `skills/stockroom/scripts/stockroom.sh` | lend, borrow, short, cover in plain language; every step previewed and dry-run first |
| ERC-8004 identity | `apps/keeper/src/nightdesk.ts`, `agents/stockroomdesk` | Night Desk and the Desk Analyst register themselves on the BSC identity registry |
| BNB Agent Studio (`bag`, ERC-8183, A2A, MCP, x402) | `agents/stockroomdesk` | the Desk Analyst sells borrow desk briefs: signed quotes, on-chain job escrow in U or USDT, deliverables built from read-only Stockroom tools; card at `/agent/.well-known/agent-card.json` |

`docs/architecture.md` has the component map, the flows, who is trusted with what and the threat model.

## Live transactions (BSC mainnet, 11 October 2026)

Contracts, all from the deployer `0x8a3eAef16b6Ad7c9c678bDc32B5d4791b3A0bC2C`:

| Contract | Address |
|---|---|
| Controller | `0xbCD03d466a02adF97a953836D928548a660d1c9f` |
| OracleRouter | `0xB808bbd855b797aeD5BF29c4D12e3b64d10947E9` |
| ShortRouter | `0xD26f84E4D11f5765147f421303008c9FBB1f5012` |
| Liquidator | `0x13d046df01A2B24dFf47864C525b8800210331EC` |
| MarketCalendar | `0x8D81cD41ef1a64e762D9aEcC4601bacFe6ba9528` |
| NVDAB pool / relay feed | `0x9420cE0bf07edC8C598cd5b9e5e10D3E0fbEe712` / `0x84E777068790f1ADCd57d003e493045558530822` |
| TSLAB pool / relay feed | `0xc7Dc0fcF9FC14B91b6E6F10bB21b1e0A7eCB0cE4` / `0xE4FE0C5Ec63cF3614dfEf61c29E8eD7d6B1bb3cE` |
| QQQB pool / relay feed | `0xa8fb358f1d87Bca14A952cf5aDA317b0c20c0975` / `0x6594b9d62c02AeFbf041148e6133DE498286d189` |
| SPCXB pool / relay feed | `0x0ED279E43Ca95787d990D9396F718F81D607Aa06` / `0xa2D68BC3D2E070C6b69eBBc6A167f3E6869563c8` |
| CRCLB pool / relay feed | `0xC406FaCe8D27bB5A52763feAd78d3428DdC3d315` / `0x5850767a1c365c13fA3a9566e522A07d1958E52b` |

The full list with every feed is `contracts/deployments/56.json`, also served at `/api/deployment`. Deploy transactions are in `contracts/broadcast/DeployBsc.s.sol/56/run-latest.json` (Controller create: `0xaafbf50ddf93dab29f790c059070212a40f7263601ca21230049a8ef5a02f68b`).

| Step | Transaction |
|---|---|
| Buy 0.0477 NVDAB with 11 USDT on PancakeSwap v3 | `0x094d8d457e61459fa4ed9b647677622edf5c65c4cc066b38a7984f13d5ea0e0d` |
| First lend, 0.04 NVDAB into the pool | `0xf3862ad46d668a7afc910acff13349f6cc0b8e6605796bd715142f5de25f5127` |
| 3.9 USDT posted as collateral | `0x5a2d9ad66f3ec2b89340dc6dcf93ffc88ec18588f9967a5ac5e6d62bebce89e3` |
| Short router allowed as operator | `0x94b183d9f8a2856d3eede6dd4497009d73d5cc5866ea105ae319d9a96dcc9b4c` |
| First short, 0.01 NVDAB borrowed and sold in one transaction (health factor 2.09 after) | `0xbcbd00be8e21b06a10cdc7714cca191ff41c02b5cc0227c219c99bbf02b6e561` |
| Desk Analyst's ERC-8004 identity, agent 371009 | `0xd5842229f89b2fd1042885c88a8a896767583e9110754dd277d5b98ad8d84aac` |
| Night Desk's ERC-8004 identity, agent 371014 | `0x50bc4bac457141c348f4532516ad90eca8c68b6029763f50d6ab80ce20dfc146` |
| Night Desk opens its weekend position: 5 USDT posted, 0.01 NVDAB borrowed | `0x14ce605a6f43f84f2b4cb7539513604a9ae1ba99d78e2de27759a88bebde90ef`, `0xcb30fe57eb5fb95b814473fed0889f6d9c1253afa1a5fb27f5a40623b7207d18` |
| Night Desk mints its PancakeSwap v3 position (token 7653174, two percent either side of the price) | `0x8270bf03ae3e69a5a9ab3ec7ff3c4e4a332931a8812c94abb07a7c1f710143f5` |
| Demo day, 11 October: lend 0.005 NVDAB from the web app (approve, deposit) | `0xe9fa5242f6ac4834773d45eb77f0573bd192552eab25a45575454625f518946e`, `0x5d6b9e6216c10c7823a6661e4128fe862e9016ecedb75835f6128226031cb7ef` |
| Cover 0.01 NVDAB from the web app, one transaction | `0x3a48fb0fcddfd384cb369b5217be876ef9794a745ab62d85086b1af1d9243f82` |
| Lend 0.003 NVDAB from the web app (approve, deposit) | `0x2543124284cfa73d4bacc42dd8d0180f6223dc1fc643f27842c7d2a1d4a291d1`, `0x71a463cac2930d9c85cddcc36018a6745016febbf10bb3fb9d4a3a5f71ddd873` |
| Lend 0.02 NVDAB through the Wallet Skill and the Binance Agentic Wallet (approve, deposit) | `0xc305ad7aefdb3a9ddf5b6312e0b230a971895663553e25db411f7dc7051d4a52`, `0xef1fadf0219798ce3f4c4864617b28a90daca0b2aa0161945a9a2f4423aa0245` |

The demo short was covered on 11 October; the 0.01 NVDAB still owed is the Night Desk's weekend borrow (21 percent utilisation after the demo lends), which is why `/rates.json` shows a non-zero supply rate. Prices for all five markets are relayed by the keeper every two minutes.

## Form answers, ready to paste

- Project name: Stockroom
- One line: Stock lending for bStocks on BNB Chain: lend the tokenized stock you hold, keep every dividend, earn the borrow fee in USDT; borrow it to short, hedge or make markets while Wall Street sleeps.
- Which tokenized stocks: bStocks (NVDAB, TSLAB, QQQB, SPCXB, CRCLB live; any of the 91 can be listed).
- Deployed link: https://stockroom.adilhusain.xyz (app at /app, API at /api, agent card at /agent/.well-known/agent-card.json)
- Repository: https://github.com/adilhusain01/stockroom (public)
- Contracts: controller `0xbCD03d466a02adF97a953836D928548a660d1c9f` on BSC mainnet; full list in `contracts/deployments/56.json`
- Binance Web3 API modules used: RWA Data, Trading (aggregator quotes and swaps), Transaction (simulate, gas price), Wallet (balances), DeFi (investment list), B402 (paid rate feed), Agentic Wallet (contract-call preview and execute through `skills/stockroom`), BNB Agent Studio (`agents/stockroomdesk`), ERC-8004 (agents 371009 and 371014)
- Special prize tracks: Best Use of Agentic Wallet / Wallet Skills; Best Use of BNB Agent Studio
- What is new: the first market where the stock itself can be borrowed on BSC (Venus and the others take it only as collateral); a price router built for a 24/7 token with a 24/5 reference; capital-free liquidations; the first on-chain equity borrow rate on BNB Chain

## Team

Adil Husain and team. Built in 36 hours with Claude Code as the pair; all code in the repo, all tests in `contracts/test`.
