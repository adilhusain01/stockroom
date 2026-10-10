# Notes for the Developer Experience Report

Raw material only. The report itself has to be written by a person (the rules reject AI-written reports), so this is a list of what happened, with the page or endpoint each point is about, for Adil to write from. Dates are 2026-10-10 unless noted.

## Onboarding and docs

- The dev docs site (web3.binance.com/en/dev-docs) sits behind an AWS WAF challenge: `curl` gets an empty 202, and so do `llms.txt` and `llms-full.txt`, which exist specifically for agents. A fetcher that executes the challenge reads them fine. Agents cannot.
- The authentication page is the one that matters and it is not linked from the hackathon page's "API modules" list. Base URL `https://web3.binance.com/build`, headers `X-OC-APIKEY`, `X-OC-TIMESTAMP` (ISO 8601 with milliseconds), `X-OC-SIGN` (base64 HMAC-SHA256 over timestamp + METHOD + `/build` path with query + body). The `/build` prefix inside the signed path is the documented top cause of error 40102. The worked example on that page let us write the client and a unit test before having a key.
- The RWA Data docs list the six endpoints with one line each and no parameter or response fields. With the key in hand (2026-10-10) we found by trial: the chain parameter is `binanceChainId` everywhere (not `chainId`), `/rwa/price` takes `tokenContractAddresses` (comma list) and returns `tokenPrice`, `referencePrice`, `tokenPriceUpdatedAt` (milliseconds), `/rwa/underlying-market` and `/rwa/underlying-profile` take `tokenContractAddress`, `/rwa/tokens` takes `platform` with the ids `ondo` and `bstock` (the hackathon page writes "bStocks") and returns `tokenToShareRatio` (the BEP-677 multiplier), `statusInfo.openState`, `nextOpenTime`, `tokenPrice` and `referencePrice` for all 91 bStocks in one call. Wrong parameter names return HTTP 200 with `code: 40001` and no message, so the first hour with the key was spent guessing names. `/aggregator/quote` takes `binanceChainId`, `fromTokenAddress`, `toTokenAddress`, `amount` (smallest unit) and `slippage` (percent) and routes bStocks through LiquidMesh with a `quoteId`; a 10 USDT quote for NVDAB came back at $230.76 with 0.05 percent impact.
- The hackathon page says the Agentic Wallet has "contract-call preview and execute"; the skills reference on the docs site does not list it. It is in the Skills Hub repo under `references/external-sign.md`, and needs Developer Mode, which can only be switched on in the Binance app.

- Trading API, verified 2026-10-10: `/aggregator/swap` needs `quoteId`, `binanceChainId`, `fromTokenAddress`, `toTokenAddress`, `amount`, `userWalletAddress` and `slippagePercent` (the quote itself accepts `userWalletAddress` or nothing); the response is `{executionMode, routerResult, tx:{to,data,value,from,gas}}` with the router at `0xB44446b0…` (LiquidMesh). A 10 USDT buy of NVDAB routed USDT to QQQB to NVDAB through "Rfq Halfmoon". `/aggregator/approve-transaction` takes `tokenContractAddress` and `approveAmount` and returns calldata plus `dexContractAddress`.
- Transaction API, verified 2026-10-10: `/pre-transaction/simulate` takes `{binanceChainId:"56", evmTx:{from,to,value,data}}` (the catalog page documents it; the product page does not) and answers `{status:"FAILED", failReason:"execution reverted: BEP20: transfer amount exceeds allowance", balanceChanges:[], allowanceChanges:[]}` for an unapproved swap, which is exactly the dry-run the rules ask for. `/pre-transaction/gas-limit` with the same `evmTx` returned code 40435 with no message for a plain `0x` call. `/pre-transaction/gas-price` returns legacy low, medium and high (50 to 75 mwei on 2026-10-10).
- Wallet API: `/balance/all-token-balances-by-address?binanceChainId=56&address=…` answered `tokenAssets: []` for Binance's own hot wallet, which holds billions, so either the endpoint indexes only Binance Wallet users or the parameter is something else; `/balance/token-balances-by-address` (POST) returned 40001 for every body shape tried.

## bStocks specifics

- bStocks are BEP-677 (ERC-8056 Scaled UI Amount). `uiMultiplier()`, `newUIMultiplier()`, `effectiveAt()`, `toUIAmount()`, `fromUIAmount()`, `supportsInterface(0xa60bf13d)` all answer on NVDAB; `balanceOfUI()` does not. The BNB Chain developer-kit page on Scaled UI Amount documents `balanceOfUI` as the primary balance call, so one of the two is wrong.
- `effectiveAt()` returns 0 when nothing is scheduled and the live token keeps returning the last applied value afterwards (same behaviour as Robinhood Chain tokens). A pending change is `effectiveAt() > block.timestamp`.
- No function named `paused()`, `isBlocked()`, `isBlacklisted()` or `blocklisted()` exists on NVDAB. The prospectus says addresses can be blocked; the mechanism is not visible on-chain under those names.
- 15 bStocks checked all have 18 decimals and multipliers between 1.0 and 1.0017.

## Oracles

- APRO publishes Chainlink-shaped feeds for 12 bStocks (docs.apro.com, BNB Smart Chain table). They revert with "No access" for any contract caller; only an externally owned account (eth_call with `from` set, or a wallet) can read them. There is an `accessController()` at `0x8120CeCd…`. BNB Chain's announcement that the feeds are "free for builders" does not say how to get a contract allowlisted. We shipped a RelayFeed and a keeper to get around it.
- The feeds price the token (multiplier included) 24/7 from on-chain liquidity, 1 percent deviation, 1 hour heartbeat. For a lending protocol that is the wrong shape on its own: it follows the pool, so it cannot catch the pool being wrong. We cross-check with the PancakeSwap v3 TWAP and the Binance reference price.
- Chainlink has no bStocks feeds on BSC.

## Trading and pools

- PancakeSwap v3's `SwapRouter` at `0x1b81D678…` takes the Uniswap v3 periphery structs with `deadline`; `SmartRouter` at `0x13f4EA83…` takes the SwapRouter02 shape without it. The docs do not say which the Binance Trading API returns calldata for.
- NVDAB/USDT 0.25 percent had $6.4M of liquidity and observation cardinality 1439; QQQB's deepest USDT pool is the 0.01 percent tier; SPCXB's deepest pool is against WBNB, not USDT. A "use USDT" assumption breaks on SPCXB.
- Ondo (`NVDAon`) and xStocks (`NVDAx`) have almost no AMM liquidity on BSC ($9.6k and under $5k). The aggregation across three issuers that the hackathon brief highlights is, on BSC, one issuer plus two RFQ-only ones.

## Lending

- Venus lists NVDAB, TSLAB, SPCXB and SKHYB as collateral with borrow caps of 0 (26 NVDAB suppliers, 0 borrowers on 2026-10-10). Nobody can borrow the stock itself anywhere on BSC, which is the gap Stockroom fills.

## Agentic Wallet and Agent Studio

- `baw` 1.10.0: `contract-call preview --binanceChainId 56 --from --to --inputData` then `execute --requestId`, `sign-message` for EIP-712, `defi lp-add` with `--tickLower`/`--tickUpper`, `x402-payment sign`. All behind Developer Mode, which has its own daily limit and expiry.
- Pairing, done 2026-10-10 from a headless VPS: the CLI is the npm package `@binance/agentic-wallet` (the install page only says "Skills installs it for you"); `auth signin --json` returns an `app.binance.com/uni-qr/...` link and a six-character pairing code, the link opens the app on the phone, `auth verify` blocks until the tap and then `wallet status` reads CONNECTED. Smooth. The Agentic Wallet settings screen (Wallet, Agentic Wallet, gear) ships with a $1,000 DEX daily limit, $5,000 DeFi and prediction limits, a $1,000 Developer Mode limit and a $20 x402 limit; "Abnormal Transactions: Auto Reject" is the default. Developer Mode turns itself off after 7 days without an external transaction. None of this is on the public docs site; it is in the Skills Hub repo's `wallet-setting.md`. The "create an MPC wallet first" prerequisite was not needed on an account that already had the Web3 wallet.
- Agent Studio (`bag`) is a Python CLI at v0.0.1, seller-only, deploying to AWS Bedrock AgentCore; the SDK is Python-only. For a TypeScript agent the practical route was registering ERC-8004 directly at `0x8004A169…` (verified on BSC: "AgentIdentity", ERC-721, `register(string)`), which the BNB docs do not list by address ("deployed contract addresses are not listed in this documentation").
- B402: `POST /api/v2/b402/supported` is the only source of truth for signer and spender addresses; the integration guide does not name the client header for the payment payload (we accept `X-PAYMENT` and `PAYMENT-SIGNATURE`).

## Infrastructure

- Public BSC RPCs (publicnode, bsc-dataseed) refuse archive reads, so an anvil fork becomes unusable within seconds of starting; fork tests that create a fresh fork per run are fine, a persistent sandbox needs a paid or keyed archive RPC.
- Gas is 0.05 gwei: the whole 15-market deploy costs about 0.004 BNB.

## What we would ask for

1. A documented way to allowlist a contract on the APRO bStocks feeds, or feeds without the EOA-only gate.
2. Response schemas for the RWA Data endpoints in the public docs.
3. `contract-call` and `sign-message` in the public skills reference, not only in the repo.
4. A TypeScript path for Agent Studio, or at least the registry addresses in the docs.
5. `llms.txt` reachable without the WAF challenge, since it exists for agents.
