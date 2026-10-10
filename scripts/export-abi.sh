#!/bin/bash
# Regenerates packages/sdk/src/abi/*.ts from the compiled contracts. Run after `forge build`.
set -euo pipefail
cd "$(dirname "$0")/../contracts"
forge build --silent
out="../packages/sdk/src/abi"
mkdir -p "$out"
for c in Controller LendingPool OracleRouter RelayFeed MarketCalendar ShortRouter Liquidator RiskMathRef; do
  abi=$(forge inspect "$c" abi --json)
  printf 'export const %sAbi = %s as const;\n' "$c" "$abi" > "$out/$c.ts"
done
cat > "$out/index.ts" <<'EOF'
export { ControllerAbi } from "./Controller.ts";
export { LendingPoolAbi } from "./LendingPool.ts";
export { OracleRouterAbi } from "./OracleRouter.ts";
export { RelayFeedAbi } from "./RelayFeed.ts";
export { MarketCalendarAbi } from "./MarketCalendar.ts";
export { ShortRouterAbi } from "./ShortRouter.ts";
export { LiquidatorAbi } from "./Liquidator.ts";
export { RiskMathRefAbi } from "./RiskMathRef.ts";
EOF
echo "ABIs written to packages/sdk/src/abi"
