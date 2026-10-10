// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC3156FlashBorrower} from "@openzeppelin/contracts/interfaces/IERC3156FlashBorrower.sol";
import {LendingPool} from "../src/LendingPool.sol";
import {ILendingPool} from "../src/interfaces/ILendingPool.sol";
import {MockStockToken} from "../src/mocks/MockStockToken.sol";
import {MockCash} from "../src/mocks/MockCash.sol";
import {GoodFlashBorrower, StingyFlashBorrower, WrongReturnFlashBorrower} from "./mocks/FlashBorrowers.sol";

/// Requirements under test (docs/spec.md, "LendingPool"):
///  R1  a deposit of R raw units is redeemable for R raw units
///  R2  a multiplier change on the stock token leaves raw claims unchanged and scales effective shares
///  R3  only the Controller can borrow, repay, write off or notify rewards
///  R4  borrowing moves raw units out, keeps totalAssets constant and leaves lender claims unchanged
///  R5  borrows may not push utilisation above the cap; exactly the cap is allowed
///  R6  borrows above idle liquidity revert
///  R7  repay reduces outstanding borrows and never below zero
///  R8  lender withdrawals are limited by idle liquidity
///  R9  flash loans of X must return X plus 0.05 percent (rounded up) in the same transaction, the fee stays
///      with lenders
///  R10 a deposit that would mint zero shares reverts
///  R11 the ERC-4626 inflation attack is never profitable and a victim loses at most one share's rounding
///  R12 a write-off socialises the loss across lender shares pro rata
///  R13 USDT rewards split pro rata by shares, settle on transfer, and pay out through the Controller
contract LendingPoolTest is Test {
    uint256 constant WAD = 1e18;
    uint256 constant MAX_UTIL = 0.9e18;

    MockStockToken token;
    MockCash cash;
    LendingPool pool;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address borrower = makeAddr("borrower");
    address outsider = makeAddr("outsider");

    // This test contract plays the Controller: it is the only caller allowed to borrow, and it pays rewards.
    function payLenderReward(address to, uint256 amount) external {
        require(msg.sender == address(pool), "only pool");
        cash.transfer(to, amount);
    }

    function setUp() public {
        token = new MockStockToken("NVIDIA Robinhood Token", "NVDA", address(this));
        cash = new MockCash(address(this));
        pool = new LendingPool(IERC20(address(token)), "Stockroom NVDA", "lNVDA", address(this), MAX_UTIL);
        cash.mint(address(this), 1_000_000e18);
    }

    function _deposit(address who, uint256 amount) internal returns (uint256 shares) {
        token.mint(who, amount);
        vm.startPrank(who);
        token.approve(address(pool), amount);
        shares = pool.deposit(amount, who);
        vm.stopPrank();
    }

    function _repay(address from, uint256 amount) internal {
        vm.prank(from);
        token.approve(address(pool), amount);
        pool.repay(amount, from);
    }

    // ------------------------------------------------------------------ R1, R2

    function testFuzz_depositIsRedeemableOneToOne(uint256 amount) public {
        amount = bound(amount, 1, 1e30);
        uint256 shares = _deposit(alice, amount);
        assertEq(pool.previewRedeem(shares), amount);
        assertEq(pool.maxWithdraw(alice), amount);
        assertEq(pool.totalAssets(), amount);
    }

    function test_multiplierChangeLeavesRawClaimsAndScalesUI() public {
        uint256 shares = _deposit(alice, 100e18);
        assertEq(pool.uiMultiplier(), 1e18);
        assertEq(pool.balanceOfUI(alice), 100e18);

        token.scheduleMultiplier(2e18, block.timestamp);
        assertEq(pool.previewRedeem(shares), 100e18, "raw claim must not move");
        assertEq(pool.uiMultiplier(), 2e18);
        assertEq(pool.balanceOfUI(alice), 200e18);
        assertEq(pool.totalSupplyUI(), 200e18);

        uint256 at = block.timestamp + 1 days;
        token.scheduleMultiplier(3e18, at);
        assertEq(pool.balanceOfUI(alice), 200e18, "pending multiplier is not applied early");
        vm.warp(at);
        assertEq(pool.balanceOfUI(alice), 300e18);
        assertEq(pool.previewRedeem(shares), 100e18);
    }

    function test_uiMultiplierFallsBackToOneForPlainTokens() public {
        LendingPool plain = new LendingPool(IERC20(address(cash)), "Stockroom USDT", "lUSDG", address(this), MAX_UTIL);
        assertEq(plain.uiMultiplier(), 1e18);
    }

    // ------------------------------------------------------------------ R3

    function test_onlyControllerMayBorrowRepayWriteOffNotify() public {
        _deposit(alice, 100e18);
        vm.startPrank(outsider);
        vm.expectRevert(LendingPool.NotController.selector);
        pool.borrow(1e18, outsider);
        vm.expectRevert(LendingPool.NotController.selector);
        pool.repay(1e18, outsider);
        vm.expectRevert(LendingPool.NotController.selector);
        pool.writeOff(1e18);
        vm.expectRevert(LendingPool.NotController.selector);
        pool.notifyReward(1e18);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ R4

    function test_borrowMovesRawUnitsAndKeepsLenderClaims() public {
        uint256 shares = _deposit(alice, 100e18);
        vm.expectEmit(address(pool));
        emit ILendingPool.Borrow(borrower, 40e18);
        pool.borrow(40e18, borrower);

        assertEq(token.balanceOf(borrower), 40e18);
        assertEq(pool.totalBorrows(), 40e18);
        assertEq(pool.idle(), 60e18);
        assertEq(pool.totalAssets(), 100e18);
        assertEq(pool.utilisation(), 0.4e18);
        assertEq(pool.previewRedeem(shares), 100e18);
    }

    // ------------------------------------------------------------------ R5

    function test_borrowUpToTheUtilisationCapSucceeds() public {
        _deposit(alice, 100e18);
        pool.borrow(90e18, borrower);
        assertEq(pool.utilisation(), MAX_UTIL);
    }

    function test_borrowPastTheUtilisationCapReverts() public {
        _deposit(alice, 100e18);
        vm.expectRevert(
            abi.encodeWithSelector(LendingPool.UtilisationCapExceeded.selector, MAX_UTIL + 1, MAX_UTIL)
        );
        pool.borrow(90e18 + 1, borrower);

        pool.borrow(90e18, borrower);
        vm.expectRevert();
        pool.borrow(1, borrower);
    }

    // ------------------------------------------------------------------ R6

    function test_borrowAboveIdleReverts() public {
        _deposit(alice, 100e18);
        pool.borrow(50e18, borrower);
        vm.expectRevert(abi.encodeWithSelector(LendingPool.InsufficientLiquidity.selector, 50e18));
        pool.borrow(50e18 + 1, borrower);
    }

    function test_zeroBorrowReverts() public {
        _deposit(alice, 100e18);
        vm.expectRevert(LendingPool.ZeroAmount.selector);
        pool.borrow(0, borrower);
    }

    // ------------------------------------------------------------------ R7

    function test_repayReducesBorrows() public {
        _deposit(alice, 100e18);
        pool.borrow(40e18, borrower);
        vm.prank(borrower);
        token.approve(address(pool), 40e18);
        vm.expectEmit(address(pool));
        emit ILendingPool.Repay(borrower, 15e18);
        pool.repay(15e18, borrower);
        assertEq(pool.totalBorrows(), 25e18);
        assertEq(pool.idle(), 75e18);
        pool.repay(25e18, borrower);
        assertEq(pool.totalBorrows(), 0);
        assertEq(pool.idle(), 100e18);
    }

    function test_repayAboveBorrowsReverts() public {
        _deposit(alice, 100e18);
        pool.borrow(40e18, borrower);
        token.mint(borrower, 1e18);
        vm.prank(borrower);
        token.approve(address(pool), 41e18);
        vm.expectRevert(abi.encodeWithSelector(LendingPool.RepayExceedsBorrows.selector, 40e18));
        pool.repay(40e18 + 1, borrower);
    }

    // ------------------------------------------------------------------ R8

    function test_lenderWithdrawalsAreLimitedByIdle() public {
        uint256 shares = _deposit(alice, 100e18);
        pool.borrow(40e18, borrower);
        assertEq(pool.maxWithdraw(alice), 60e18);
        assertLt(pool.maxRedeem(alice), shares);

        vm.startPrank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxWithdraw.selector, alice, 60e18 + 1, 60e18)
        );
        pool.withdraw(60e18 + 1, alice, alice);
        vm.expectRevert();
        pool.redeem(shares, alice, alice);
        pool.withdraw(60e18, alice, alice);
        vm.stopPrank();

        assertEq(token.balanceOf(alice), 60e18);
        assertEq(pool.idle(), 0);
        assertEq(pool.totalAssets(), 40e18, "remaining claim is the borrowed amount");
    }

    // ------------------------------------------------------------------ R9

    function test_flashFeeIsFiveBpsRoundedUp() public view {
        assertEq(pool.flashFee(address(token), 1e18), 5e14);
        assertEq(pool.flashFee(address(token), 1), 1);
        assertEq(pool.flashFee(address(token), 10_000), 5);
        assertEq(pool.flashFee(address(token), 10_001), 6);
    }

    function test_flashLoanRepaidWithFeeGrowsLenderClaims() public {
        uint256 shares = _deposit(alice, 100e18);
        GoodFlashBorrower good = new GoodFlashBorrower();
        uint256 fee = pool.flashFee(address(token), 10e18);
        token.mint(address(good), fee);
        assertEq(pool.maxFlashLoan(address(token)), 100e18);

        vm.expectEmit(address(pool));
        emit ILendingPool.FlashLoan(address(good), 10e18, fee);
        assertTrue(pool.flashLoan(IERC3156FlashBorrower(address(good)), address(token), 10e18, ""));

        assertEq(good.lastAmount(), 10e18);
        assertEq(good.lastFee(), fee);
        assertEq(pool.totalAssets(), 100e18 + fee);
        assertApproxEqAbs(pool.previewRedeem(shares), 100e18 + fee, 1);
    }

    function test_flashLoanWithoutFeeReverts() public {
        _deposit(alice, 100e18);
        StingyFlashBorrower stingy = new StingyFlashBorrower();
        vm.expectRevert();
        pool.flashLoan(IERC3156FlashBorrower(address(stingy)), address(token), 10e18, "");
        assertEq(pool.totalAssets(), 100e18);
    }

    function test_flashLoanWithWrongMagicValueReverts() public {
        _deposit(alice, 100e18);
        WrongReturnFlashBorrower wrong = new WrongReturnFlashBorrower();
        token.mint(address(wrong), 1e18);
        vm.expectRevert(LendingPool.FlashCallbackFailed.selector);
        pool.flashLoan(IERC3156FlashBorrower(address(wrong)), address(token), 10e18, "");
    }

    function test_flashLoanLimits() public {
        _deposit(alice, 100e18);
        pool.borrow(30e18, borrower);
        assertEq(pool.maxFlashLoan(address(token)), 70e18);
        assertEq(pool.maxFlashLoan(address(cash)), 0);
        GoodFlashBorrower good = new GoodFlashBorrower();
        token.mint(address(good), 1e18);
        vm.expectRevert(abi.encodeWithSelector(LendingPool.InsufficientLiquidity.selector, 70e18));
        pool.flashLoan(IERC3156FlashBorrower(address(good)), address(token), 70e18 + 1, "");
        vm.expectRevert(abi.encodeWithSelector(LendingPool.UnsupportedToken.selector, address(cash)));
        pool.flashLoan(IERC3156FlashBorrower(address(good)), address(cash), 1, "");
    }

    // ------------------------------------------------------------------ R10, R11

    function test_zeroShareDepositReverts() public {
        _deposit(alice, 1);
        token.mint(alice, 1e24);
        vm.prank(alice);
        token.transfer(address(pool), 1e24);

        token.mint(bob, 1e12);
        vm.startPrank(bob);
        token.approve(address(pool), 1e12);
        vm.expectRevert(LendingPool.ZeroShares.selector);
        pool.deposit(1e12, bob);
        vm.stopPrank();
    }

    function testFuzz_inflationAttackIsUnprofitable(uint256 donation, uint256 victimDeposit) public {
        donation = bound(donation, 1, 1e24);
        victimDeposit = bound(victimDeposit, 1e12, 1e24);

        uint256 attackerShares = _deposit(alice, 1);
        token.mint(alice, donation);
        vm.prank(alice);
        token.transfer(address(pool), donation);
        uint256 attackerSpent = 1 + donation;

        token.mint(bob, victimDeposit);
        vm.startPrank(bob);
        token.approve(address(pool), victimDeposit);
        try pool.deposit(victimDeposit, bob) returns (uint256 victimShares) {
            vm.stopPrank();
            uint256 oneShareWorth = (pool.totalAssets() + 1) / (pool.totalSupply() + 1e6) + 1;
            assertGe(pool.previewRedeem(victimShares) + oneShareWorth, victimDeposit, "victim loses at most one share");
            assertLe(pool.previewRedeem(attackerShares), attackerSpent, "attack must not profit");
        } catch {
            vm.stopPrank();
            // zero-share deposits revert, which protects the victim outright
        }
    }

    // ------------------------------------------------------------------ R12

    function test_writeOffSocialisesLossAcrossLenders() public {
        uint256 aliceShares = _deposit(alice, 100e18);
        uint256 bobShares = _deposit(bob, 300e18);
        pool.borrow(200e18, borrower);

        vm.expectEmit(address(pool));
        emit ILendingPool.WriteOff(40e18);
        pool.writeOff(40e18);

        assertEq(pool.totalBorrows(), 160e18);
        assertEq(pool.totalAssets(), 360e18);
        assertApproxEqAbs(pool.previewRedeem(aliceShares), 90e18, 1);
        assertApproxEqAbs(pool.previewRedeem(bobShares), 270e18, 1);

        vm.expectRevert(abi.encodeWithSelector(LendingPool.WriteOffExceedsBorrows.selector, 160e18));
        pool.writeOff(160e18 + 1);
    }

    // ------------------------------------------------------------------ R13

    function test_rewardsSplitProRataSettleOnTransferAndPayOut() public {
        uint256 aliceShares = _deposit(alice, 100e18);
        _deposit(bob, 300e18);

        pool.notifyReward(40e18);
        assertEq(pool.claimable(alice), 10e18);
        assertEq(pool.claimable(bob), 30e18);
        assertEq(pool.totalRewardsOwed(), 40e18);

        vm.prank(alice);
        pool.transfer(carol, aliceShares);
        pool.notifyReward(40e18);
        assertEq(pool.claimable(alice), 10e18, "rewards earned before the transfer stay with alice");
        assertEq(pool.claimable(carol), 10e18);
        assertEq(pool.claimable(bob), 60e18);

        vm.prank(alice);
        uint256 paid = pool.claim(alice);
        assertEq(paid, 10e18);
        assertEq(cash.balanceOf(alice), 10e18);
        assertEq(pool.claimable(alice), 0);
        assertEq(pool.totalRewardsOwed(), 70e18);

        vm.prank(alice);
        assertEq(pool.claim(alice), 0, "nothing left to claim");
    }

    function test_rewardsSurviveSmallAmountsAndLargeSupply() public {
        _deposit(alice, 1e24);
        pool.notifyReward(1);
        assertEq(pool.claimable(alice), 1);
    }

    function test_notifyWithoutSharesReverts() public {
        vm.expectRevert(LendingPool.NoShares.selector);
        pool.notifyReward(1e18);
    }
}
