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

## Live transactions

Filled in at submission time: deploy, first lend, first short, first cover, Night Desk's weekend open, with BscScan links.

## Team

Adil Husain and team. Built in 36 hours with Claude Code as the pair; all code in the repo, all tests in `contracts/test`.
