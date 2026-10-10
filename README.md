# Stockroom

Stock lending for bStocks on BNB Chain. Holders lend tokenized stocks they already own and earn a borrow fee in USDT while keeping every dividend. Borrowers post USDT and take the stock to short, hedge, market-make over the weekend or close a wrapper premium. It is the on-chain version of the Fully Paid Securities Lending Binance runs off-chain, built for BNB Hack: Tokenized Stocks Edition.

- Lenders deposit raw BEP-677 units into an ERC-4626 pool per ticker (`sNVDAB`). The borrower owes the same raw units back, so dividend and split multipliers flow to the lender by construction.
- Borrowers hold one USDT balance against shorts in many tickers. Fees accrue in USDT on the USD value of the debt and are credited to lenders as they accrue.
- Prices come from three sources that fail in different ways: APRO's on-chain bStocks feeds (relayed, see below), the PancakeSwap v3 TWAP of the deepest pool, and the last reference print of the underlying stock from the Binance RWA Data API. Closed-session debt is valued at the highest of the three plus a gap premium that grows 0.1 percent per hour the US market is shut, capped at 5 percent.
- A pending multiplier change (dividend, split) or a paused token stops new borrows. Repayment, withdrawal and liquidation never stop.
- Liquidations are Dutch auctions anyone can clear with no capital through a flash loan from the pool and a PancakeSwap buyback.

## Layout

| Path | What |
|---|---|
| `contracts/` | Foundry. `Controller`, `LendingPool`, `OracleRouter`, `RelayFeed`, `MarketCalendar`, `ShortRouter`, `Liquidator`, `RiskMath`. 101 unit tests plus 5 tests against a BSC mainnet fork. |
| `packages/sdk/` | ABIs, BSC addresses, the deployment loader and a signed client for the Binance Web3 Wallet API. |
| `apps/keeper/` | Relays APRO prices into the feeds, pushes reference anchors, runs the flash liquidator. |
| `apps/api/` | Read API: markets, rates feed (`/rates.json`), accounts, prepared calldata (`/tx/:action`, with a Binance Transaction API dry-run on `?simulate=1`), the paid feed over B402. |
| `apps/web/` | Next.js app: markets, lend and borrow panels, account health, rates, the desk, a plain-language explainer. |
| `skills/stockroom/` | Binance Agentic Wallet skill and helper script: lend, borrow, short and cover in plain language. |
| `agents/stockroomdesk/` | BNB Agent Studio seller: sells borrow desk briefs over A2A, MCP and x402 (ERC-8183), with read-only Stockroom tools. |
| `scripts/` | ABI export, fork checks, mainnet go-live, funding, recovery and ownership transfer. |
| `docs/` | Runbook, architecture and threat model, submission notes, raw material for the Developer Experience Report. |

## Getting started

Needs Foundry (forge, anvil, cast), Node 22+, pnpm 10 and a BSC RPC. Copy `.env.example` to `.env` and fill in what you have; nothing here reads keys from anywhere else.

```bash
pnpm install
pnpm contracts:test          # unit tests, no network
pnpm contracts:fork          # mainnet fork tests (BSC_RPC_URL, defaults to publicnode)
pnpm -r typecheck && pnpm -r test
```

Deploy to BSC mainnet (writes `contracts/deployments/56.json`):

```bash
cd contracts
forge script script/DeployBsc.s.sol --rpc-url $BSC_RPC_URL --broadcast --slow
```

Run the keeper and the API against that deployment:

```bash
pnpm keeper all              # or: pnpm keeper relay --once, DRY_RUN=1 pnpm keeper all
pnpm api                     # http://localhost:4310/markets, /rates.json, /account/<address>
```

`scripts/fork-e2e.sh` does the whole loop on a local anvil fork: deploy three markets, relay live prices, query the API. Public BSC RPCs refuse archive reads a few seconds after the fork starts, so use an archive-capable RPC for that script.

## Facts the design rests on (checked on BSC, 2026-10-10)

- bStocks are BEP-677 tokens (ERC-8056 Scaled UI Amount): `uiMultiplier()`, `newUIMultiplier()`, `effectiveAt()`, `toUIAmount()`, 18 decimals. NVDAB's multiplier was 1.0011 that day; raw balances never change on a corporate action.
- APRO publishes Chainlink-shaped feeds for 12 bStocks (NVDAB/USD at `0x310EFC9Fefe89B8085F89E91Ac782Bef6416499E`, 8 decimals, 1 percent deviation, 1 hour heartbeat) but they revert with "No access" for any contract caller. The keeper reads them from an EOA and relays the answer and timestamp into `RelayFeed`; one `setFeed` swaps the router to the APRO address once it is allowlisted.
- The PancakeSwap v3 NVDAB/USDT 0.25 percent pool (`0x8FB4243b…`) had $6.4M of liquidity, observation cardinality 1439 and a 30-minute TWAP within 0.1 percent of the APRO print.
- Venus lists NVDAB, TSLAB, SPCXB and SKHYB as collateral with borrow caps of zero. Nobody can borrow the stock itself anywhere on BSC.
- The PancakeSwap v3 `SwapRouter` (`0x1b81D678…`) takes the Uniswap v3 periphery structs with a `deadline`; the fork tests short and cover through it.

Web app (Next.js 16, shadcn, wagmi; reads the API, sends prepared calldata through any injected wallet):

```bash
cd apps/web && cp .env.example .env.local   # NEXT_PUBLIC_STOCKROOM_API=http://localhost:4310
pnpm --filter @stockroom/web dev            # http://localhost:3000
```

Agentic Wallet skill: point an agent at `skills/stockroom/SKILL.md` (install with `npx skills add <this repo>/skills/stockroom` once published). It needs `baw` 1.10.0, a signed-in Agentic Wallet with Developer Mode on, and the API URL in `STOCKROOM_API`.

Night Desk (the weekend market-making agent, run by the keeper wallet):

```bash
pnpm keeper nightdesk plan      # what it would do now
pnpm keeper nightdesk register  # ERC-8004 identity on BSC, once
pnpm keeper nightdesk run       # the Friday-to-Monday loop
```

Desk Analyst (the BNB Agent Studio seller; a separate keystore wallet, never the keeper's key):

```bash
cd agents/stockroomdesk/app/agent
pnpm install && pnpm test                 # desk maths and brief assembly, no network
bag wallet new --generate-password        # keystore in ../../.studio/wallets (gitignored)
bag llm activate                          # free Pieverse model, no deposit
bag dev --port 9010                       # card at /.well-known/agent-card.json, MCP at /mcp, x402 at /x402
bag erc8004 register --endpoint https://stockroom.adilhusain.xyz/agent/   # needs about 0.003 BNB in that wallet
```

A buyer sends the `negotiate` skill with a task such as "Desk brief for shorting 0.01 NVDAB against 10 USDT over the weekend", gets a wallet-signed quote (0.05 U), funds the ERC-8183 job, then sends `notify_funded`; the agent reads the Stockroom API through its `stockroom_*` tools and submits the brief on-chain. Live card: https://stockroom.adilhusain.xyz/agent/.well-known/agent-card.json.

## Status

Contracts, keeper, API, SDK, skill, Night Desk, web app and the Desk Analyst agent are built; unit, fork and TypeScript tests pass (`pnpm -r test`, `forge test`, the agent's `pnpm test`). Not yet done: the mainnet deployment (waiting on a funded deployer), live keeper runs, the APRO allowlist request, a recorded demo, and the Developer Experience Report. `docs/architecture.md` has the component map and the threat model.

## Money safety

Deposits are held per account inside the contracts; only the depositor can withdraw, redeem or claim, and no owner function can move user funds (the owner can only withdraw the insurance fund, which holds fees). Borrowers post 150 percent collateral, liquidations repay lenders, and the borrow caps at launch equal the seed sizes. `scripts/transfer-ownership.sh` hands the owner role to a hardware wallet after setup; `scripts/recover.sh` unwinds every position and sends everything back to a chosen address in one run. The contracts are unaudited; keep sizes small.
