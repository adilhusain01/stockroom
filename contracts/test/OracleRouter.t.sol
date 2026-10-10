// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {OracleRouter} from "../src/OracleRouter.sol";
import {MarketCalendar} from "../src/MarketCalendar.sol";
import {IOracleRouter} from "../src/interfaces/IOracleRouter.sol";
import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";
import {IPancakeV3Pool} from "../src/interfaces/IPancakeV3.sol";
import {TwapMath} from "../src/libraries/TwapMath.sol";
import {MockFeed} from "../src/mocks/MockFeed.sol";
import {MockCash} from "../src/mocks/MockCash.sol";
import {MockPool} from "../src/mocks/MockPool.sol";
import {MockStockToken} from "../src/mocks/MockStockToken.sol";

/// Requirements (docs/spec.md, "Oracle regimes"), with facts read from BSC on 2026-10-10: APRO feeds answer with
/// 8 decimals per raw token on a 1h heartbeat around the clock, NVDAB is token0 of its USDT pool, and
/// `effectiveAt()` on NVDAB returns 0 when nothing is scheduled.
///  O1 prices are scaled from feed decimals to 1e18
///  O2 Open: session open, print within heartbeat plus grace, feed and TWAP within the band; the quote is the
///      higher of feed and TWAP; borrowing allowed
///  O3 Degraded: print older than heartbeat plus grace, or feed and TWAP apart by more than the band; borrowing
///      blocked, a price is still served
///  O4 Closed: session closed; the quote is the higher of feed, TWAP and a fresh anchor, times one plus the gap
///      premium, which grows 0.1 percent per hour closed and caps at 5 percent; borrowing allowed except in the
///      last 30 minutes before the next open
///  O5 Paused: token paused or a multiplier change pending; the anchor still applies, no gap premium
///  O6 cash is worth min(1, feed) and 1 when the feed is missing, stale or broken
///  O7 an unconfigured token or a non-positive answer reverts instead of pricing at zero; a broken pool observe
///      drops the TWAP instead of reverting
///  O8 TWAP math: 1.0001^tick agrees with the closed form within a basis point, inverted when the stock is token1
///  O9 only the owner configures; only the keeper or owner pushes anchors
contract OracleRouterTest is Test {
    uint256 constant WED_OPEN = 1791381600; // Wed 7 Oct 2026 10:00 ET
    uint256 constant SUN_CLOSED = 1791734400; // Sun 11 Oct 2026 12:00 ET, 40 hours after the Friday close
    uint256 constant MON_0330 = 1791790200; // inside the pre-open guard
    uint256 constant FRI_CLOSE = 1791590400;

    MarketCalendar cal;
    OracleRouter router;
    MockFeed feed;
    MockFeed cashFeed;
    MockPool pool;
    MockStockToken nvda;
    address usdt = makeAddr("usdt");
    address keeper = makeAddr("keeper");
    address outsider = makeAddr("outsider");

    function setUp() public {
        vm.warp(WED_OPEN);
        cal = new MarketCalendar(address(this));
        router = new OracleRouter(cal, address(this));
        router.setKeeper(keeper);
        nvda = new MockStockToken("NVIDIA bStock", "NVDAB", address(this));
        feed = new MockFeed(8, "NVDAB/USD", address(this));
        cashFeed = new MockFeed(8, "USDT/USD", address(this));
        feed.setAnswer(23002589067, block.timestamp); // 230.02589067, as on BSC on 2026-10-10
        router.setFeed(address(nvda), IAggregatorV3(address(feed)), 1 hours);
        pool = new MockPool(address(nvda), usdt);
        pool.setTick(54392); // about 230.1 USDT per NVDAB, the live 30-minute TWAP on 2026-10-10
        router.setPool(address(nvda), IPancakeV3Pool(address(pool)), 30 minutes, 0.03e18);
    }

    function _q() internal view returns (IOracleRouter.Quote memory) {
        return router.quote(address(nvda));
    }

    // ------------------------------------------------------------------ O1, O2, O8

    function test_openQuoteIsTheHigherOfFeedAndTwap() public {
        (bool ok, uint256 twap) = router.twapPrice(address(nvda));
        assertTrue(ok);
        assertApproxEqRel(twap, 230.195e18, 0.001e18, "TWAP from tick 54392");
        IOracleRouter.Quote memory q = _q();
        assertEq(uint256(q.regime), uint256(IOracleRouter.Regime.Open));
        assertEq(q.priceWad, twap, "TWAP is a touch above the feed, so it wins");
        assertEq(q.updatedAt, block.timestamp);
        assertTrue(router.borrowAllowed(address(nvda)));

        pool.setTick(54300); // TWAP below the feed now
        q = _q();
        assertEq(q.priceWad, 230.02589067e18, "feed scaled to WAD");
    }

    function test_twapMathMatchesTheClosedForm() public pure {
        // 1.0001^54392 = 230.19529518 (Python, double precision); 1.0001^-54392 is its inverse
        assertApproxEqRel(TwapMath.priceFromTick(54392), 230.19529518e18, 0.00001e18);
        assertApproxEqRel(TwapMath.priceFromTick(-54392), uint256(1e36) / uint256(230.19529518e18), 0.00001e18);
        assertEq(TwapMath.priceFromTick(0), 1e18);
        assertApproxEqRel(TwapMath.priceFromTick(887272), uint256(3.4025678683e38) * 1e18, 0.0001e18);
        assertEq(TwapMath.averageTick(100, 400, 3), 100);
        assertEq(TwapMath.averageTick(0, -7, 3), -3, "rounds toward negative infinity");
    }

    function test_twapInvertsWhenTheStockIsToken1() public {
        MockPool flipped = new MockPool(usdt, address(nvda));
        flipped.setTick(-54392);
        router.setPool(address(nvda), IPancakeV3Pool(address(flipped)), 30 minutes, 0.03e18);
        (, uint256 twap) = router.twapPrice(address(nvda));
        assertApproxEqRel(twap, 230.195e18, 0.001e18);
    }

    function test_noPoolMeansFeedOnly() public {
        router.setPool(address(nvda), IPancakeV3Pool(address(0)), 0, 0);
        (bool ok,) = router.twapPrice(address(nvda));
        assertFalse(ok);
        assertEq(_q().priceWad, 230.02589067e18);
        assertEq(uint256(_q().regime), uint256(IOracleRouter.Regime.Open));
    }

    // ------------------------------------------------------------------ O3

    function test_stalePrintDegrades() public {
        vm.warp(block.timestamp + 1 hours + 30 minutes);
        assertEq(uint256(_q().regime), uint256(IOracleRouter.Regime.Open), "exactly at heartbeat plus grace is still fresh");
        vm.warp(block.timestamp + 1);
        IOracleRouter.Quote memory q = _q();
        assertEq(uint256(q.regime), uint256(IOracleRouter.Regime.Degraded));
        assertGt(q.priceWad, 0, "a price is still served");
        assertFalse(router.borrowAllowed(address(nvda)));
    }

    function test_feedAndPoolDisagreementDegrades() public {
        pool.setTick(54392 + 400); // about 4 percent above the feed
        IOracleRouter.Quote memory q = _q();
        assertEq(uint256(q.regime), uint256(IOracleRouter.Regime.Degraded));
        assertApproxEqRel(q.priceWad, 239.5e18, 0.01e18, "the higher TWAP still prices the debt");
        assertFalse(router.borrowAllowed(address(nvda)));
        pool.setTick(54392 - 400);
        assertEq(uint256(_q().regime), uint256(IOracleRouter.Regime.Degraded), "either direction");
        assertEq(_q().priceWad, 230.02589067e18, "the feed is the higher side now");
    }

    function test_brokenPoolObserveDropsTheTwap() public {
        pool.setFailObserve(true);
        IOracleRouter.Quote memory q = _q();
        assertEq(uint256(q.regime), uint256(IOracleRouter.Regime.Open));
        assertEq(q.priceWad, 230.02589067e18);
    }

    // ------------------------------------------------------------------ O4

    function test_closedSessionAddsTheGapPremiumAndAnchor() public {
        vm.warp(SUN_CLOSED);
        feed.setAnswer(23002589067, block.timestamp); // APRO keeps printing on weekends
        uint256 premium = router.gapPremium(block.timestamp);
        assertEq(premium, 0.04e18, "40 hours closed times 0.1 percent");
        IOracleRouter.Quote memory q = _q();
        assertEq(uint256(q.regime), uint256(IOracleRouter.Regime.Closed));
        (, uint256 twap) = router.twapPrice(address(nvda));
        assertEq(q.priceWad, twap * 1.04e18 / 1e18);
        assertTrue(router.borrowAllowed(address(nvda)));

        // the Friday reference close was higher than the on-chain weekend price
        vm.prank(keeper);
        router.setAnchor(address(nvda), 240e18);
        q = _q();
        assertEq(q.priceWad, 240e18 * 1.04e18 / 1e18, "anchor wins, premium still applies");

        router.setGuards(30 minutes, 30 minutes, 1 hours); // anchors now expire after an hour
        vm.warp(SUN_CLOSED + 2 hours);
        feed.setAnswer(23002589067, block.timestamp);
        assertEq(_q().priceWad, twap * 1.042e18 / 1e18, "stale anchor ignored, 42 hours of premium");
        assertEq(router.gapPremium(SUN_CLOSED + 10 hours), 0.05e18, "capped at 5 percent");
    }

    function test_preOpenGuardBlocksBorrows() public {
        vm.warp(MON_0330);
        feed.setAnswer(23002589067, block.timestamp);
        assertEq(uint256(_q().regime), uint256(IOracleRouter.Regime.Closed));
        assertFalse(router.borrowAllowed(address(nvda)), "30 minutes before the open");
        vm.warp(MON_0330 - 1 hours);
        feed.setAnswer(23002589067, block.timestamp);
        assertTrue(router.borrowAllowed(address(nvda)));
    }

    function test_gapPremiumIsZeroWhileOpenAndGrowsFromTheClose() public view {
        assertEq(router.gapPremium(WED_OPEN), 0);
        assertEq(router.gapPremium(FRI_CLOSE + 1 hours), 0.001e18);
        assertEq(router.gapPremium(SUN_CLOSED + 10 hours), 0.05e18, "50 hours closed, capped");
    }

    function test_anchorDoesNotApplyWhileOpen() public {
        vm.prank(keeper);
        router.setAnchor(address(nvda), 300e18);
        assertEq(uint256(_q().regime), uint256(IOracleRouter.Regime.Open));
        assertLt(_q().priceWad, 231e18, "an open session prices from the chain, not the last print");
    }

    // ------------------------------------------------------------------ O5

    function test_pausedTokenAndPendingMultiplierPause() public {
        nvda.pause();
        assertEq(uint256(_q().regime), uint256(IOracleRouter.Regime.Paused));
        assertFalse(router.borrowAllowed(address(nvda)));
        nvda.unpause();
        assertEq(uint256(_q().regime), uint256(IOracleRouter.Regime.Open));

        nvda.scheduleMultiplier(1.002e18, block.timestamp + 1 days); // a dividend lands tomorrow
        assertTrue(router.multiplierPending(address(nvda)));
        assertEq(uint256(_q().regime), uint256(IOracleRouter.Regime.Paused));
        assertEq(_q().priceWad, _openPrice(), "no premium while paused");
        vm.warp(block.timestamp + 1 days);
        feed.setAnswer(23002589067, block.timestamp);
        assertFalse(router.multiplierPending(address(nvda)), "effective now");
        assertEq(uint256(_q().regime), uint256(IOracleRouter.Regime.Open));
    }

    function test_plainTokensNeverLookPending() public {
        MockCash plain = new MockCash(address(this));
        MockFeed plainFeed = new MockFeed(8, "X/USD", address(this));
        plainFeed.setAnswer(1e8, block.timestamp);
        router.setFeed(address(plain), IAggregatorV3(address(plainFeed)), 1 hours);
        assertFalse(router.multiplierPending(address(plain)));
        assertFalse(router.tokenPaused(address(plain)));
        assertEq(uint256(router.quote(address(plain)).regime), uint256(IOracleRouter.Regime.Open));
    }

    // ------------------------------------------------------------------ O6

    function test_cashPriceIsCappedAtOne() public {
        assertEq(router.cashPriceWad(), 1e18, "no feed");
        router.setCashFeed(IAggregatorV3(address(cashFeed)), 1 days);
        cashFeed.setAnswer(99913279, block.timestamp);
        assertEq(router.cashPriceWad(), 0.99913279e18);
        cashFeed.setAnswer(100200000, block.timestamp);
        assertEq(router.cashPriceWad(), 1e18, "never above one");
        cashFeed.setAnswer(99000000, block.timestamp - 2 days);
        assertEq(router.cashPriceWad(), 1e18, "stale falls back to one");
        cashFeed.setAnswer(0, block.timestamp);
        assertEq(router.cashPriceWad(), 1e18, "broken falls back to one");
    }

    // ------------------------------------------------------------------ O7, O9

    function test_unconfiguredOrBrokenFeedsRevert() public {
        vm.expectRevert(abi.encodeWithSelector(OracleRouter.FeedNotConfigured.selector, usdt));
        router.quote(usdt);
        feed.setAnswer(0, block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(OracleRouter.InvalidAnswer.selector, address(feed), 0));
        router.quote(address(nvda));
    }

    function test_accessControl() public {
        vm.startPrank(outsider);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, outsider));
        router.setFeed(usdt, IAggregatorV3(address(feed)), 1 hours);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, outsider));
        router.setPool(address(nvda), IPancakeV3Pool(address(pool)), 30 minutes, 0.03e18);
        vm.expectRevert(OracleRouter.NotKeeper.selector);
        router.setAnchor(address(nvda), 1e18);
        vm.stopPrank();
        router.setAnchor(address(nvda), 1e18); // the owner may push too
        MockPool wrongPool = new MockPool(usdt, keeper);
        vm.expectRevert(OracleRouter.InvalidPool.selector);
        router.setPool(address(nvda), IPancakeV3Pool(address(wrongPool)), 30 minutes, 0.03e18);
        vm.expectRevert(OracleRouter.InvalidParams.selector);
        router.setGapPremium(0.1e18, 0.05e18);
    }

    function _openPrice() internal view returns (uint256) {
        (, uint256 twap) = router.twapPrice(address(nvda));
        uint256 feedWad = 230.02589067e18;
        return twap > feedWad ? twap : feedWad;
    }
}
