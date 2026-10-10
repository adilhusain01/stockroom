#!/usr/bin/env bash
# Stockroom helper for the Binance Agentic Wallet CLI (baw).
#
# Reads market and account data from the Stockroom API, previews every prepared transaction through
# `baw contract-call preview` (which needs Developer Mode), and executes only the request ids you pass back
# explicitly. Nothing here signs on its own.
#
#   stockroom.sh rates                                  borrow and supply APR per ticker
#   stockroom.sh market NVDAB                           pool size, utilisation, cap, feed age, TWAP, anchor
#   stockroom.sh session                                reference session state and gap premium
#   stockroom.sh account 0xYourWallet                   collateral, debt, health factor, lending positions
#   stockroom.sh preview lend ticker=NVDAB amount=2 account=0xYourWallet
#   stockroom.sh preview short ticker=NVDAB amount=0.01 slippageBps=100 from=0xYourWallet
#   stockroom.sh execute <requestId>                    broadcast one previewed step after the user said yes
#
# Environment: STOCKROOM_API (default https://stockroom.adilhusain.xyz/api). Needs curl, jq and baw 1.10+.
set -euo pipefail

API="${STOCKROOM_API:-https://stockroom.adilhusain.xyz/api}"

usage() {
  sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
}

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing $1" >&2; exit 1; }; }
need curl
need jq

cmd="${1:-}"
[ -n "$cmd" ] || usage
shift

case "$cmd" in
  rates) curl -fsS "$API/rates.json" | jq . ;;
  session) curl -fsS "$API/session" | jq . ;;
  market)
    [ $# -ge 1 ] || usage
    curl -fsS "$API/markets/${1^^}" | jq . ;;
  account)
    [ $# -ge 1 ] || usage
    curl -fsS "$API/account/$1" | jq . ;;
  preview)
    need baw
    [ $# -ge 1 ] || usage
    action="$1"; shift
    query=""; from=""
    for kv in "$@"; do
      key="${kv%%=*}"; val="${kv#*=}"
      case "$key" in
        from) from="$val" ;;
        account) from="$val"; query="${query}&account=${val}" ;;
        *) query="${query}&${key}=${val}" ;;
      esac
    done
    [ -n "$from" ] || { echo "preview needs account=0x... or from=0x... (the wallet that will sign)" >&2; exit 1; }
    resp="$(curl -fsS "$API/tx/${action}?simulate=1${query}")"
    if jq -e '.error' >/dev/null 2>&1 <<<"$resp"; then
      echo "API refused: $(jq -r '.error' <<<"$resp")" >&2
      exit 1
    fi
    n="$(jq '.txs | length' <<<"$resp")"
    echo "$n step(s). Show each description and preview to the user and get a yes before execute."
    for ((i = 0; i < n; i++)); do
      desc="$(jq -r ".txs[$i].description" <<<"$resp")"
      to="$(jq -r ".txs[$i].to" <<<"$resp")"
      data="$(jq -r ".txs[$i].data" <<<"$resp")"
      sim="$(jq -r ".simulations[$i].status // \"not run\"" <<<"$resp")"
      reason="$(jq -r ".simulations[$i].failReason // empty" <<<"$resp")"
      echo
      echo "Step $((i + 1)): $desc"
      echo "  Binance dry-run: $sim${reason:+ ($reason)}"
      if [ "$sim" = "FAILED" ] && [ "$i" -eq 0 ]; then
        echo "  The first step fails in the dry-run; stop here and report the reason." >&2
        exit 1
      fi
      baw contract-call preview --binanceChainId 56 --from "$from" --to "$to" --value 0 --inputData "$data" --json | jq .
    done ;;
  execute)
    need baw
    [ $# -ge 1 ] || usage
    baw contract-call execute --requestId "$1" --json | jq . ;;
  *) usage ;;
esac
