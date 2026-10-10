// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IRiskEngine} from "../src/interfaces/IRiskEngine.sol";
import {RiskMathRef} from "../src/RiskMathRef.sol";
import {RiskMath} from "../src/libraries/RiskMath.sol";

/// Requirements (docs/spec.md, "Mechanism" and "Risk parameters"):
///  H1 health = collateral / sum(debt value x liquidation threshold); no debt means unlimited health
///  H2 debt is rounded against the borrower
///  H3 the initial requirement uses the initial ratio, not the liquidation threshold
///  I1 the rate is `base` at zero utilisation, `rateAtKink` at the kink, `max` at full utilisation, linear between,
///     clamped above 100 percent, and never decreasing in utilisation
///  D1 the Dutch discount starts at `min`, reaches `max` at `duration` and holds there
contract RiskMathTest is Test {
    uint256 constant WAD = 1e18;
    RiskMathRef engine;

    function setUp() public {
        engine = new RiskMathRef();
    }

    function _pos(uint256 debtRaw, uint256 priceWad, uint256 lt, uint256 ir)
        internal
        pure
        returns (IRiskEngine.PositionInput memory)
    {
        return IRiskEngine.PositionInput({debtRaw: debtRaw, priceWad: priceWad, liqThresholdWad: lt, initialRatioWad: ir});
    }

    function _irm() internal pure returns (IRiskEngine.IrmParams memory) {
        return IRiskEngine.IrmParams({baseWad: 0.01e18, kinkWad: 0.8e18, rateAtKinkWad: 0.10e18, maxRateWad: 1.5e18});
    }

    // ------------------------------------------------------------------ H1, H2, H3

    function test_singlePositionHealth() public view {
        IRiskEngine.PositionInput[] memory p = new IRiskEngine.PositionInput[](1);
        p[0] = _pos(10e18, 100e18, 1.25e18, 1.5e18); // 10 shares at $100 = $1000 debt
        (uint256 hf, uint256 debt, uint256 required) = engine.evaluate(p, 1500e18);
        assertEq(debt, 1000e18);
        assertEq(required, 1500e18);
        assertEq(hf, 1.2e18);
        (hf,,) = engine.evaluate(p, 1250e18);
        assertEq(hf, 1e18);
        (hf,,) = engine.evaluate(p, 1250e18 - 1);
        assertLt(hf, 1e18);
    }

    function test_multiplePositionsSum() public view {
        IRiskEngine.PositionInput[] memory p = new IRiskEngine.PositionInput[](2);
        p[0] = _pos(10e18, 100e18, 1.25e18, 1.5e18); // $1000, weighted 1250, initial 1500
        p[1] = _pos(2e18, 500e18, 1.5e18, 2e18); // $1000, weighted 1500, initial 2000
        (uint256 hf, uint256 debt, uint256 required) = engine.evaluate(p, 2750e18);
        assertEq(debt, 2000e18);
        assertEq(required, 3500e18);
        assertEq(hf, 1e18);
    }

    function test_noDebtMeansUnlimitedHealth() public view {
        IRiskEngine.PositionInput[] memory p = new IRiskEngine.PositionInput[](0);
        (uint256 hf, uint256 debt, uint256 required) = engine.evaluate(p, 0);
        assertEq(hf, type(uint256).max);
        assertEq(debt, 0);
        assertEq(required, 0);
    }

    function test_debtRoundsAgainstTheBorrower() public view {
        IRiskEngine.PositionInput[] memory p = new IRiskEngine.PositionInput[](1);
        p[0] = _pos(1, 1, 1e18 + 1, 1e18 + 1); // 1 wei of debt at a dust price still counts as 1 wei
        (uint256 hf, uint256 debt, uint256 required) = engine.evaluate(p, 1);
        assertEq(debt, 1);
        assertEq(required, 2);
        assertLt(hf, 1e18);
    }

    function testFuzz_healthIsMonotoneInCollateralAndPrice(
        uint128 debtRaw,
        uint128 price,
        uint128 collateral,
        uint64 bump
    ) public view {
        vm.assume(debtRaw > 0 && price > 0);
        IRiskEngine.PositionInput[] memory p = new IRiskEngine.PositionInput[](1);
        p[0] = _pos(debtRaw, price, 1.25e18, 1.5e18);
        (uint256 hf1,,) = engine.evaluate(p, collateral);
        (uint256 hf2,,) = engine.evaluate(p, uint256(collateral) + bump);
        assertGe(hf2, hf1, "more collateral never lowers health");
        p[0].priceWad = uint256(price) + bump;
        (uint256 hf3,,) = engine.evaluate(p, collateral);
        assertLe(hf3, hf1, "a higher price never raises health");
    }

    // ------------------------------------------------------------------ I1

    function test_rateAtAnchors() public view {
        IRiskEngine.IrmParams memory irm = _irm();
        assertEq(engine.borrowRate(0, irm), 0.01e18);
        assertEq(engine.borrowRate(0.4e18, irm), 0.055e18);
        assertEq(engine.borrowRate(0.8e18, irm), 0.10e18);
        assertEq(engine.borrowRate(0.9e18, irm), 0.80e18);
        assertEq(engine.borrowRate(1e18, irm), 1.5e18);
        assertEq(engine.borrowRate(2e18, irm), 1.5e18, "clamped above full utilisation");
    }

    function testFuzz_rateNeverDecreases(uint64 a, uint64 b) public view {
        IRiskEngine.IrmParams memory irm = _irm();
        (uint256 lo, uint256 hi) = a < b ? (uint256(a), uint256(b)) : (uint256(b), uint256(a));
        assertLe(engine.borrowRate(lo, irm), engine.borrowRate(hi, irm));
    }

    function test_rateRejectsBadParams() public {
        IRiskEngine.IrmParams memory irm = _irm();
        irm.kinkWad = 0;
        vm.expectRevert(RiskMath.InvalidKink.selector);
        engine.borrowRate(0.5e18, irm);
        irm = _irm();
        irm.kinkWad = 1e18;
        vm.expectRevert(RiskMath.InvalidKink.selector);
        engine.borrowRate(0.5e18, irm);
        irm = _irm();
        irm.maxRateWad = 0.05e18;
        vm.expectRevert(RiskMath.InvalidIrm.selector);
        engine.borrowRate(0.5e18, irm);
    }

    // ------------------------------------------------------------------ D1

    function test_dutchDiscountCurve() public view {
        assertEq(engine.dutchDiscount(0, 0.01e18, 0.12e18, 20 minutes), 0.01e18);
        assertEq(engine.dutchDiscount(10 minutes, 0.01e18, 0.12e18, 20 minutes), 0.065e18);
        assertEq(engine.dutchDiscount(20 minutes, 0.01e18, 0.12e18, 20 minutes), 0.12e18);
        assertEq(engine.dutchDiscount(3 days, 0.01e18, 0.12e18, 20 minutes), 0.12e18);
    }

    function testFuzz_dutchDiscountIsMonotoneAndBounded(uint32 t1, uint32 t2) public view {
        (uint256 lo, uint256 hi) = t1 < t2 ? (uint256(t1), uint256(t2)) : (uint256(t2), uint256(t1));
        uint256 d1 = engine.dutchDiscount(lo, 0.01e18, 0.12e18, 20 minutes);
        uint256 d2 = engine.dutchDiscount(hi, 0.01e18, 0.12e18, 20 minutes);
        assertLe(d1, d2);
        assertGe(d1, 0.01e18);
        assertLe(d2, 0.12e18);
    }

    function test_dutchDiscountRejectsBadParams() public {
        vm.expectRevert(RiskMath.InvalidDuration.selector);
        engine.dutchDiscount(1, 0.01e18, 0.12e18, 0);
        vm.expectRevert(RiskMath.InvalidDiscounts.selector);
        engine.dutchDiscount(1, 0.12e18, 0.01e18, 20 minutes);
        vm.expectRevert(RiskMath.InvalidDiscounts.selector);
        engine.dutchDiscount(1, 0.01e18, 1e18, 20 minutes);
    }
}
