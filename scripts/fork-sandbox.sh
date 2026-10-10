#!/bin/bash
# A persistent sandbox on a fork of BSC mainnet: real bStocks, real APRO feeds, real PancakeSwap pools, fake
# money. Deploys every market, seeds a lender in each pool from the pool's own inventory, funds test wallets
# with BNB and USDT, relays live prices once, then leaves anvil, the keeper, the API and the web app running.
#
#   BSC_RPC_URL=<archive-capable rpc> scripts/fork-sandbox.sh        # start
#   scripts/fork-sandbox.sh stop                                       # stop everything
#
# Public RPCs refuse archive reads a few seconds after the fork starts, so use an Alchemy or QuickNode key.
# Test wallets (anvil's well-known keys, never real money):
#   0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266  deployer and keeper (key 0xac0974...ff80)
#   0x70997970C51812dc3A010C7d01b50e0d17dc79C8  trader with 50,000 USDT (key 0x59c6995e...690d)
#   0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC  trader with 50,000 USDT (key 0x5de4111a...365a)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT=${FORK_PORT:-8549}
RPC=${BSC_RPC_URL:-https://bsc-rpc.publicnode.com}
KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
ADDR=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
TRADERS="0x70997970C51812dc3A010C7d01b50e0d17dc79C8 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"
USDT=0x55d398326f99059fF775485246999027B3197955
LOCAL="http://127.0.0.1:$PORT"
RUN="$ROOT/.sandbox"
mkdir -p "$RUN"

if [ "${1:-}" = "stop" ]; then
  for f in "$RUN"/*.pid; do [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null || true; done
  rm -f "$RUN"/*.pid
  echo "sandbox stopped"
  exit 0
fi

echo "starting anvil fork of $RPC on :$PORT"
anvil --fork-url "$RPC" --port "$PORT" --silent > "$RUN/anvil.log" 2>&1 &
echo $! > "$RUN/anvil.pid"
sleep 10
echo "fork block $(cast block-number --rpc-url $LOCAL)"

cd "$ROOT/contracts"
mkdir -p deployments
DEPLOYER_PRIVATE_KEY=$KEY KEEPER_ADDRESS=$ADDR forge script script/DeployBsc.s.sol --rpc-url "$LOCAL" --broadcast --skip-simulation -q 2>&1 | grep -E "lending pool|Error" || true
mv deployments/56.json deployments/fork.json
DEP="$ROOT/contracts/deployments/fork.json"
echo "deployed; controller $(python3 -c "import json;print(json.load(open('$DEP'))['controller'])")"

# seed every pool with 10 raw tokens from the deepest PancakeSwap pool (impersonated), and fund traders
python3 - "$DEP" <<'EOF' > "$RUN/seed.sh"
import json, sys
d = json.load(open(sys.argv[1]))
print("set -e")
for ticker, token, dex, pool in zip(d["tickers"], d["tokens"], d["dexPools"], d["lendingPools"]):
    print(f'cast rpc anvil_impersonateAccount {dex} > /dev/null')
    print(f'cast rpc anvil_setBalance {dex} 0x1000000000000000000 > /dev/null')
    print(f'cast send --unlocked --from {dex} {token} "transfer(address,uint256)(bool)" 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 10000000000000000000 > /dev/null || echo "seed {ticker}: pool had less than 10 tokens"')
    print(f'cast send --private-key $KEY {token} "approve(address,uint256)(bool)" {pool} 10000000000000000000 > /dev/null')
    print(f'cast send --private-key $KEY {pool} "deposit(uint256,address)(uint256)" 10000000000000000000 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 > /dev/null && echo "seeded 10 {ticker}"')
EOF
export ETH_RPC_URL="$LOCAL" KEY
bash "$RUN/seed.sh"
# USDT for traders and the keeper: impersonate the Binance hot wallet
WHALE=0xF977814e90dA44bFA03b6295A0616a897441aceC
cast rpc anvil_impersonateAccount $WHALE > /dev/null
cast rpc anvil_setBalance $WHALE 0x1000000000000000000 > /dev/null
for t in $TRADERS $ADDR; do
  cast send --unlocked --from $WHALE $USDT "transfer(address,uint256)(bool)" $t 50000000000000000000000 > /dev/null && echo "funded $t with 50,000 USDT"
done

cd "$ROOT/apps/keeper"
BSC_RPC_URL="$LOCAL" KEEPER_PRIVATE_KEY=$KEY DEPLOYMENT_FILE="$DEP" node --import tsx src/main.ts relay --once 2>&1 | tail -3
BSC_RPC_URL="$LOCAL" KEEPER_PRIVATE_KEY=$KEY DEPLOYMENT_FILE="$DEP" RELAY_INTERVAL_SEC=120 nohup node --import tsx src/main.ts relay > "$RUN/keeper.log" 2>&1 &
echo $! > "$RUN/keeper.pid"

cd "$ROOT/apps/api"
BSC_RPC_URL="$LOCAL" DEPLOYMENT_FILE="$DEP" API_PORT=${API_PORT:-4310} nohup node --import tsx src/server.ts > "$RUN/api.log" 2>&1 &
echo $! > "$RUN/api.pid"
sleep 4
curl -sS "http://127.0.0.1:${API_PORT:-4310}/rates.json" | head -c 300; echo

cd "$ROOT/apps/web"
NEXT_PUBLIC_STOCKROOM_API="http://127.0.0.1:${API_PORT:-4310}" NEXT_PUBLIC_BSC_RPC_URL="$LOCAL" nohup pnpm dev -p ${WEB_PORT:-3000} > "$RUN/web.log" 2>&1 &
echo $! > "$RUN/web.pid"
echo
echo "sandbox up: anvil $LOCAL, api http://127.0.0.1:${API_PORT:-4310}, web http://127.0.0.1:${WEB_PORT:-3000}"
echo "add chain 56 with RPC $LOCAL to your wallet and import a trader key to click through; logs in $RUN"
