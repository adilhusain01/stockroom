// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Controller} from "../src/Controller.sol";
import {LendingPool} from "../src/LendingPool.sol";
import {RiskMathRef} from "../src/RiskMathRef.sol";
import {ILendingPool} from "../src/interfaces/ILendingPool.sol";
import {IOracleRouter} from "../src/interfaces/IOracleRouter.sol";
import {IRiskEngine} from "../src/interfaces/IRiskEngine.sol";
import {MockStockToken} from "../src/mocks/MockStockToken.sol";
import {MockCash} from "../src/mocks/MockCash.sol";
import {MockOracleRouter} from "../src/mocks/MockOracleRouter.sol";

/// Requirements (docs/spec.md, "Mechanism" and "Contracts"):
///  C1  USDT collateral can be deposited and withdrawn; withdrawals never exceed the balance; a per-account cap holds
///  C2  a borrow needs a listed, unpaused market, an oracle regime that allows borrowing, room under the borrow cap,
///      and collateral worth at least debt x initial ratio afterwards
///  C3  a borrow moves raw units from the pool to the recipient and records the position
///  C4  fees accrue in USDT as debt x price x rate(utilisation) x time; 90 percent is credited to lenders and
///      10 percent to insurance; the borrower pays out of collateral when the account is touched
///  C5  health = collateral net of pending fees over debt x liquidation threshold
///  C6  liquidation: only below health 1; close factor 50 percent, or 100 percent below 0.95; payout at the Dutch
///      discount; payout capped by collateral; a minimum-out guard; the auction clears once health is back above 1
///  C7  with no collateral left, remaining debt is absorbed: insurance compensates lenders in USDT, the pool writes
///      the raw units off
///  C8  only listed pools can pull lender rewards
///  C9  only the owner lists markets, listings are validated, the guardian can pause borrows
///  C10 one USDT balance backs borrows across several markets
///  C11 repaying clears the position and ends an auction once healthy
///  C12 a paused or degraded oracle regime blocks new borrows but never repayment, withdrawal or liquidation
contract ControllerTest is Test {
    uint256 constant WAD = 1e18;

    MockCash cash;
    MockStockToken nvda;
    MockStockToken tsla;
    MockOracleRouter oracle;
    RiskMathRef engine;
    Controller ctl;
    LendingPool nvdaPool;
    LendingPool tslaPool;

    address lender = makeAddr("lender");
    address borrower = makeAddr("borrower");
    address liquidator = makeAddr("liquidator");
    address outsider = makeAddr("outsider");
    address guardian = makeAddr("guardian");

    function _params() internal pure returns (Controller.MarketParams memory) {
        return Controller.MarketParams({
            initialRatioWad: 1.5e18,
            liqThresholdWad: 1.25e18,
            dutchMinWad: 0.01e18,
            dutchMaxWad: 0.12e18,
            dutchDuration: 20 minutes,
            borrowCapRaw: 1_000e18,
            irm: IRiskEngine.IrmParams({baseWad: 0.01e18, kinkWad: 0.8e18, rateAtKinkWad: 0.10e18, maxRateWad: 1.5e18})
        });
    }

    function setUp() public {
        cash = new MockCash(address(this));
        nvda = new MockStockToken("NVIDIA Robinhood Token", "NVDA", address(this));
        tsla = new MockStockToken("Tesla Robinhood Token", "TSLA", address(this));
        oracle = new MockOracleRouter();
        engine = new RiskMathRef();
        ctl = new Controller(IERC20(address(cash)), oracle, engine, address(this));
        ctl.setGuardian(guardian);
        nvdaPool = new LendingPool(IERC20(address(nvda)), "Stockroom NVDA", "lNVDA", address(ctl), 0.9e18);
        tslaPool = new LendingPool(IERC20(address(tsla)), "Stockroom TSLA", "lTSLA", address(ctl), 0.9e18);
        ctl.listMarket(address(nvda), nvdaPool, _params());
        ctl.listMarket(address(tsla), tslaPool, _params());
        oracle.setQuote(address(nvda), 100e18, IOracleRouter.Regime.Open);
        oracle.setQuote(address(tsla), 200e18, IOracleRouter.Regime.Open);

        _lend(nvda, nvdaPool, 100e18);
        _lend(tsla, tslaPool, 100e18);
        _fund(borrower, 1_500e18);
    }

    // ------------------------------------------------------------------ helpers

    function _lend(MockStockToken token, LendingPool pool, uint256 amount) internal {
        token.mint(lender, amount);
        vm.startPrank(lender);
        token.approve(address(pool), amount);
        pool.deposit(amount, lender);
        vm.stopPrank();
    }

    function _fund(address who, uint256 amount) internal {
        cash.mint(who, amount);
        vm.startPrank(who);
        cash.approve(address(ctl), amount);
        ctl.depositCollateral(amount, who);
        vm.stopPrank();
    }

    function _borrow(address who, MockStockToken token, uint256 raw) internal {
        vm.prank(who);
        ctl.borrow(address(token), raw, who);
    }

    function _liquidate(MockStockToken token, uint256 repayRaw, uint256 minOut) internal returns (uint256) {
        token.mint(liquidator, repayRaw);
        vm.startPrank(liquidator);
        token.approve(address(ctl), repayRaw);
        (, uint256 out) = ctl.liquidate(borrower, address(token), repayRaw, minOut);
        vm.stopPrank();
        return out;
    }

    // ------------------------------------------------------------------ C1

    function test_depositAndWithdrawCollateral() public {
        assertEq(ctl.collateralOf(borrower), 1_500e18);
        assertEq(cash.balanceOf(address(ctl)), 1_500e18);
        vm.prank(borrower);
        ctl.withdrawCollateral(500e18, borrower);
        assertEq(ctl.collateralOf(borrower), 1_000e18);
        assertEq(cash.balanceOf(borrower), 500e18);
        vm.prank(borrower);
        vm.expectRevert(abi.encodeWithSelector(Controller.InsufficientCollateral.selector, 1_000e18));
        ctl.withdrawCollateral(1_000e18 + 1, borrower);
    }

    function test_collateralCapIsEnforced() public {
        ctl.setCollateralCap(2_000e18);
        cash.mint(borrower, 1_000e18);
        vm.startPrank(borrower);
        cash.approve(address(ctl), 1_000e18);
        vm.expectRevert(abi.encodeWithSelector(Controller.CollateralCapExceeded.selector, 2_000e18));
        ctl.depositCollateral(1_000e18, borrower);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ C2, C3

    function test_borrowUpToTheInitialRatio() public {
        _borrow(borrower, nvda, 10e18); // $1000 of debt against $1500: exactly 1.5x
        vm.prank(borrower);
        vm.expectRevert();
        ctl.borrow(address(nvda), 1, borrower);
    }

    function test_borrowMovesTokensAndRecordsDebt() public {
        vm.expectEmit(address(ctl));
        emit Controller.Borrowed(borrower, address(nvda), borrower, 10e18);
        _borrow(borrower, nvda, 10e18);
        assertEq(nvda.balanceOf(borrower), 10e18);
        assertEq(ctl.positionOf(borrower, address(nvda)), 10e18);
        assertEq(ctl.market(address(nvda)).totalDebtRaw, 10e18);
        assertEq(nvdaPool.totalBorrows(), 10e18);
        address[] memory tokens = ctl.borrowedTokens(borrower);
        assertEq(tokens.length, 1);
        assertEq(tokens[0], address(nvda));
        assertEq(ctl.healthFactor(borrower), 1.2e18);
    }

    function test_borrowBlockedByRegimeCapPauseAndListing() public {
        oracle.setQuote(address(nvda), 100e18, IOracleRouter.Regime.Paused);
        vm.prank(borrower);
        vm.expectRevert(Controller.BorrowNotAllowedByOracle.selector);
        ctl.borrow(address(nvda), 1e18, borrower);
        oracle.setQuote(address(nvda), 100e18, IOracleRouter.Regime.Open);

        Controller.MarketParams memory p = _params();
        p.borrowCapRaw = 5e18;
        ctl.setMarketParams(address(nvda), p);
        vm.prank(borrower);
        vm.expectRevert(abi.encodeWithSelector(Controller.BorrowCapExceeded.selector, 5e18));
        ctl.borrow(address(nvda), 6e18, borrower);

        vm.prank(guardian);
        ctl.setBorrowPaused(address(nvda), true);
        vm.prank(borrower);
        vm.expectRevert(Controller.BorrowsPaused.selector);
        ctl.borrow(address(nvda), 1e18, borrower);

        vm.prank(guardian);
        ctl.setBorrowPaused(address(nvda), false);
        vm.prank(guardian);
        ctl.setGlobalBorrowPause(true);
        vm.prank(borrower);
        vm.expectRevert(Controller.BorrowsPaused.selector);
        ctl.borrow(address(nvda), 1e18, borrower);

        vm.prank(borrower);
        vm.expectRevert(abi.encodeWithSelector(Controller.MarketNotListed.selector, address(cash)));
        ctl.borrow(address(cash), 1e18, borrower);
    }

    // ------------------------------------------------------------------ C4

    function test_feesAccrueInUsdgToLendersInsuranceAndBorrower() public {
        address whale = makeAddr("whale");
        _fund(whale, 7_500e18);
        _borrow(whale, nvda, 50e18); // utilisation 50%: rate 1% + 9% x 0.5/0.8 = 6.625% on $5000

        vm.warp(block.timestamp + 365 days);
        assertEq(ctl.pendingFees(whale), 331_250_000e12, "fees owed after a year");
        assertEq(ctl.healthFactor(whale), (7_500e18 - 331.25e18) * WAD / 6_250e18);

        vm.expectEmit(address(ctl));
        emit Controller.FeesAccrued(address(nvda), 6.625e18, 298_125_000e12, 33_125_000e12);
        ctl.accrue(address(nvda));
        assertEq(nvdaPool.claimable(lender), 298_125_000e12);
        assertEq(ctl.insuranceBalance(), 33_125_000e12);
        assertEq(ctl.collateralOf(whale), 7_500e18, "not deducted until the account is touched");

        vm.startPrank(whale);
        nvda.approve(address(ctl), 1);
        ctl.repay(address(nvda), 1, whale);
        vm.stopPrank();
        assertEq(ctl.collateralOf(whale), 7_500e18 - 331_250_000e12);
        assertEq(ctl.pendingFees(whale), 0);

        vm.prank(lender);
        nvdaPool.claim(lender);
        assertEq(cash.balanceOf(lender), 298_125_000e12);
    }

    // ------------------------------------------------------------------ C5

    function test_healthTracksPriceAndFees() public {
        _borrow(borrower, nvda, 10e18);
        assertEq(ctl.healthFactor(borrower), 1.2e18);
        oracle.setQuote(address(nvda), 120e18, IOracleRouter.Regime.Open);
        assertEq(ctl.healthFactor(borrower), 1e18);
        oracle.setQuote(address(nvda), 121e18, IOracleRouter.Regime.Open);
        assertLt(ctl.healthFactor(borrower), 1e18);
        oracle.setQuote(address(nvda), 100e18, IOracleRouter.Regime.Open);
        vm.warp(block.timestamp + 30 days);
        assertLt(ctl.healthFactor(borrower), 1.2e18, "pending fees count against collateral");
        assertGt(ctl.pendingFees(borrower), 0);
    }

    // ------------------------------------------------------------------ C6

    function test_liquidationHalfCloseAtAuctionStart() public {
        _borrow(borrower, nvda, 10e18);
        oracle.setQuote(address(nvda), 125e18, IOracleRouter.Regime.Open); // health 0.96

        nvda.mint(liquidator, 10e18);
        vm.startPrank(liquidator);
        nvda.approve(address(ctl), 10e18);
        vm.expectEmit(address(ctl));
        emit Controller.AuctionStarted(borrower, 0.96e18);
        (uint256 repaidRaw, uint256 out) = ctl.liquidate(borrower, address(nvda), 10e18, 0);
        vm.stopPrank();
        assertEq(repaidRaw, 5e18);

        assertEq(out, 631_250_000e12, "5 shares x $125 x 1.01");
        assertEq(cash.balanceOf(liquidator), 631_250_000e12);
        assertEq(nvda.balanceOf(liquidator), 5e18, "only half the debt was taken");
        assertEq(ctl.positionOf(borrower, address(nvda)), 5e18);
        assertEq(nvdaPool.totalBorrows(), 5e18);
        assertEq(ctl.collateralOf(borrower), 868_750_000e12);
        assertEq(ctl.auctionStartOf(borrower), 0, "healthy again, auction cleared");
    }

    function test_dutchDiscountGrowsDuringTheAuction() public {
        _borrow(borrower, nvda, 10e18);
        oracle.setQuote(address(nvda), 125e18, IOracleRouter.Regime.Open);
        _liquidate(nvda, 1, 0); // opens the auction
        assertEq(ctl.auctionStartOf(borrower), block.timestamp);
        vm.warp(block.timestamp + 10 minutes); // discount 1% -> 6.5%
        uint256 out = _liquidate(nvda, 5e18, 0);
        assertEq(out, 665_625_000e12, "5 shares x $125 x 1.065");
    }

    function test_fullCloseBelowPointNineFive() public {
        _borrow(borrower, nvda, 10e18);
        oracle.setQuote(address(nvda), 140e18, IOracleRouter.Regime.Open); // health 0.857
        uint256 out = _liquidate(nvda, 10e18, 0);
        assertEq(out, 1_414_000_000e12);
        assertEq(ctl.positionOf(borrower, address(nvda)), 0);
        assertEq(ctl.collateralOf(borrower), 86_000_000e12);
        assertEq(ctl.borrowedTokens(borrower).length, 0);
        assertEq(ctl.auctionStartOf(borrower), 0);
    }

    function test_liquidationRevertsWhenHealthyOrBelowMinOut() public {
        _borrow(borrower, nvda, 10e18);
        nvda.mint(liquidator, 10e18);
        vm.startPrank(liquidator);
        nvda.approve(address(ctl), 10e18);
        vm.expectRevert(abi.encodeWithSelector(Controller.NotLiquidatable.selector, 1.2e18));
        ctl.liquidate(borrower, address(nvda), 5e18, 0);
        vm.stopPrank();

        oracle.setQuote(address(nvda), 125e18, IOracleRouter.Regime.Open);
        vm.prank(liquidator);
        vm.expectRevert(abi.encodeWithSelector(Controller.BelowMinOut.selector, 631_250_000e12, 700e18));
        ctl.liquidate(borrower, address(nvda), 5e18, 700e18);
    }

    function test_liquidationPayoutIsCappedByCollateral() public {
        _borrow(borrower, nvda, 10e18);
        oracle.setQuote(address(nvda), 160e18, IOracleRouter.Regime.Open); // health 0.75, debt worth $1600
        uint256 out = _liquidate(nvda, 10e18, 1_500e18);
        assertEq(out, 1_500e18);
        assertEq(ctl.collateralOf(borrower), 0);
        assertEq(ctl.positionOf(borrower, address(nvda)), 0);
    }

    // ------------------------------------------------------------------ C7

    function test_absorbWritesOffDebtAgainstInsurance() public {
        // build an insurance balance first
        address whale = makeAddr("whale");
        _fund(whale, 7_500e18);
        _borrow(whale, nvda, 50e18);
        vm.warp(block.timestamp + 365 days);
        ctl.accrue(address(nvda));
        uint256 insuranceBefore = ctl.insuranceBalance();
        assertGt(insuranceBefore, 0);

        // drive the borrower to zero collateral with debt left
        _borrow(borrower, nvda, 10e18);
        oracle.setQuote(address(nvda), 200e18, IOracleRouter.Regime.Open);
        _liquidate(nvda, 7e18, 0);
        oracle.setQuote(address(nvda), 1_000e18, IOracleRouter.Regime.Open);
        _liquidate(nvda, 0.1e18, 0);
        assertEq(ctl.collateralOf(borrower), 0);
        uint256 debtLeft = ctl.positionOf(borrower, address(nvda));
        assertGt(debtLeft, 0);

        uint256 lenderClaimBefore = nvdaPool.claimable(lender);
        uint256 borrowsBefore = nvdaPool.totalBorrows();
        uint256 owedCash = debtLeft * 1_000e18 / WAD;
        uint256 expectedCompensation = owedCash < insuranceBefore ? owedCash : insuranceBefore;

        vm.expectEmit(address(ctl));
        emit Controller.BadDebtAbsorbed(borrower, address(nvda), debtLeft, expectedCompensation);
        ctl.absorb(borrower);

        assertEq(ctl.positionOf(borrower, address(nvda)), 0);
        assertEq(ctl.borrowedTokens(borrower).length, 0);
        assertEq(nvdaPool.totalBorrows(), borrowsBefore - debtLeft, "raw units written off");
        assertEq(ctl.insuranceBalance(), insuranceBefore - expectedCompensation);
        assertEq(nvdaPool.claimable(lender), lenderClaimBefore + expectedCompensation, "lenders paid from insurance");
        assertEq(ctl.auctionStartOf(borrower), 0);
    }

    function test_absorbNeedsZeroCollateralAndSomeDebt() public {
        _borrow(borrower, nvda, 10e18);
        vm.expectRevert(Controller.CollateralRemains.selector);
        ctl.absorb(borrower);
        vm.expectRevert(Controller.NoDebt.selector);
        ctl.absorb(outsider);
    }

    // ------------------------------------------------------------------ C8, C9

    function test_onlyListedPoolsPullRewards() public {
        vm.prank(outsider);
        vm.expectRevert(Controller.NotPool.selector);
        ctl.payLenderReward(outsider, 1);
    }

    function test_listingIsValidatedAndOwnerOnly() public {
        vm.expectRevert(abi.encodeWithSelector(Controller.MarketAlreadyListed.selector, address(nvda)));
        ctl.listMarket(address(nvda), nvdaPool, _params());

        MockStockToken amzn = new MockStockToken("Amazon Robinhood Token", "AMZN", address(this));
        LendingPool wrongController = new LendingPool(IERC20(address(amzn)), "x", "x", address(this), 0.9e18);
        vm.expectRevert(Controller.InvalidPool.selector);
        ctl.listMarket(address(amzn), wrongController, _params());
        vm.expectRevert(Controller.InvalidPool.selector);
        ctl.listMarket(address(amzn), nvdaPool, _params());

        LendingPool amznPool = new LendingPool(IERC20(address(amzn)), "Stockroom AMZN", "lAMZN", address(ctl), 0.9e18);
        Controller.MarketParams memory bad = _params();
        bad.liqThresholdWad = 0.9e18;
        vm.expectRevert(Controller.InvalidParams.selector);
        ctl.listMarket(address(amzn), amznPool, bad);
        bad = _params();
        bad.initialRatioWad = 1.2e18; // below the liquidation threshold
        vm.expectRevert(Controller.InvalidParams.selector);
        ctl.listMarket(address(amzn), amznPool, bad);

        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, outsider));
        ctl.listMarket(address(amzn), amznPool, _params());

        ctl.listMarket(address(amzn), amznPool, _params());
        assertEq(ctl.marketCount(), 3);

        vm.prank(outsider);
        vm.expectRevert(Controller.NotGuardian.selector);
        ctl.setBorrowPaused(address(amzn), true);
    }

    // ------------------------------------------------------------------ C10

    function test_crossMarginAcrossMarkets() public {
        _borrow(borrower, nvda, 5e18); // $500
        _borrow(borrower, tsla, 2.5e18); // $500
        assertEq(ctl.healthFactor(borrower), 1.2e18);
        vm.prank(borrower);
        vm.expectRevert();
        ctl.borrow(address(tsla), 1, borrower);
        vm.prank(borrower);
        vm.expectRevert();
        ctl.withdrawCollateral(1, borrower);

        oracle.setQuote(address(tsla), 300e18, IOracleRouter.Regime.Open); // debt $1250, weighted $1562.5
        assertEq(ctl.healthFactor(borrower), 0.96e18);
        uint256 out = _liquidate(nvda, 5e18, 0); // half of the NVDA leg at $100 x 1.01
        assertEq(out, 252_500_000e12);
    }

    // ------------------------------------------------------------------ C11

    function test_repayClearsDebtAndAuction() public {
        _borrow(borrower, nvda, 10e18);
        oracle.setQuote(address(nvda), 125e18, IOracleRouter.Regime.Open);
        _liquidate(nvda, 1, 0);
        assertGt(ctl.auctionStartOf(borrower), 0);

        vm.startPrank(borrower);
        nvda.approve(address(ctl), 10e18);
        vm.expectEmit(address(ctl));
        emit Controller.AuctionCleared(borrower);
        ctl.repay(address(nvda), 5e18, borrower);
        assertEq(ctl.auctionStartOf(borrower), 0);
        uint256 repaid = ctl.repay(address(nvda), type(uint256).max, borrower);
        assertEq(repaid, 5e18 - 1);
        assertEq(ctl.positionOf(borrower, address(nvda)), 0);
        vm.expectRevert(Controller.NothingToRepay.selector);
        ctl.repay(address(nvda), 1, borrower);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ C12

    function test_pausedRegimeBlocksOnlyNewBorrows() public {
        _borrow(borrower, nvda, 10e18);
        oracle.setQuote(address(nvda), 100e18, IOracleRouter.Regime.Degraded);
        vm.prank(borrower);
        vm.expectRevert(Controller.BorrowNotAllowedByOracle.selector);
        ctl.borrow(address(nvda), 1e18, borrower);

        vm.startPrank(borrower);
        nvda.approve(address(ctl), 5e18);
        ctl.repay(address(nvda), 5e18, borrower);
        ctl.withdrawCollateral(100e18, borrower);
        vm.stopPrank();

        oracle.setQuote(address(nvda), 250e18, IOracleRouter.Regime.Paused); // 5 shares x $250 x 1.25 = $1562.5 vs $1400
        uint256 out = _liquidate(nvda, 5e18, 0);
        assertGt(out, 0);
    }
}
