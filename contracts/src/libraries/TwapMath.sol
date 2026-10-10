// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Turns a v3 tick into a price without the Uniswap TickMath table: 1.0001^tick by binary exponentiation
///         in 1e18 fixed point. Each squaring keeps 18 decimals, so the relative error over the 20 steps a
///         full-range tick needs stays far below one basis point. Prices here are "token1 per token0" for two
///         18-decimal tokens; callers invert when the stock is token1.
library TwapMath {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant TICK_BASE = 1_0001e14; // 1.0001 in WAD
    int24 internal constant MAX_TICK = 887272;

    error TickOutOfRange(int24 tick);

    /// @return priceWad 1.0001^tick scaled by 1e18
    function priceFromTick(int24 tick) internal pure returns (uint256 priceWad) {
        if (tick > MAX_TICK || tick < -MAX_TICK) revert TickOutOfRange(tick);
        uint256 magnitude = tick < 0 ? uint256(uint24(-tick)) : uint256(uint24(tick));
        uint256 p = _powWad(TICK_BASE, magnitude);
        return tick < 0 ? Math.mulDiv(WAD, WAD, p) : p;
    }

    /// @notice Time-weighted average tick between `secondsAgo` and now, rounded toward negative infinity the way
    ///         Uniswap's OracleLibrary does.
    function averageTick(int56 cumulativeThen, int56 cumulativeNow, uint32 secondsAgo) internal pure returns (int24) {
        int56 delta = cumulativeNow - cumulativeThen;
        int56 avg = delta / int56(uint56(secondsAgo));
        if (delta < 0 && delta % int56(uint56(secondsAgo)) != 0) avg -= 1;
        return int24(avg);
    }

    /// @dev Square-and-multiply in WAD. Never overflows for exponents up to MAX_TICK: 1.0001^887272 is about 3e38,
    ///      and 3e38 * 3e38 * 1e18 fits in 2^256 with room to spare.
    function _powWad(uint256 base, uint256 exp) private pure returns (uint256 result) {
        result = WAD;
        uint256 b = base;
        while (exp > 0) {
            if (exp & 1 == 1) result = Math.mulDiv(result, b, WAD);
            exp >>= 1;
            if (exp > 0) b = Math.mulDiv(b, b, WAD);
        }
    }
}
