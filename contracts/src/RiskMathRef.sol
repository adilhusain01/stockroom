// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IRiskEngine} from "./interfaces/IRiskEngine.sol";
import {RiskMath} from "./libraries/RiskMath.sol";

/// @notice Solidity reference implementation of IRiskEngine. The Stylus crate must match it to the wei.
contract RiskMathRef is IRiskEngine {
    function evaluate(PositionInput[] calldata positions, uint256 collateralValueWad)
        external
        pure
        returns (uint256, uint256, uint256)
    {
        return RiskMath.evaluate(positions, collateralValueWad);
    }

    function borrowRate(uint256 utilisationWad, IrmParams calldata params) external pure returns (uint256) {
        return RiskMath.borrowRate(utilisationWad, params);
    }

    function dutchDiscount(uint256 elapsed, uint256 minWad, uint256 maxWad, uint256 duration)
        external
        pure
        returns (uint256)
    {
        return RiskMath.dutchDiscount(elapsed, minWad, maxWad, duration);
    }
}
