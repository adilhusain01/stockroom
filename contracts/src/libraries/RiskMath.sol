// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IRiskEngine} from "../interfaces/IRiskEngine.sol";

/// @notice Reference formulas for health, interest and auctions. Debt is rounded up and health down, so every
///         rounding error works against the borrower and never against the pool.
library RiskMath {
    uint256 internal constant WAD = 1e18;

    error InvalidKink();
    error InvalidIrm();
    error InvalidDuration();
    error InvalidDiscounts();

    function evaluate(IRiskEngine.PositionInput[] memory positions, uint256 collateralValueWad)
        internal
        pure
        returns (uint256 healthFactorWad, uint256 debtValueWad, uint256 requiredInitialWad)
    {
        uint256 weighted;
        for (uint256 i; i < positions.length; ++i) {
            IRiskEngine.PositionInput memory p = positions[i];
            uint256 value = Math.mulDiv(p.debtRaw, p.priceWad, WAD, Math.Rounding.Ceil);
            debtValueWad += value;
            weighted += Math.mulDiv(value, p.liqThresholdWad, WAD, Math.Rounding.Ceil);
            requiredInitialWad += Math.mulDiv(value, p.initialRatioWad, WAD, Math.Rounding.Ceil);
        }
        healthFactorWad = weighted == 0 ? type(uint256).max : Math.mulDiv(collateralValueWad, WAD, weighted);
    }

    function borrowRate(uint256 utilisationWad, IRiskEngine.IrmParams memory p) internal pure returns (uint256) {
        if (p.kinkWad == 0 || p.kinkWad >= WAD) revert InvalidKink();
        if (p.rateAtKinkWad < p.baseWad || p.maxRateWad < p.rateAtKinkWad) revert InvalidIrm();
        if (utilisationWad > WAD) utilisationWad = WAD;
        if (utilisationWad <= p.kinkWad) {
            return p.baseWad + Math.mulDiv(p.rateAtKinkWad - p.baseWad, utilisationWad, p.kinkWad);
        }
        return p.rateAtKinkWad
            + Math.mulDiv(p.maxRateWad - p.rateAtKinkWad, utilisationWad - p.kinkWad, WAD - p.kinkWad);
    }

    function dutchDiscount(uint256 elapsed, uint256 minWad, uint256 maxWad, uint256 duration)
        internal
        pure
        returns (uint256)
    {
        if (duration == 0) revert InvalidDuration();
        if (maxWad < minWad || maxWad >= WAD) revert InvalidDiscounts();
        if (elapsed >= duration) return maxWad;
        return minWad + Math.mulDiv(maxWad - minWad, elapsed, duration);
    }
}
