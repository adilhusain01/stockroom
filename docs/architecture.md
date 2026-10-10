# Stockroom architecture

Stockroom is a stock lending and borrowing market for Binance bStocks on BNB Chain. Holders lend NVDAB, TSLAB and the other bStocks into per-stock pools and earn USDT. Borrowers post USDT collateral and take delivery of the stock, or short it in one transaction. Everything that moves money is a contract on BSC mainnet; everything off-chain only reads, relays prices, or prepares calldata for a wallet to sign.

This document is the map: what each piece does, how a transaction flows, who is trusted with what, and what can go wrong. Facts marked "checked" were verified on BSC or against the code on 2026-10-10.

## Components

```
                Binance Web3 APIs                     APRO price feeds (EOA readers only)
        RWA data, Trading quotes, Transaction dry-run             |
                        |                                         |
                        v                                         v
   Web app (Next.js) -> API (Hono, read model + /tx builders)   keeper: relay, anchor, liquidate, night desk
   Agentic Wallet skill -> API /tx/:action -> baw contract-call         |
   Agent Studio seller (A2A, MCP, x402) -> API reads                    |
                        |                                               |
                        v                                               v
   -------------------------------- BNB Smart Chain (56) --------------------------------
   Controller -- LendingPool x N -- OracleRouter -- RelayFeed x N -- MarketCalendar
       |              |                 |
   ShortRouter    Liquidator       PancakeSwap v3 (TWAP source, swap venue)
```

### Contracts (`contracts/src`)

| Contract | Job | Notes |
|---|---|---|
| `Controller` | Accounts, USDT collateral, borrows across every market, fee accrual, health factor, liquidation | Fees are simple interest on the USD value of the debt; 90 percent goes to the lenders of that market, 10 percent to the protocol (`LENDER_SHARE_BPS = 9000`, checked). Liquidation is a Dutch auction: half the position while health is between 0.95 and 1.0, the whole position below 0.95 (`FULL_CLOSE_HEALTH`, checked); the discount grows from the market's `dutchMin` to `dutchMax` over `dutchDuration`. |
| `LendingPool` (one per stock) | ERC-4626 style shares over raw bStock units, idle versus borrowed accounting, USDT fee claims, ERC-3156 flash loans at 5 bps | Shares are multiplier-aware: a dividend or split changes the BEP-677 `uiMultiplier` and lenders' effective shares follow it, so a lender gets back the same number of shares the token says they own. `maxUtilisation` is fixed per pool. |
| `OracleRouter` | One price per token for the risk engine, plus the regime | Combines the relayed APRO price, the PancakeSwap v3 TWAP and the Binance reference anchor. Regimes: `Paused` (multiplier change pending or token paused), `Degraded` (feed older than heartbeat plus 30 minutes, or feed and TWAP disagree beyond the market's band), `Open` (US extended hours), `Closed` (everything else). While closed, debt is valued with a gap premium of 0.1 percent per hour closed, capped at 5 percent (checked). No new borrows in `Paused` or `Degraded`, nor in the guard window just before the open. |
| `RelayFeed` (one per stock) | Chainlink-shaped feed the keeper writes | Exists because APRO's bStock feeds revert for contract callers (checked: "No access"). |
| `MarketCalendar` | US session calendar on-chain | Open and close seconds, weekends, holidays, next open; drives the regime and the gap premium. |
| `ShortRouter` | Borrow, sell on PancakeSwap v3, deposit the proceeds as margin, in one transaction; cover does the reverse | Acts as an operator the user approves once; never custodies funds between steps. |
| `Liquidator` | Flash-loan liquidation anyone can call | Borrows the stock from its pool, repays the unhealthy account, sells the USDT it receives, returns the loan, keeps the difference. |
| `RiskMath` / `RiskMathRef` | Pure maths: ratios, health, Dutch discount | `RiskMathRef` is the reference implementation the tests compare against. |

Market parameters per stock (tier, initial ratio, liquidation threshold, deviation band, borrow cap, Dutch auction shape) live in `contracts/script/config/bsc-markets.json` and are set at deploy.

### Off-chain (`apps/`, `packages/`, `skills/`, `agents/`)

- `apps/keeper`: `relay` reads APRO from an externally owned account and writes `RelayFeed` every two minutes or on deviation; `anchor` writes the Binance RWA reference price times the multiplier once an hour; `liquidate` scans accounts every 30 seconds and calls the `Liquidator`; `nightdesk` is the weekend agent (borrow after the Friday close, provide PancakeSwap liquidity, unwind before the Monday open, repay) with an ERC-8004 identity.
- `apps/api`: the read model (`/markets`, `/session`, `/account`, `/rates.json`), transaction builders (`/tx/:action` returns `{to, data, value, chainId, description}` lists), a Binance Transaction API dry-run for each step (`?simulate=1`), a paid rate feed over B402 (`/paid/rates`), and the agent card.
- `apps/web`: the Next.js app. It only ever sends what `/tx` prepared, through the user's own wallet.
- `packages/sdk`: ABIs, addresses, the deployment loader and the signed Binance Web3 client.
- `skills/stockroom`: the Binance Agentic Wallet skill and helper script; the wallet previews and executes the same prepared calldata.
- `agents/stockroomdesk`: the BNB Agent Studio seller. It sells borrow desk briefs over A2A, MCP and x402, reads only the API, and signs only ERC-8183 quotes and deliverables with its own wallet.

## Flows

Lend. The user approves the pool and calls `deposit(raw, receiver)`. They receive shares. Fees accrue in USDT per raw unit borrowed and are claimed with `claim(to)`. Withdrawal needs idle liquidity; a pool at `maxUtilisation` refuses new borrows so some liquidity always comes back.

Borrow or short. The user deposits USDT collateral into the `Controller`, then either `borrow(token, raw, to)` to take delivery or, after `setOperator`, calls the `ShortRouter`, which borrows, sells on PancakeSwap v3 with a minimum output taken from a live Binance quote, and deposits the USDT as margin. Cover buys back with a maximum input and repays in the same transaction.

Price. The keeper reads APRO (which refuses contracts) and writes the `RelayFeed`. The router cross-checks that price against the pool TWAP and the hourly anchor. Disagreement or staleness means `Degraded`: positions keep their last valuation, nobody can open new risk.

Corporate action. A pending multiplier change (`effectiveAt` in the future) sets `Paused`. Borrows stop; open positions carry on and the pool's share accounting moves with the multiplier when it applies.

Liquidation. Health below 1.0 starts an auction clock on the account. A liquidator repays part of the debt in stock and receives USDT at the current discount; below 0.95 the whole position can be closed. The `Liquidator` contract makes this possible with no capital.

## Trust and powers

| Party | Can | Cannot |
|---|---|---|
| Owner (two-step `Ownable`, the deployer burner today) | List markets, set tiers, caps and guards, pause borrows, change the keeper, set the gap premium curve | Move user collateral or lent stock, mint shares, change a feed answer directly, bypass the health check |
| Keeper (same burner today) | Write relayed prices and anchors, run liquidations like anyone else, operate the night desk's own account | Withdraw anyone else's funds. A wrong price is bounded by the TWAP band: beyond it the router flags `Degraded` and borrows stop |
| Any user | Lend, borrow, short, cover, repay, liquidate unhealthy accounts | Borrow past the cap, past the pool's `maxUtilisation`, or below the initial ratio |
| API and web | Prepare calldata, show state | Sign. Every step is previewed in the user's wallet; `?simulate=1` runs the Binance dry-run first |
| Agent Studio seller | Sign ERC-8183 quotes and submit deliverables with its own wallet; read the API | Touch Stockroom contracts; its LLM has read-only tools and the price is fixed in config |

## Threat model

| Threat | Effect | What limits it | What remains |
|---|---|---|---|
| Issuer freezes or blocklists a bStock address | Borrowed stock cannot be returned, pool withdrawals wait | `Paused` regime stops new borrows; caps keep exposure small | Frozen tokens stay frozen; no insurance fund in this version |
| Dividend or split mid-position | Debt and shares measured in raw units drift from what the token shows | Multiplier-aware shares and debt; `Paused` while a change is pending | A change applied between keeper runs is caught at the next relay |
| Keeper down or APRO stale | Prices age | Heartbeat plus 30 minute grace, then `Degraded`: no new borrows | Liquidations keep using the last price until the feed returns |
| Keeper lies | Wrong valuation could trigger or hide liquidations | Deviation band against the pool TWAP and the anchor; outside it the router goes `Degraded` | Within the band the keeper is trusted; the band is per market and set small for deep pools |
| TWAP manipulation on PancakeSwap | Could pull the router's cross-check | TWAP window, anchor cross-check, feed as primary source, low caps on shallow pools | A sustained multi-block attack on a thin pool is costly but possible; caps bound the damage |
| Weekend gap | Stock opens far from Friday's close | Gap premium grows while closed (up to 5 percent), higher initial ratios, Dutch auction liquidation at the open | A gap beyond the collateral leaves bad debt in that market |
| Owner key compromise | Parameters changed | No function moves user funds; two-step transfer; caps and pauses are the worst case | A hostile owner can halt new borrows |
| Keeper key compromise | Prices pushed within the band; night desk funds taken | Band, caps, burner holds only gas and demo sizes | Night desk funds are at risk |
| API or web tampering | Bad calldata offered to users | The wallet shows the decoded call, balance and allowance changes; the Binance dry-run reports the outcome; contracts enforce every limit regardless | A user who signs without reading can still lose what they approve |
| Slippage or sandwich on short and cover | Worse fill | `minOut` and `maxIn` from a live Binance quote with a user-chosen band | A fill outside the band reverts |
| Agent Studio seller compromise | Bad briefs, wasted quotes | Signing is fixed code, tools are read-only, price fixed, separate wallet | Reputation, not funds |

Not done: no external audit. Unit and BSC fork tests cover the contracts (`forge test`), and the first markets run with small borrow caps.

## Addresses that matter (checked on BSC)

| What | Address |
|---|---|
| NVDAB (BEP-677, 18 decimals) | `0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436` |
| USDT | `0x55d398326f99059fF775485246999027B3197955` |
| PancakeSwap v3 SwapRouter | `0x1b81D678ffb9C0263b24A97847620C99d213eB14` |
| NVDAB/USDT 0.25 percent pool | `0x8FB4243b553aC29BA088aCf00B9B7dA24bD6690C` |
| APRO NVDAB/USD feed | `0x310EFC9Fefe89B8085F89E91Ac782Bef6416499E` |
| ERC-8004 identity registry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |

Stockroom's own contract addresses are written to `contracts/deployments/56.json` at deploy and served at `/api/deployment`.
