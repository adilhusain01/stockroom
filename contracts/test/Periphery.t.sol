// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Controller} from "../src/Controller.sol";
import {LendingPool} from "../src/LendingPool.sol";
import {RiskMathRef} from "../src/RiskMathRef.sol";
import {ShortRouter} from "../src/periphery/ShortRouter.sol";
import {Liquidator} from "../src/periphery/Liquidator.sol";
import {IOracleRouter} from "../src/interfaces/IOracleRouter.sol";
import {IRiskEngine} from "../src/interfaces/IRiskEngine.sol";
import {MockStockToken} from "../src/mocks/MockStockToken.sol";
import {MockCash} from "../src/mocks/MockCash.sol";
import {MockOracleRouter} from "../src/mocks/MockOracleRouter.sol";
import {MockSwapRouter} from "../src/mocks/MockSwapRouter.sol";

/// Requirements (docs/spec.md, "ShortRouter and Liquidator"):
///  S1 a short borrows, sells, and credits the proceeds before the initial ratio is checked, so proceeds count
///     as margin; the same borrow without the router would fail
///  S2 the short honours the caller's minimum proceeds
///  S3 a short that still misses the ratio after proceeds reverts whole
///  S4 a cover buys the tokens back out of collateral, repays, and puts the change back
///  S5 both need operator approval and only the Controller may call the callbacks
///  L1 a flash liquidation needs no capital: the pool's own flash loan funds the repayment, Uniswap buys the
///     tokens back, the caller keeps the USDT difference and the pool earns the flash fee
///  L2 it reverts below the caller's minimum profit and rejects callbacks from anything but the token's pool
contract PeripheryTest is Test {
    uint256 constant WAD = 1e18;

    MockCash cash;
    MockStockToken nvda;
    MockOracleRouter oracle;
    RiskMathRef engine;
    Controller ctl;
    LendingPool pool;
    MockSwapRouter dex;
    ShortRouter shortRouter;
    Liquidator liquidator;

    address lender = makeAddr("lender");
    address trader = makeAddr("trader");
    address keeper = makeAddr("keeper");
    address outsider = makeAddr("outsider");

    function setUp() public {
        cash = new MockCash(address(this));
        nvda = new MockStockToken("NVIDIA Robinhood Token", "NVDA", address(this));
        oracle = new MockOracleRouter();
        engine = new RiskMathRef();
        ctl = new Controller(IERC20(address(cash)), oracle, engine, address(this));
        pool = new LendingPool(IERC20(address(nvda)), "Stockroom NVDA", "lNVDA", address(ctl), 0.9e18);
        ctl.listMarket(
            address(nvda),
            pool,
            Controller.MarketParams({
                initialRatioWad: 1.5e18,
                liqThresholdWad: 1.25e18,
                dutchMinWad: 0.01e18,
                dutchMaxWad: 0.12e18,
                dutchDuration: 20 minutes,
                borrowCapRaw: 1_000e18,
                irm: IRiskEngine.IrmParams({baseWad: 0.01e18, kinkWad: 0.8e18, rateAtKinkWad: 0.10e18, maxRateWad: 1.5e18})
            })
        );
        oracle.setQuote(address(nvda), 100e18, IOracleRouter.Regime.Open);

        dex = new MockSwapRouter();
        dex.setPrice(address(nvda), 100e18);
        dex.setPrice(address(cash), 1e18);
        nvda.mint(address(dex), 1_000e18);
        cash.mint(address(dex), 1_000_000e18);

        shortRouter = new ShortRouter(ctl, dex);
        liquidator = new Liquidator(ctl, dex);

        nvda.mint(lender, 100e18);
        vm.startPrank(lender);
        nvda.approve(address(pool), 100e18);
        pool.deposit(100e18, lender);
        vm.stopPrank();

        vm.prank(trader);
        ctl.setOperator(address(shortRouter), true);
    }

    function _fund(address who, uint256 amount) internal {
        cash.mint(who, amount);
        vm.startPrank(who);
        cash.approve(address(ctl), amount);
        ctl.depositCollateral(amount, who);
        vm.stopPrank();
    }

    function _sellPath() internal view returns (bytes memory) {
        return abi.encodePacked(address(nvda), uint24(3000), address(cash));
    }

    function _buyPath() internal view returns (bytes memory) {
        return abi.encodePacked(address(nvda), uint24(3000), address(cash)); // exactOutput: token out first
    }

    // ------------------------------------------------------------------ S1

    function test_shortCountsProceedsAsMargin() public {
        _fund(trader, 600e18);
        vm.prank(trader);
        vm.expectRevert();
        ctl.borrow(address(nvda), 10e18, trader); // $1000 of debt needs $1500 up front without the router

        vm.prank(trader);
        uint256 proceeds = shortRouter.short(address(nvda), 10e18, _sellPath(), 990e18);
        assertEq(proceeds, 1_000e18);
        assertEq(ctl.collateralOf(trader), 1_600e18, "600 of margin plus 1000 of proceeds");
        assertEq(ctl.positionOf(trader, address(nvda)), 10e18);
        assertEq(ctl.healthFactor(trader), 1.28e18);
        assertEq(nvda.balanceOf(address(shortRouter)), 0);
        assertEq(cash.balanceOf(address(shortRouter)), 0);
    }

    // ------------------------------------------------------------------ S2, S3

    function test_shortHonoursMinimumProceeds() public {
        _fund(trader, 600e18);
        dex.setSlippage(200);
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(MockSwapRouter.TooLittleReceived.selector, 980e18, 990e18));
        shortRouter.short(address(nvda), 10e18, _sellPath(), 990e18);
    }

    function test_shortRevertsWholeWhenRatioStillMissed() public {
        _fund(trader, 400e18);
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(Controller.InitialRatioNotMet.selector, 1_400e18, 1_500e18));
        shortRouter.short(address(nvda), 10e18, _sellPath(), 0);
        assertEq(ctl.collateralOf(trader), 400e18, "nothing changed");
        assertEq(ctl.positionOf(trader, address(nvda)), 0);
        assertEq(pool.totalBorrows(), 0);
    }

    // ------------------------------------------------------------------ S4

    function test_coverBuysBackRepaysAndReturnsChange() public {
        _fund(trader, 600e18);
        vm.prank(trader);
        shortRouter.short(address(nvda), 10e18, _sellPath(), 0);

        vm.prank(trader);
        uint256 spent = shortRouter.cover(address(nvda), 10e18, _buyPath(), 1_100e18);
        assertEq(spent, 1_000e18);
        assertEq(ctl.positionOf(trader, address(nvda)), 0);
        assertEq(ctl.collateralOf(trader), 600e18, "back to the original margin");
        assertEq(pool.totalBorrows(), 0);
        assertEq(nvda.balanceOf(address(shortRouter)), 0);
        assertEq(cash.balanceOf(address(shortRouter)), 0);
    }

    function test_coverAfterThePriceMovedAgainstTheShort() public {
        _fund(trader, 600e18);
        vm.prank(trader);
        shortRouter.short(address(nvda), 10e18, _sellPath(), 0);
        dex.setPrice(address(nvda), 120e18);
        oracle.setQuote(address(nvda), 120e18, IOracleRouter.Regime.Open);

        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(MockSwapRouter.TooMuchRequested.selector, 1_200e18, 1_100e18));
        shortRouter.cover(address(nvda), 10e18, _buyPath(), 1_100e18);

        vm.prank(trader);
        uint256 spent = shortRouter.cover(address(nvda), 10e18, _buyPath(), 1_300e18);
        assertEq(spent, 1_200e18);
        assertEq(ctl.collateralOf(trader), 400e18, "the 200 loss came out of margin");
    }

    // ------------------------------------------------------------------ S5

    function test_routerNeedsOperatorApprovalAndControllerOnlyCallbacks() public {
        _fund(outsider, 600e18);
        vm.prank(outsider);
        vm.expectRevert(Controller.NotOperator.selector);
        shortRouter.short(address(nvda), 1e18, _sellPath(), 0);

        vm.prank(outsider);
        vm.expectRevert(ShortRouter.NotController.selector);
        shortRouter.onStockroomBorrow(outsider, address(nvda), 1e18, "");
        vm.prank(outsider);
        vm.expectRevert(ShortRouter.NotController.selector);
        shortRouter.onStockroomWithdraw(outsider, 1, "");
    }

    // ------------------------------------------------------------------ L1, L2

    function test_flashLiquidationNeedsNoCapital() public {
        _fund(trader, 1_500e18);
        vm.prank(trader);
        ctl.borrow(address(nvda), 10e18, trader);
        oracle.setQuote(address(nvda), 125e18, IOracleRouter.Regime.Open); // health 0.96
        dex.setPrice(address(nvda), 125e18);

        uint256 poolAssetsBefore = pool.totalAssets();
        uint256 fee = pool.flashFee(address(nvda), 5e18);
        uint256 expectedProfit = 631_250_000e12 - (5e18 + fee) * 125; // USDT received minus cost of 5 + fee

        vm.prank(keeper);
        uint256 profit = liquidator.liquidateWithFlash(trader, address(nvda), 5e18, _buyPath(), expectedProfit);
        assertEq(profit, expectedProfit);
        assertEq(cash.balanceOf(keeper), expectedProfit);
        assertEq(ctl.positionOf(trader, address(nvda)), 5e18);
        assertEq(pool.totalBorrows(), 5e18);
        assertEq(pool.totalAssets(), poolAssetsBefore + fee, "lenders earned the flash fee");
        assertEq(nvda.balanceOf(address(liquidator)), 0);
        assertEq(cash.balanceOf(address(liquidator)), 0);
    }

    function test_flashLiquidationCapsAtTheCloseFactor() public {
        _fund(trader, 1_500e18);
        vm.prank(trader);
        ctl.borrow(address(nvda), 10e18, trader);
        oracle.setQuote(address(nvda), 125e18, IOracleRouter.Regime.Open);
        dex.setPrice(address(nvda), 125e18);

        vm.prank(keeper);
        liquidator.liquidateWithFlash(trader, address(nvda), 10e18, _buyPath(), 0); // only half can be taken
        assertEq(ctl.positionOf(trader, address(nvda)), 5e18);
        assertEq(nvda.balanceOf(address(liquidator)), 0, "unused flash tokens went back");
    }

    function test_flashLiquidationGuards() public {
        _fund(trader, 1_500e18);
        vm.prank(trader);
        ctl.borrow(address(nvda), 10e18, trader);
        oracle.setQuote(address(nvda), 125e18, IOracleRouter.Regime.Open);
        dex.setPrice(address(nvda), 125e18);

        vm.prank(keeper);
        vm.expectRevert();
        liquidator.liquidateWithFlash(trader, address(nvda), 5e18, _buyPath(), 100e18);

        vm.prank(outsider);
        vm.expectRevert(Liquidator.NotPool.selector);
        liquidator.onFlashLoan(address(liquidator), address(nvda), 1, 0, "");
    }
}
