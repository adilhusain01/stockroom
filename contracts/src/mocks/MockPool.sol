// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice PancakeSwap v3 pool stand-in for oracle tests: a settable average tick and token order. The
///         cumulative tick grows linearly, so any window returns exactly the configured tick.
contract MockPool {
    address public token0;
    address public token1;
    int24 public avgTick;
    bool public failObserve;

    constructor(address token0_, address token1_) {
        token0 = token0_;
        token1 = token1_;
    }

    function setTick(int24 tick) external {
        avgTick = tick;
    }

    function setFailObserve(bool fail) external {
        failObserve = fail;
    }

    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s)
    {
        if (failObserve) revert("OLD");
        tickCumulatives = new int56[](secondsAgos.length);
        secondsPerLiquidityCumulativeX128s = new uint160[](secondsAgos.length);
        for (uint256 i; i < secondsAgos.length; ++i) {
            uint256 t = block.timestamp - secondsAgos[i];
            tickCumulatives[i] = int56(avgTick) * int56(uint56(t));
        }
    }
}
