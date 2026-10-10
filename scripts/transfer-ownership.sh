#!/bin/bash
# Hand the owner role of every Stockroom contract to NEW_OWNER (two-step: the new owner must call
# acceptOwnership() on each address afterwards, from their own wallet). The burner keeps the keeper role.
# Usage: NEW_OWNER=0xYourWallet scripts/transfer-ownership.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a; . "$ROOT/.env"; set +a
export ETH_RPC_URL="${BSC_RPC_URL:-https://bsc-rpc.publicnode.com}"
DEP="$ROOT/contracts/deployments/56.json"
KEY="$DEPLOYER_PRIVATE_KEY"
NEW="${NEW_OWNER:?set NEW_OWNER}"
j() { python3 -c "import json;d=json.load(open('$DEP'));print($1)"; }
N=$(j "len(d['tickers'])")
TARGETS="$(j "d['controller']") $(j "d['oracle']") $(j "d['calendar']") $(j "d['usdtFeed']")"
for i in $(seq 0 $((N-1))); do TARGETS="$TARGETS $(j "d['feeds'][$i]")"; done
for A in $TARGETS; do
  echo "transferOwnership($NEW) on $A"
  cast send --private-key "$KEY" "$A" "transferOwnership(address)" "$NEW" | grep -E "transactionHash" | awk '{print "   tx " $2}'
done
echo
echo "Now, from $NEW, call acceptOwnership() on each of these addresses (one click each in any wallet):"
for A in $TARGETS; do echo "   $A"; done
echo "Until accepted, the burner stays owner. The keeper role (prices, pause) stays with the burner either way."
