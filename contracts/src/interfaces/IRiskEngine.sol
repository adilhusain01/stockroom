// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Pure risk math. Implemented twice on purpose: `RiskMathRef` in Solidity for tests and differential
///         fuzzing, and the Stylus `risk-engine` crate for production. The Controller only knows this interface.
interface IRiskEngine {
    struct PositionInput {
        uint256 debtRaw; // raw token units owed (18 decimals)
        uint256 priceWad; // USD per whole token, 1e18 fixed point, already conservative
        uint256 liqThresholdWad; // debt weight at liquidation, e.g. 1.25e18
        uint256 initialRatioWad; // debt weight for new borrows and withdrawals, e.g. 1.5e18
    }

    struct IrmParams {
        uint64 baseWad; // yearly rate at zero utilisation
        uint64 kinkWad; // utilisation where the slope changes
        uint64 rateAtKinkWad; // yearly rate at the kink
        uint64 maxRateWad; // yearly rate at full utilisation
    }

    /// @return healthFactorWad collateral over threshold-weighted debt (max uint when there is no debt)
    /// @return debtValueWad    plain USD value of all debt
    /// @return requiredInitialWad collateral needed under the initial ratios
    function evaluate(PositionInput[] calldata positions, uint256 collateralValueWad)
        external
        pure
        returns (uint256 healthFactorWad, uint256 debtValueWad, uint256 requiredInitialWad);

    /// @return rateWadPerYear yearly fee rate for the given utilisation (clamped to 100 percent)
    function borrowRate(uint256 utilisationWad, IrmParams calldata params) external pure returns (uint256 rateWadPerYear);

    /// @return discountWad collateral discount for a liquidator `elapsed` seconds into an auction
    function dutchDiscount(uint256 elapsed, uint256 minWad, uint256 maxWad, uint256 duration)
        external
        pure
        returns (uint256 discountWad);
}
