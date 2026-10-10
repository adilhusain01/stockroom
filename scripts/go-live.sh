#!/bin/bash
# Mainnet go-live in order, stopping at the first failure: swap part of the burner's BNB into USDT and NVDAB,
# deploy the first N markets, relay the first prices, run the first lend, short and cover, start the services.
# Usage: MARKETS=5 scripts/go-live.sh      (needs .env with the burner keys and at least 0.03 BNB in it)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a; . "$ROOT/.env"; set +a
export ETH_RPC_URL="${BSC_RPC_URL:-https://bsc-rpc.publicnode.com}"
ME="$DEPLOYER_ADDRESS"
MARKETS="${MARKETS:-5}"
BAL=$(cast balance "$ME")
echo "burner $ME holds $(cast balance $ME --ether) BNB"
[ "$(python3 -c "print($BAL >= 30000000000000000)")" = "True" ] || { echo "need at least 0.03 BNB"; exit 1; }

echo "== 1. swap BNB into USDT and NVDAB"
bash "$ROOT/scripts/fund-from-bnb.sh"

# The Agent Studio seller signs with its own keystore wallet (agents/stockroomdesk/.studio/wallets); it needs a
# little BNB for the ERC-8004 registration and ERC-8183 deliverable submits. 0.003 BNB covers dozens of them.
AGENT_WALLET="${AGENT_WALLET:-$(grep -E '^address *= *"0x' "$ROOT/agents/stockroomdesk/app/agent/studio.toml" | sed -E 's/.*"(0x[0-9a-fA-F]+)".*/\1/')}"
if [ -n "$AGENT_WALLET" ] && [ "$(cast balance "$AGENT_WALLET")" = "0" ]; then
  echo "== 1b. fund the desk analyst wallet $AGENT_WALLET with 0.003 BNB"
  cast send --private-key "$DEPLOYER_PRIVATE_KEY" --value 3000000000000000 "$AGENT_WALLET" | grep -E "transactionHash|status"
fi

echo "== 2. deploy $MARKETS markets"
cd "$ROOT/contracts"
mkdir -p deployments
[ -f deployments/56.json ] && { echo "deployments/56.json exists; refusing to redeploy (move it away first)"; exit 1; }
DEPLOY_MARKET_COUNT=$MARKETS forge script script/DeployBsc.s.sol --rpc-url "$ETH_RPC_URL" --broadcast --slow -vv 2>&1 | grep -E "lending pool|relay feed|ONCHAIN|Error|error" || true
[ -f deployments/56.json ] || { echo "deploy did not write deployments/56.json"; exit 1; }
echo "controller $(python3 -c "import json;print(json.load(open('deployments/56.json'))['controller'])")"

echo "== 3. first prices"
cd "$ROOT/apps/keeper"
node --import tsx src/main.ts relay --once 2>&1 | tail -8

echo "== 4. first live lend, short and cover"
bash "$ROOT/scripts/seed-mainnet.sh"

echo "== 5. services"
cd "$ROOT"
pnpm exec pm2 start ecosystem.config.cjs 2>&1 | tail -8
pnpm exec pm2 save >/dev/null
sleep 5
curl -sS http://127.0.0.1:4310/rates.json | head -c 400; echo

echo "== 6. desk analyst identity (ERC-8004, from the agent wallet; needs the 0.003 BNB from step 1b)"
if [ -n "$AGENT_WALLET" ]; then
  (cd "$ROOT/agents/stockroomdesk/app/agent" && /usr/local/bin/bag erc8004 register --network bsc-mainnet \
    --endpoint https://stockroom.adilhusain.xyz/agent/ --name "Stockroom Desk Analyst" \
    --description "Paid research desk for Stockroom, the on-chain stock lending market for Binance bStocks on BNB Chain: borrow desk briefs over A2A, MCP and x402" 2>&1 | tail -4) || echo "   registration failed; rerun this step by hand"
fi
echo "live. add the Caddy block from docs/runbook.md once DNS points here."
