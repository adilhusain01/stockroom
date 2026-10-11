#!/bin/bash
# First live transactions on mainnet with the burner: lend a little NVDAB, allow the short router, short a
# small amount, cover it. Amounts are tiny on purpose. Needs .env (DEPLOYER_PRIVATE_KEY, BSC_RPC_URL) and
# contracts/deployments/56.json. Every step prints the transaction hash.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a; . "$ROOT/.env"; set +a
export ETH_RPC_URL="${GO_LIVE_RPC:-https://bsc-dataseed.binance.org}"  # sending RPC; publicnode refused receipt reads on 2026-10-11
DEP="$ROOT/contracts/deployments/56.json"
KEY="$DEPLOYER_PRIVATE_KEY"
ME="$DEPLOYER_ADDRESS"
LEND=${LEND_RAW:-50000000000000000}        # 0.05 NVDAB
SHORT=${SHORT_RAW:-10000000000000000}      # 0.01 NVDAB
COLLATERAL=${COLLATERAL_WEI:-10000000000000000000}  # 10 USDT

j() { python3 -c "import json;d=json.load(open('$DEP'));print($1)"; }
NVDAB=$(j "d['tokens'][d['tickers'].index('NVDAB')]")
POOL=$(j "d['lendingPools'][d['tickers'].index('NVDAB')]")
CTL=$(j "d['controller']"); SR=$(j "d['shortRouter']"); USDT=$(j "d['usdt']")
echo "controller $CTL, NVDAB pool $POOL"

echo "1. lend $LEND raw NVDAB"
cast send --private-key "$KEY" "$NVDAB" "approve(address,uint256)(bool)" "$POOL" "$LEND" | grep -E "transactionHash|status"
cast send --private-key "$KEY" "$POOL" "deposit(uint256,address)(uint256)" "$LEND" "$ME" | grep -E "transactionHash|status"
echo "pool idle: $(cast call $POOL 'idle()(uint256)')"

echo "2. deposit $COLLATERAL wei USDT as collateral"
cast send --private-key "$KEY" "$USDT" "approve(address,uint256)(bool)" "$CTL" "$COLLATERAL" | grep -E "transactionHash|status"
cast send --private-key "$KEY" "$CTL" "depositCollateral(uint256,address)" "$COLLATERAL" "$ME" | grep -E "transactionHash|status"

echo "3. allow the short router"
cast send --private-key "$KEY" "$CTL" "setOperator(address,bool)" "$SR" true | grep -E "transactionHash|status"

echo "4. short $SHORT raw NVDAB (min out 1 wei: a demo, not a trade)"
PATH_BYTES=$(cast concat-hex "$NVDAB" 0x0009c4 "$USDT")
cast send --private-key "$KEY" "$SR" "short(address,uint256,bytes,uint256)(uint256)" "$NVDAB" "$SHORT" "$PATH_BYTES" 1 | grep -E "transactionHash|status"
echo "health: $(cast call $CTL 'healthFactor(address)(uint256)' $ME)"

echo "5. cover it"
MAXIN=$(cast call "$CTL" "collateralOf(address)(uint256)" "$ME" | cut -d' ' -f1)
cast send --private-key "$KEY" "$SR" "cover(address,uint256,bytes,uint256)(uint256)" "$NVDAB" "$SHORT" "$PATH_BYTES" "$MAXIN" | grep -E "transactionHash|status"
echo "debt now: $(cast call $CTL 'positionOf(address,address)(uint256)' $ME $NVDAB)"
echo "done; the lend stays in place so the market shows supply"
