// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {MockStockToken} from "../src/mocks/MockStockToken.sol";
import {
    IScaledUIAmount,
    IScaledUIAmountNewUIMultiplier,
    IScaledUIAmountConversion,
    IScaledUIAmountBalances
} from "../src/interfaces/IERC8056.sol";

/// The mock must behave like the ERC-8056 token the protocol relies on. Requirements come from the standard and
/// Robinhood's Stock Token docs: raw balances never change on a corporate action, the multiplier scales them,
/// a pending multiplier is visible before it takes effect, transfers carry the UI amount. One detail comes from
/// the live NVDA token on mainnet (read 2026-10-02): `newUIMultiplier()` and `effectiveAt()` keep returning the
/// last scheduled values after they take effect, so "pending" means `effectiveAt()` is in the future.
contract MockStockTokenTest is Test {
    MockStockToken token;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address outsider = makeAddr("outsider");

    function setUp() public {
        token = new MockStockToken("NVIDIA Robinhood Token", "NVDA", address(this));
        token.mint(alice, 100e18);
    }

    function test_startsAtMultiplierOne() public view {
        assertEq(token.uiMultiplier(), 1e18);
        assertEq(token.balanceOfUI(alice), token.balanceOf(alice));
        assertEq(token.newUIMultiplier(), 0);
        assertEq(token.effectiveAt(), 0);
    }

    function test_immediateMultiplierScalesUIButNotRaw() public {
        token.scheduleMultiplier(2e18, block.timestamp);
        assertEq(token.uiMultiplier(), 2e18);
        assertEq(token.balanceOf(alice), 100e18, "raw balance must not move");
        assertEq(token.balanceOfUI(alice), 200e18);
        assertEq(token.totalSupplyUI(), 200e18);
        assertEq(token.toUIAmount(10e18), 20e18);
        assertEq(token.fromUIAmount(20e18), 10e18);
        assertEq(token.newUIMultiplier(), 2e18, "last scheduled value stays readable");
        assertEq(token.effectiveAt(), block.timestamp);
    }

    function test_pendingMultiplierIsVisibleThenApplies() public {
        uint256 at = block.timestamp + 1 days;
        vm.expectEmit(address(token));
        emit IScaledUIAmount.UIMultiplierUpdated(1e18, 3e18, at);
        token.scheduleMultiplier(3e18, at);

        assertEq(token.uiMultiplier(), 1e18, "not yet effective");
        assertEq(token.newUIMultiplier(), 3e18);
        assertEq(token.effectiveAt(), at);

        vm.warp(at);
        assertEq(token.uiMultiplier(), 3e18);
        assertEq(token.balanceOfUI(alice), 300e18);
        assertEq(token.balanceOf(alice), 100e18);
        assertEq(token.newUIMultiplier(), 3e18, "stays readable after taking effect, as on mainnet");
        assertEq(token.effectiveAt(), at);
    }

    function test_cancelPendingMultiplier() public {
        uint256 at = block.timestamp + 1 days;
        token.scheduleMultiplier(3e18, at);
        vm.expectEmit(address(token));
        emit IScaledUIAmount.UIMultiplierUpdateCancelled(3e18, at);
        token.cancelScheduledMultiplier();
        vm.warp(at);
        assertEq(token.uiMultiplier(), 1e18);
    }

    function test_transferEmitsUIAmount() public {
        token.scheduleMultiplier(1.5e18, block.timestamp);
        vm.expectEmit(address(token));
        emit IScaledUIAmount.TransferWithUIAmount(alice, bob, 10e18, 15e18);
        vm.prank(alice);
        token.transfer(bob, 10e18);
    }

    function test_interfaceIdsMatchTheStandard() public view {
        assertEq(type(IScaledUIAmount).interfaceId, bytes4(0xa60bf13d));
        assertEq(type(IScaledUIAmountNewUIMultiplier).interfaceId, bytes4(0x4bd27648));
        assertEq(type(IScaledUIAmountConversion).interfaceId, bytes4(0x57854fc3));
        assertEq(type(IScaledUIAmountBalances).interfaceId, bytes4(0xd890fd71));
        assertTrue(token.supportsInterface(0xa60bf13d));
        assertTrue(token.supportsInterface(0x4bd27648));
        assertTrue(token.supportsInterface(0x57854fc3));
        assertTrue(token.supportsInterface(0xd890fd71));
        assertFalse(token.supportsInterface(0xffffffff));
    }

    function test_faucetIsRateLimited() public {
        vm.startPrank(bob);
        token.faucet();
        assertEq(token.balanceOf(bob), 1_000e18);
        vm.expectRevert(abi.encodeWithSelector(MockStockToken.FaucetCooldown.selector, block.timestamp + 1 days));
        token.faucet();
        vm.warp(block.timestamp + 1 days);
        token.faucet();
        assertEq(token.balanceOf(bob), 2_000e18);
        vm.stopPrank();
    }

    function test_issuerPauseBlocksTransfers() public {
        token.pause();
        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        token.transfer(bob, 1e18);
        token.unpause();
        vm.prank(alice);
        token.transfer(bob, 1e18);
        assertEq(token.balanceOf(bob), 1e18);
    }

    function test_onlyOwnerSchedulesMultipliers() public {
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, outsider));
        token.scheduleMultiplier(2e18, block.timestamp);
    }
}
