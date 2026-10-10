// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Controller} from "../../src/Controller.sol";
import {LendingPool} from "../../src/LendingPool.sol";
import {RiskMathRef} from "../../src/RiskMathRef.sol";
import {MarketCalendar} from "../../src/MarketCalendar.sol";
import {OracleRouter} from "../../src/OracleRouter.sol";
import {ShortRouter} from "../../src/periphery/ShortRouter.sol";
import {Liquidator} from "../../src/periphery/Liquidator.sol";
import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";
import {IOracleRouter} from "../../src/interfaces/IOracleRouter.sol";
import {IPancakeV3Pool} from "../../src/interfaces/IPancakeV3.sol";
import {IRiskEngine} from "../../src/interfaces/IRiskEngine.sol";
import {ISwapRouterV3} from "../../src/interfaces/ISwapRouterV3.sol";
import {IScaledUIAmount} from "../../src/interfaces/IERC8056.sol";
import {MockOracleRouter} from "../../src/mocks/MockOracleRouter.sol";
import {RelayFeed} from "../../src/RelayFeed.sol";

/// Live-chain checks against BSC mainnet (run with `forge test --match-path "test/fork/*" --no-match-path x`):
///  F1 NVDAB is a BEP-677 token whose multiplier is above 1 and whose `effectiveAt` is in the past
///  F2 the APRO NVDAB/USD feed answers with 8 decimals, the PancakeSwap v3 TWAP agrees with the pool's spot
///     within 1 percent, and the router's quote sits within 6 percent of spot (gap premium included)
///  F3 a real lender deposit, a real short through the PancakeSwap v3 SwapRouter, and a real cover work
///     end to end with the USDT proceeds counted as margin
///  F4 a flash liquidation through the live pool needs no capital and pays the caller
///  F5 the APRO USDT/USD feed prices cash at or below one dollar
contract BscForkTest is Test {
    address constant NVDAB = 0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436;
    address constant USDT = 0x55d398326f99059fF775485246999027B3197955;
    address constant APRO_NVDAB = 0x310EFC9Fefe89B8085F89E91Ac782Bef6416499E;
    address constant APRO_USDT = 0xa1b70AADB162Ea9c7A1e5dD23720E6d4343C9264;
    address constant POOL = 0x8FB4243b553aC29BA088aCf00B9B7dA24bD6690C; // NVDAB/USDT 0.25%
    address constant ROUTER = 0x1b81D678ffb9C0263b24A97847620C99d213eB14; // PancakeSwap v3 SwapRouter
    uint24 constant FEE = 2500;
    uint256 constant WAD = 1e18;

    MarketCalendar cal;
    OracleRouter oracle;
    RelayFeed nvdabFeed;
    RelayFeed usdtFeed;
    RiskMathRef engine;
    Controller ctl;
    LendingPool pool;
    ShortRouter shortRouter;
    Liquidator liquidator;

    address lender = makeAddr("lender");
    address borrower = makeAddr("borrower");
    address keeperBot = makeAddr("keeperBot");
    address relayer = makeAddr("relayer");

    function setUp() public {
        vm.createSelectFork(vm.envOr("BSC_RPC_URL", string("https://bsc-rpc.publicnode.com")));
        cal = new MarketCalendar(address(this));
        oracle = new OracleRouter(cal, address(this));
        // APRO feeds only answer externally owned accounts ("No access" otherwise), so the keeper relays them
        nvdabFeed = new RelayFeed(8, "NVDAB/USD (APRO relay)", APRO_NVDAB, address(this));
        usdtFeed = new RelayFeed(8, "USDT/USD (APRO relay)", APRO_USDT, address(this));
        _relay(nvdabFeed, APRO_NVDAB);
        _relay(usdtFeed, APRO_USDT);
        oracle.setFeed(NVDAB, IAggregatorV3(address(nvdabFeed)), 1 hours);
        oracle.setPool(NVDAB, IPancakeV3Pool(POOL), 30 minutes, 0.03e18);
        oracle.setCashFeed(IAggregatorV3(address(usdtFeed)), 1 days);
        engine = new RiskMathRef();
        ctl = new Controller(IERC20(USDT), oracle, engine, address(this));
        pool = new LendingPool(IERC20(NVDAB), "Stockroom NVDAB", "sNVDAB", address(ctl), 0.9e18);
        ctl.listMarket(
            NVDAB,
            pool,
            Controller.MarketParams({
                initialRatioWad: 1.5e18,
                liqThresholdWad: 1.25e18,
                dutchMinWad: 0.01e18,
                dutchMaxWad: 0.12e18,
                dutchDuration: 20 minutes,
                borrowCapRaw: 100e18,
                irm: IRiskEngine.IrmParams({
                    baseWad: 0.01e18, kinkWad: 0.8e18, rateAtKinkWad: 0.10e18, maxRateWad: 1.5e18
                })
            })
        );
        shortRouter = new ShortRouter(ctl, ISwapRouterV3(ROUTER));
        liquidator = new Liquidator(ctl, ISwapRouterV3(ROUTER));

        // the deepest NVDAB pool holds thousands of tokens; borrow a few for the lender
        vm.prank(POOL);
        IERC20(NVDAB).transfer(lender, 20e18);
        deal(USDT, borrower, 50_000e18);
        deal(USDT, keeperBot, 1e18);
    }

    // ------------------------------------------------------------------ F1

    function test_nvdabIsALiveBep677Token() public view {
        uint256 m = IScaledUIAmount(NVDAB).uiMultiplier();
        assertGt(m, WAD, "dividends have already been reinvested");
        assertLt(m, 1.1e18);
        assertFalse(oracle.multiplierPending(NVDAB));
        assertFalse(oracle.tokenPaused(NVDAB));
        assertEq(pool.uiMultiplier(), m, "the pool reads the same multiplier");
    }

    // ------------------------------------------------------------------ F2, F5

    function test_oracleAgreesWithThePool() public view {
        (uint256 feedPrice, uint256 updatedAt) = oracle.feedPrice(NVDAB);
        assertGt(feedPrice, 50e18);
        assertLt(feedPrice, 2_000e18);
        assertLt(block.timestamp - updatedAt, 2 hours, "APRO prints at least hourly");

        (bool ok, uint256 twap) = oracle.twapPrice(NVDAB);
        assertTrue(ok);
        uint256 spot = _spotPrice();
        assertApproxEqRel(twap, spot, 0.01e18, "30-minute TWAP vs spot");

        IOracleRouter.Quote memory q = oracle.quote(NVDAB);
        console2.log("regime", uint256(q.regime), "price", q.priceWad);
        console2.log("feed", feedPrice, "twap", twap);
        assertTrue(q.regime == IOracleRouter.Regime.Open || q.regime == IOracleRouter.Regime.Closed);
        assertGe(q.priceWad, feedPrice);
        assertLe(q.priceWad, spot * 1.06e18 / WAD, "at most spot plus the 5 percent gap premium and 1 percent drift");

        uint256 cash = oracle.cashPriceWad();
        assertLe(cash, WAD);
        assertGt(cash, 0.98e18);
    }

    // ------------------------------------------------------------------ F3

    function test_lendShortAndCoverOnTheLivePool() public {
        vm.startPrank(lender);
        IERC20(NVDAB).approve(address(pool), 20e18);
        uint256 shares = pool.deposit(20e18, lender);
        vm.stopPrank();
        assertGt(shares, 0);
        assertEq(pool.idle(), 20e18);

        vm.startPrank(borrower);
        IERC20(USDT).approve(address(ctl), 5_000e18);
        ctl.depositCollateral(5_000e18, borrower);
        ctl.setOperator(address(shortRouter), true);
        uint256 collateralBefore = ctl.collateralOf(borrower);
        bytes memory sellPath = abi.encodePacked(NVDAB, FEE, USDT);
        uint256 proceeds = shortRouter.short(NVDAB, 2e18, sellPath, 300e18);
        vm.stopPrank();

        assertGt(proceeds, 300e18);
        assertEq(ctl.collateralOf(borrower), collateralBefore + proceeds, "proceeds became margin");
        assertEq(ctl.positionOf(borrower, NVDAB), 2e18);
        assertEq(pool.totalBorrows(), 2e18);
        assertGt(ctl.healthFactor(borrower), WAD);
        console2.log("short proceeds (USDT wei)", proceeds, "health", ctl.healthFactor(borrower));

        vm.startPrank(borrower);
        bytes memory buyPath = abi.encodePacked(NVDAB, FEE, USDT); // exactOutput: token out first
        uint256 spent = shortRouter.cover(NVDAB, 2e18, buyPath, proceeds * 105 / 100);
        vm.stopPrank();
        assertEq(ctl.positionOf(borrower, NVDAB), 0);
        assertEq(pool.totalBorrows(), 0);
        assertEq(pool.idle(), 20e18, "the lender's raw units are all back");
        assertApproxEqRel(spent, proceeds, 0.02e18, "round trip costs the spread and fees");
        console2.log("cover spent (USDT wei)", spent);
    }

    // ------------------------------------------------------------------ F4

    function test_flashLiquidationOnTheLivePool() public {
        vm.startPrank(lender);
        IERC20(NVDAB).approve(address(pool), 20e18);
        pool.deposit(20e18, lender);
        vm.stopPrank();

        vm.startPrank(borrower);
        IERC20(USDT).approve(address(ctl), 2_000e18);
        ctl.depositCollateral(2_000e18, borrower);
        ctl.borrow(NVDAB, 5e18, borrower); // about 5 x 230 x 1.5 = 1,725 USDT required
        vm.stopPrank();
        assertGt(ctl.healthFactor(borrower), WAD);

        // the stock gaps up 40 percent: swap the oracle for one that says so
        MockOracleRouter gapOracle = new MockOracleRouter();
        gapOracle.setQuote(NVDAB, _spotPrice() * 140 / 100, IOracleRouter.Regime.Open);
        ctl.setOracle(gapOracle);
        assertLt(ctl.healthFactor(borrower), WAD, "under water");

        bytes memory buyPath = abi.encodePacked(NVDAB, FEE, USDT);
        uint256 usdtBefore = IERC20(USDT).balanceOf(keeperBot);
        vm.prank(keeperBot);
        uint256 profit = liquidator.liquidateWithFlash(borrower, NVDAB, 5e18, buyPath, 0);
        assertGt(profit, 0);
        assertEq(IERC20(USDT).balanceOf(keeperBot), usdtBefore + profit);
        assertLe(ctl.positionOf(borrower, NVDAB), 5e18 - 2.5e18 + 1, "close factor of a half at auction start");
        console2.log("liquidation profit (USDT wei)", profit);
    }

    // ------------------------------------------------------------------ helpers

    /// @dev Read a live APRO print the way the keeper does (from an EOA) and push it into the relay.
    function _relay(RelayFeed relay, address source) internal {
        vm.prank(relayer, relayer);
        (, int256 answer,, uint256 updatedAt,) = IAggregatorV3(source).latestRoundData();
        relay.setAnswer(answer, updatedAt);
    }

    function test_aproFeedsRefuseContractsButAnswerWallets() public {
        vm.expectRevert(bytes("No access"));
        IAggregatorV3(APRO_NVDAB).latestRoundData();
        vm.prank(relayer, relayer);
        (, int256 answer,,,) = IAggregatorV3(APRO_NVDAB).latestRoundData();
        assertGt(answer, 0);
        assertEq(IAggregatorV3(APRO_NVDAB).decimals(), 8);
    }

    function _spotPrice() internal view returns (uint256) {
        (uint160 sqrtPriceX96,,,,,,) = IPancakeV3Pool(POOL).slot0();
        uint256 p = uint256(sqrtPriceX96) * uint256(sqrtPriceX96) / (1 << 96);
        return p * WAD / (1 << 96); // NVDAB is token0, both 18 decimals
    }
}
