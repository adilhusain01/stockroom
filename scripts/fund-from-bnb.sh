#!/bin/bash
# Turn part of the burner's BNB into USDT and NVDAB on PancakeSwap v3, so the wallet only ever receives BNB.
# Defaults: 0.02 BNB -> USDT, then 11 USDT -> NVDAB. Needs .env (DEPLOYER_PRIVATE_KEY, BSC_RPC_URL).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a; . "$ROOT/.env"; set +a
export ETH_RPC_URL="${BSC_RPC_URL:-https://bsc-rpc.publicnode.com}"
KEY="$DEPLOYER_PRIVATE_KEY"; ME="$DEPLOYER_ADDRESS"
ROUTER=0x1b81D678ffb9C0263b24A97847620C99d213eB14
WBNB=0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c
USDT=0x55d398326f99059fF775485246999027B3197955
NVDAB=0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436
BNB_IN=${BNB_IN_WEI:-20000000000000000}        # 0.02 BNB
USDT_FOR_NVDAB=${USDT_FOR_NVDAB_WEI:-11000000000000000000}  # 11 USDT
DEADLINE=$(( $(date +%s) + 600 ))

echo "balance: $(cast balance $ME --ether) BNB"
echo "1. $BNB_IN wei BNB -> USDT (WBNB/USDT 0.05%)"
cast send --private-key "$KEY" --value "$BNB_IN" "$ROUTER" \
  "exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))(uint256)" \
  "($WBNB,$USDT,500,$ME,$DEADLINE,$BNB_IN,1,0)" | grep -E "transactionHash|status"
echo "USDT: $(cast call $USDT 'balanceOf(address)(uint256)' $ME)"
echo "2. $USDT_FOR_NVDAB wei USDT -> NVDAB (NVDAB/USDT 0.25%)"
cast send --private-key "$KEY" "$USDT" "approve(address,uint256)(bool)" "$ROUTER" "$USDT_FOR_NVDAB" | grep -E "transactionHash|status"
cast send --private-key "$KEY" "$ROUTER" \
  "exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))(uint256)" \
  "($USDT,$NVDAB,2500,$ME,$DEADLINE,$USDT_FOR_NVDAB,1,0)" | grep -E "transactionHash|status"
echo "NVDAB: $(cast call $NVDAB 'balanceOf(address)(uint256)' $ME)"
echo "USDT left: $(cast call $USDT 'balanceOf(address)(uint256)' $ME)"
