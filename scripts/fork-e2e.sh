#!/bin/bash
# End-to-end check on a local fork of BSC mainnet: deploy three markets, relay live APRO prices through the
# keeper, start the API and read the markets back. Needs anvil, forge, pnpm and a working BSC RPC.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT=${FORK_PORT:-8549}
RPC=${BSC_RPC_URL:-https://bsc-rpc.publicnode.com}
KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 # anvil account 0
ADDR=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

pkill -f "anvil --fork-url" 2>/dev/null || true
sleep 1
anvil --fork-url "$RPC" --port "$PORT" --silent > "$ROOT/fork-e2e-anvil.log" 2>&1 &
ANVIL=$!
trap 'kill $ANVIL 2>/dev/null || true; kill ${API:-0} 2>/dev/null || true' EXIT
sleep 10
echo "fork block: $(cast block-number --rpc-url http://127.0.0.1:$PORT)"

cd "$ROOT/contracts"
mkdir -p deployments
DEPLOYER_PRIVATE_KEY=$KEY KEEPER_ADDRESS=$ADDR DEPLOY_MARKET_COUNT=${MARKETS:-3} \
  forge script script/DeployBsc.s.sol --rpc-url "http://127.0.0.1:$PORT" --broadcast --skip-simulation -q 2>&1 | grep -E "lending pool|relay feed|ONCHAIN|Error" || true
test -f deployments/56.json && echo "deployment written" || { echo "no deployment file"; exit 1; }
mv deployments/56.json deployments/fork.json

cd "$ROOT/apps/keeper"
echo "--- keeper relay (once)"
BSC_RPC_URL="http://127.0.0.1:$PORT" KEEPER_PRIVATE_KEY=$KEY DEPLOYMENT_FILE="$ROOT/contracts/deployments/fork.json" \
  node --import tsx src/main.ts relay --once 2>&1 | tail -12
echo "--- keeper liquidate (once, dry)"
BSC_RPC_URL="http://127.0.0.1:$PORT" KEEPER_PRIVATE_KEY=$KEY DEPLOYMENT_FILE="$ROOT/contracts/deployments/fork.json" DRY_RUN=1 \
  node --import tsx src/main.ts liquidate --once 2>&1 | tail -3

cd "$ROOT/apps/api"
echo "--- api"
BSC_RPC_URL="http://127.0.0.1:$PORT" DEPLOYMENT_FILE="$ROOT/contracts/deployments/fork.json" API_PORT=4311 \
  node --import tsx src/server.ts > "$ROOT/fork-e2e-api.log" 2>&1 &
API=$!
sleep 6
curl -sS http://127.0.0.1:4311/health; echo
curl -sS http://127.0.0.1:4311/rates.json | head -c 900; echo
curl -sS http://127.0.0.1:4311/markets/NVDAB | head -c 1200; echo
curl -sS http://127.0.0.1:4311/account/$ADDR | head -c 400; echo
echo "--- done"
