#!/bin/bash
# Pull everything the burner holds in Stockroom back out and send it to RECOVER_TO. Safe to run any time; every
# step is skipped when there is nothing to do. Needs .env (DEPLOYER_PRIVATE_KEY, DEPLOYER_ADDRESS, BSC_RPC_URL)
# and contracts/deployments/56.json. Usage: RECOVER_TO=0xYourWallet scripts/recover.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a; . "$ROOT/.env"; set +a
export ETH_RPC_URL="${BSC_RPC_URL:-https://bsc-rpc.publicnode.com}"
DEP="$ROOT/contracts/deployments/56.json"
KEY="$DEPLOYER_PRIVATE_KEY"; ME="$DEPLOYER_ADDRESS"
TO="${RECOVER_TO:-0xc31b6c70df4bd9716e9a5f419e4c308a8372eb32}"  # Adil's Binance deposit address (BSC), set 2026-10-10
SWAP_STOCKS="${SWAP_STOCKS_TO_USDT:-1}"  # exchanges may not accept bStock deposits, so sell them to USDT first
j() { python3 -c "import json;d=json.load(open('$DEP'));print($1)"; }
CTL=$(j "d['controller']"); SR=$(j "d['shortRouter']"); USDT=$(j "d['usdt']")
N=$(j "len(d['tickers'])")
send() { cast send --private-key "$KEY" "$@" | grep -E "transactionHash" | awk '{print "   tx " $2}'; }
bal() { cast call "$1" "balanceOf(address)(uint256)" "$2" | cut -d' ' -f1; }

echo "== 1. Night Desk"
if [ -f "$ROOT/apps/keeper/runs/nightdesk.json" ] && grep -q '"phase": "open"' "$ROOT/apps/keeper/runs/nightdesk.json"; then
  (cd "$ROOT/apps/keeper" && node --import tsx src/main.ts nightdesk close)
else
  echo "   idle"
fi

echo "== 2. cover or repay every borrow"
for i in $(seq 0 $((N-1))); do
  T=$(j "d['tickers'][$i]"); TOKEN=$(j "d['tokens'][$i]")
  DEBT=$(cast call "$CTL" "positionOf(address,address)(uint256)" "$ME" "$TOKEN" | cut -d' ' -f1)
  [ "$DEBT" = "0" ] && continue
  HAVE=$(bal "$TOKEN" "$ME")
  if [ "$(python3 -c "print($HAVE >= $DEBT)")" = "True" ]; then
    echo "   repay $DEBT raw $T from balance"
    send "$TOKEN" "approve(address,uint256)(bool)" "$CTL" "$DEBT"
    send "$CTL" "repay(address,uint256,address)(uint256)" "$TOKEN" "$DEBT" "$ME"
  else
    echo "   cover $DEBT raw $T on PancakeSwap"
    FEE=$(printf '0x%06x' "$(python3 -c "import json;f=json.load(open('$ROOT/contracts/script/config/bsc-markets.json'))['poolFees'];print(f[$i])")")
    P=$(cast concat-hex "$TOKEN" "$FEE" "$USDT")
    MAXIN=$(cast call "$CTL" "collateralOf(address)(uint256)" "$ME" | cut -d' ' -f1)
    send "$SR" "cover(address,uint256,bytes,uint256)(uint256)" "$TOKEN" "$DEBT" "$P" "$MAXIN"
  fi
done

echo "== 3. withdraw collateral"
COL=$(cast call "$CTL" "collateralOf(address)(uint256)" "$ME" | cut -d' ' -f1)
if [ "$COL" != "0" ]; then send "$CTL" "withdrawCollateral(uint256,address)" "$COL" "$ME"; else echo "   none"; fi

echo "== 4. redeem every lending position and claim fees"
for i in $(seq 0 $((N-1))); do
  T=$(j "d['tickers'][$i]"); POOL=$(j "d['lendingPools'][$i]")
  SHARES=$(cast call "$POOL" "maxRedeem(address)(uint256)" "$ME" | cut -d' ' -f1)
  if [ "$SHARES" != "0" ]; then
    echo "   redeem $T shares $SHARES (limited by idle liquidity; rerun later if a borrow is still out)"
    send "$POOL" "redeem(uint256,address,address)(uint256)" "$SHARES" "$ME" "$ME"
  fi
  CLAIM=$(cast call "$POOL" "claimable(address)(uint256)" "$ME" | cut -d' ' -f1)
  if [ "$CLAIM" != "0" ]; then echo "   claim $CLAIM wei USDT of $T fees"; send "$POOL" "claim(address)(uint256)" "$ME"; fi
done

echo "== 5. insurance fund (owner only; skipped if ownership was transferred)"
INS=$(cast call "$CTL" "insuranceBalance()(uint256)" | cut -d' ' -f1)
OWNER=$(cast call "$CTL" "owner()(address)")
if [ "$INS" != "0" ] && [ "${OWNER,,}" = "${ME,,}" ]; then send "$CTL" "withdrawInsurance(address,uint256)" "$ME" "$INS"; else echo "   nothing to do"; fi

echo "== 6. send everything to $TO"
ROUTER=$(j "d['swapRouter']")
for i in $(seq 0 $((N-1))); do
  TOKEN=$(j "d['tokens'][$i]"); B=$(bal "$TOKEN" "$ME")
  [ "$B" = "0" ] && continue
  if [ "$SWAP_STOCKS" = "1" ]; then
    FEE=$(python3 -c "import json;f=json.load(open('$ROOT/contracts/script/config/bsc-markets.json'))['poolFees'];print(f[$i])")
    DL=$(( $(date +%s) + 600 ))
    echo "   sell $B raw $(j "d['tickers'][$i]") for USDT"
    send "$TOKEN" "approve(address,uint256)(bool)" "$ROUTER" "$B"
    send "$ROUTER" "exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))(uint256)" "($TOKEN,$USDT,$FEE,$ME,$DL,$B,1,0)"
  else
    echo "   $(j "d['tickers'][$i]") $B"; send "$TOKEN" "transfer(address,uint256)(bool)" "$TO" "$B"
  fi
done
U=$(bal "$USDT" "$ME"); [ "$U" != "0" ] && { echo "   USDT $U"; send "$USDT" "transfer(address,uint256)(bool)" "$TO" "$U"; }
BNB=$(cast balance "$ME"); KEEP=2000000000000000 # leave 0.002 BNB for any rerun
if [ "$(python3 -c "print($BNB > $KEEP)")" = "True" ]; then
  AMT=$(python3 -c "print($BNB - $KEEP)"); echo "   BNB $AMT wei"; send --value "$AMT" "$TO"
fi
echo "done. balances left: BNB $(cast balance $ME --ether), USDT $(bal $USDT $ME)"
