# Stockroom Desk Analyst

The BNB Agent Studio seller for Stockroom: a paid research desk that sells borrow desk briefs about bStocks on Stockroom over A2A, MCP and x402 (ERC-8183 escrow, 0.05 U per brief). Scaffolded with `bag init` (bnbagent-studio, TypeScript runtime) and specialised in `app/agent/src`.

- Live card: https://stockroom.adilhusain.xyz/agent/.well-known/agent-card.json (A2A JSON-RPC at `/agent/`, MCP at `/agent/mcp`).
- ERC-8004 agent 371009 on BSC mainnet, wallet `0xf38eD31AcD342c17AA38ca0fA02215AFD1EBa265`.
- What it knows: `app/agent/src/stockroomDesk.ts`, five read-only tools that call the Stockroom API (market, rates, session, account, desk brief) plus the deterministic short-plan maths; `app/agent/src/tools.ts` and `mcpMain.ts` expose them to the LLM and over MCP; `sellerCore.ts` holds the delivery prompt; `agentCard.ts` the card.
- What it never does: touch Stockroom contracts or sign anything but ERC-8183 quotes and deliverables with its own keystore. The price is fixed in `studio.toml`; the LLM only writes the brief.

```bash
cd app/agent
pnpm install && pnpm test             # desk maths and brief assembly, no network
bag wallet status                     # keystore in ../../.studio/wallets (never in git)
bag llm activate                      # free Pieverse model, no deposit
bag dev --port 9010                   # local run; pm2 runs the same command as stockroom-agent
bag erc8004 register --endpoint https://stockroom.adilhusain.xyz/agent/   # needs about 0.003 BNB in the wallet
```

A buyer sends the `negotiate` skill with a task such as "Desk brief for shorting 0.01 NVDAB against 10 USDT over the weekend", receives a wallet-signed quote, funds the job on-chain, then sends `notify_funded`; the agent reads Stockroom through its tools, writes the brief and submits it on-chain.

`.studio/` (keystore, wallet password, LLM key, B402 placeholders) is gitignored and copied by hand between checkouts. The x402 face at `/x402` stays dormant until a B402 merchant is approved for this wallet. `AGENTS.md` is the scaffold's own guide for coding agents and still applies.
