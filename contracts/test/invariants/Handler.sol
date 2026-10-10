// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Controller} from "../../src/Controller.sol";
import {LendingPool} from "../../src/LendingPool.sol";
import {IOracleRouter} from "../../src/interfaces/IOracleRouter.sol";
import {MockStockToken} from "../../src/mocks/MockStockToken.sol";
import {MockCash} from "../../src/mocks/MockCash.sol";
import {MockOracleRouter} from "../../src/mocks/MockOracleRouter.sol";

/// Random but bounded actions against the full stack. Reverts are expected and allowed; the invariants are
/// checked between calls. Ghost variables track what the handler believes the state should be.
contract Handler is Test {
    uint256 constant WAD = 1e18;

    Controller public ctl;
    MockCash public cash;
    MockOracleRouter public oracle;
    MockStockToken[] public tokens;
    LendingPool[] public pools;
    address[] public actors;

    // ghosts
    mapping(address => mapping(address => uint256)) public ghostDebt; // actor => token => raw
    uint256 public ghostFeesCredited; // USDT notified to pools + insurance, as seen by FeesAccrued
    uint256 public calls;
    uint256 public borrows;
    uint256 public liquidations;
    uint256 public absorbs;

    constructor(Controller ctl_, MockCash cash_, MockOracleRouter oracle_, MockStockToken[] memory tokens_, LendingPool[] memory pools_) {
        ctl = ctl_;
        cash = cash_;
        oracle = oracle_;
        tokens = tokens_;
        pools = pools_;
        for (uint256 i; i < 4; ++i) {
            actors.push(makeAddr(string.concat("actor", vm.toString(i))));
        }
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function tokenCount() external view returns (uint256) {
        return tokens.length;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _market(uint256 seed) internal view returns (uint256) {
        return seed % tokens.length;
    }

    // ------------------------------------------------------------------ lenders

    function lend(uint256 actorSeed, uint256 marketSeed, uint256 amount) external {
        calls++;
        address who = _actor(actorSeed);
        uint256 m = _market(marketSeed);
        amount = bound(amount, 1e15, 1_000e18);
        tokens[m].mint(who, amount);
        vm.startPrank(who);
        tokens[m].approve(address(pools[m]), amount);
        try pools[m].deposit(amount, who) {} catch {}
        vm.stopPrank();
    }

    function unlend(uint256 actorSeed, uint256 marketSeed, uint256 amount) external {
        calls++;
        address who = _actor(actorSeed);
        uint256 m = _market(marketSeed);
        uint256 max = pools[m].maxWithdraw(who);
        if (max == 0) return;
        amount = bound(amount, 1, max);
        vm.prank(who);
        try pools[m].withdraw(amount, who, who) {} catch {}
    }

    function claim(uint256 actorSeed, uint256 marketSeed) external {
        calls++;
        address who = _actor(actorSeed);
        uint256 m = _market(marketSeed);
        vm.prank(who);
        try pools[m].claim(who) {} catch {}
    }

    // ------------------------------------------------------------------ borrowers

    function depositCollateral(uint256 actorSeed, uint256 amount) external {
        calls++;
        address who = _actor(actorSeed);
        amount = bound(amount, 1e18, 100_000e18);
        cash.mint(who, amount);
        vm.startPrank(who);
        cash.approve(address(ctl), amount);
        try ctl.depositCollateral(amount, who) {} catch {}
        vm.stopPrank();
    }

    function withdrawCollateral(uint256 actorSeed, uint256 amount) external {
        calls++;
        address who = _actor(actorSeed);
        uint256 have = ctl.collateralOf(who);
        if (have == 0) return;
        amount = bound(amount, 1, have);
        vm.prank(who);
        try ctl.withdrawCollateral(amount, who) {
            // a withdrawal that went through must leave the account at or above health 1
            assertGe(ctl.healthFactor(who), WAD, "withdrawal left the account unhealthy");
        } catch {}
    }

    function borrow(uint256 actorSeed, uint256 marketSeed, uint256 amount) external {
        calls++;
        address who = _actor(actorSeed);
        uint256 m = _market(marketSeed);
        amount = bound(amount, 1e15, 50e18);
        vm.prank(who);
        try ctl.borrow(address(tokens[m]), amount, who) {
            borrows++;
            ghostDebt[who][address(tokens[m])] += amount;
            assertGe(ctl.healthFactor(who), WAD, "borrow left the account unhealthy");
            assertLe(pools[m].utilisation(), pools[m].maxUtilisation(), "borrow pushed utilisation past the cap");
        } catch {}
    }

    function repay(uint256 actorSeed, uint256 marketSeed, uint256 amount) external {
        calls++;
        address who = _actor(actorSeed);
        uint256 m = _market(marketSeed);
        uint256 debt = ctl.positionOf(who, address(tokens[m]));
        if (debt == 0) return;
        amount = bound(amount, 1, debt);
        tokens[m].mint(who, amount);
        vm.startPrank(who);
        tokens[m].approve(address(ctl), amount);
        try ctl.repay(address(tokens[m]), amount, who) returns (uint256 repaid) {
            ghostDebt[who][address(tokens[m])] -= repaid;
        } catch {}
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ world

    function movePrice(uint256 marketSeed, uint256 bps) external {
        calls++;
        uint256 m = _market(marketSeed);
        bps = bound(bps, 5_000, 20_000); // 0.5x to 2x
        uint256 price = oracle.quote(address(tokens[m])).priceWad * bps / 10_000;
        if (price < 1e16) price = 1e16;
        oracle.setQuote(address(tokens[m]), price, IOracleRouter.Regime.Open);
    }

    function warp(uint256 secs) external {
        calls++;
        vm.warp(block.timestamp + bound(secs, 1, 30 days));
    }

    function accrue(uint256 marketSeed) external {
        calls++;
        uint256 m = _market(marketSeed);
        uint256 before = pools[m].totalRewardsOwed() + ctl.insuranceBalance();
        ctl.accrue(address(tokens[m]));
        ghostFeesCredited += pools[m].totalRewardsOwed() + ctl.insuranceBalance() - before;
    }

    function corporateAction(uint256 marketSeed, uint256 multiplierBps) external {
        calls++;
        uint256 m = _market(marketSeed);
        multiplierBps = bound(multiplierBps, 5_000, 40_000);
        uint256 pa = pools[m].totalAssets();
        uint256 pb = pools[m].totalBorrows();
        uint256 debt = ctl.market(address(tokens[m])).totalDebtRaw;
        tokens[m].scheduleMultiplier(tokens[m].uiMultiplier() * multiplierBps / 10_000, block.timestamp);
        assertEq(pools[m].totalAssets(), pa, "multiplier changed pool assets");
        assertEq(pools[m].totalBorrows(), pb, "multiplier changed pool borrows");
        assertEq(ctl.market(address(tokens[m])).totalDebtRaw, debt, "multiplier changed debt");
    }

    // ------------------------------------------------------------------ liquidators

    function liquidate(uint256 actorSeed, uint256 victimSeed, uint256 marketSeed, uint256 amount) external {
        calls++;
        address keeper = _actor(actorSeed);
        address victim = _actor(victimSeed);
        uint256 m = _market(marketSeed);
        uint256 debt = ctl.positionOf(victim, address(tokens[m]));
        if (debt == 0 || ctl.healthFactor(victim) >= WAD) return;
        amount = bound(amount, 1, debt);
        tokens[m].mint(keeper, amount);
        uint256 coverageBefore = cash.balanceOf(address(ctl));
        vm.startPrank(keeper);
        tokens[m].approve(address(ctl), amount);
        try ctl.liquidate(victim, address(tokens[m]), amount, 0) returns (uint256 repaidRaw, uint256 cashOut) {
            liquidations++;
            ghostDebt[victim][address(tokens[m])] -= repaidRaw;
            assertEq(cash.balanceOf(address(ctl)), coverageBefore - cashOut, "liquidation moved more USDT than it paid out");
        } catch {}
        vm.stopPrank();
    }

    function absorb(uint256 victimSeed) external {
        calls++;
        address victim = _actor(victimSeed);
        if (ctl.collateralOf(victim) != 0) return;
        try ctl.absorb(victim) {
            absorbs++;
            for (uint256 m; m < tokens.length; ++m) {
                ghostDebt[victim][address(tokens[m])] = 0;
            }
        } catch {}
    }
}
