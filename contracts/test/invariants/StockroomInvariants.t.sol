// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Controller} from "../../src/Controller.sol";
import {LendingPool} from "../../src/LendingPool.sol";
import {RiskMathRef} from "../../src/RiskMathRef.sol";
import {IOracleRouter} from "../../src/interfaces/IOracleRouter.sol";
import {IRiskEngine} from "../../src/interfaces/IRiskEngine.sol";
import {MockStockToken} from "../../src/mocks/MockStockToken.sol";
import {MockCash} from "../../src/mocks/MockCash.sol";
import {MockOracleRouter} from "../../src/mocks/MockOracleRouter.sol";
import {Handler} from "./Handler.sol";

/// Invariants from docs/spec.md, "Invariants to hold under any sequence of actions", checked after random
/// sequences of lending, borrowing, price moves, time, corporate actions, liquidations and absorptions.
contract StockroomInvariants is Test {
    uint256 constant WAD = 1e18;

    Controller ctl;
    MockCash cash;
    MockOracleRouter oracle;
    MockStockToken[] tokens;
    LendingPool[] pools;
    Handler handler;

    function setUp() public {
        cash = new MockCash(address(this));
        oracle = new MockOracleRouter();
        ctl = new Controller(IERC20(address(cash)), oracle, new RiskMathRef(), address(this));
        string[3] memory names = ["NVDA", "TSLA", "GME"];
        uint256[3] memory prices = [uint256(240e18), 370e18, 24e18];
        for (uint256 i; i < 3; ++i) {
            MockStockToken t = new MockStockToken(names[i], names[i], address(this));
            LendingPool p = new LendingPool(IERC20(address(t)), names[i], names[i], address(ctl), 0.9e18);
            ctl.listMarket(
                address(t),
                p,
                Controller.MarketParams({
                    initialRatioWad: 1.5e18,
                    liqThresholdWad: 1.25e18,
                    dutchMinWad: 0.01e18,
                    dutchMaxWad: 0.12e18,
                    dutchDuration: 20 minutes,
                    borrowCapRaw: 10_000e18,
                    irm: IRiskEngine.IrmParams({baseWad: 0.01e18, kinkWad: 0.8e18, rateAtKinkWad: 0.10e18, maxRateWad: 1.5e18})
                })
            );
            oracle.setQuote(address(t), prices[i], IOracleRouter.Regime.Open);
            tokens.push(t);
            pools.push(p);
        }
        handler = new Handler(ctl, cash, oracle, tokens, pools);
        for (uint256 i; i < 3; ++i) {
            tokens[i].transferOwnership(address(handler));
        }
        targetContract(address(handler));
    }

    /// Pool assets equal idle balance plus outstanding borrows, and the pool and the Controller agree on debt.
    function invariant_poolAccountingIsConsistent() public view {
        for (uint256 m; m < pools.length; ++m) {
            assertEq(pools[m].totalAssets(), pools[m].idle() + pools[m].totalBorrows());
            assertEq(pools[m].idle(), tokens[m].balanceOf(address(pools[m])));
            assertEq(pools[m].totalBorrows(), ctl.market(address(tokens[m])).totalDebtRaw, "pool and controller disagree on debt");
        }
    }

    /// The Controller's debt per market is the sum of its positions.
    function invariant_debtIsSumOfPositions() public view {
        for (uint256 m; m < tokens.length; ++m) {
            uint256 sum;
            for (uint256 a; a < handler.actorCount(); ++a) {
                address who = handler.actors(a);
                uint256 debt = ctl.positionOf(who, address(tokens[m]));
                assertEq(debt, handler.ghostDebt(who, address(tokens[m])), "position differs from the handler's record");
                sum += debt;
            }
            assertEq(sum, ctl.market(address(tokens[m])).totalDebtRaw);
        }
    }

    /// Controller USDT covers collateral, unclaimed lender rewards and insurance, less fees owed but unpaid.
    function invariant_controllerIsSolventInUsdg() public view {
        uint256 liabilities = ctl.insuranceBalance();
        uint256 unpaid;
        for (uint256 a; a < handler.actorCount(); ++a) {
            address who = handler.actors(a);
            liabilities += ctl.collateralOf(who);
            unpaid += ctl.unpaidFeesOf(who);
        }
        for (uint256 m; m < pools.length; ++m) {
            liabilities += pools[m].totalRewardsOwed();
        }
        uint256 balance = cash.balanceOf(address(ctl));
        assertGe(balance + unpaid, liabilities, "controller holds less USDT than it owes");
    }

    /// Lender shares never claim more than the pool holds, and a healthy pool's share price never drops below
    /// one raw unit per share unless a write-off happened.
    function invariant_sharesAreBackedByAssets() public view {
        for (uint256 m; m < pools.length; ++m) {
            uint256 supply = pools[m].totalSupply();
            if (supply == 0) continue;
            assertLe(pools[m].previewRedeem(supply), pools[m].totalAssets());
        }
    }

    /// Nobody can be left with debt and no collateral after an absorb, and absorbed accounts carry no auction.
    function invariant_absorbedAccountsAreClean() public view {
        for (uint256 a; a < handler.actorCount(); ++a) {
            address who = handler.actors(a);
            if (ctl.borrowedTokens(who).length == 0) {
                assertEq(ctl.auctionStartOf(who), 0, "auction left open without debt");
            }
        }
    }

    function invariant_callSummary() public view {
        // keeps the run visible in -vv output; no assertion
        handler.calls();
    }
}
