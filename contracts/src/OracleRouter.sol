// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IOracleRouter} from "./interfaces/IOracleRouter.sol";
import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";
import {IPancakeV3Pool} from "./interfaces/IPancakeV3.sol";
import {IStockTokenFlags} from "./interfaces/IStockTokenFlags.sol";
import {IScaledUIAmountNewUIMultiplier} from "./interfaces/IERC8056.sol";
import {MarketCalendar} from "./MarketCalendar.sol";
import {TwapMath} from "./libraries/TwapMath.sol";

/// @title OracleRouter
/// @notice One conservative USD price per raw bStock token, built from three sources that fail in different ways:
///         the APRO on-chain feed (prices the token 24/7 from on-chain liquidity, 1h heartbeat), the PancakeSwap
///         v3 TWAP of the token's deepest pool, and the last reference print of the underlying stock pushed by a
///         keeper from the Binance RWA Data API (scaled to raw units with the BEP-677 multiplier).
///         While the reference session is open the quote is the higher of feed and TWAP. While it is closed the
///         last reference print joins the maximum and a gap premium grows with the hours since the close, so a
///         short carried over a weekend is margined for the Monday gap. A pending multiplier change (dividend,
///         split) or a paused token stops new borrows; a stale feed or a feed that disagrees with the pool does
///         the same. Repayment, withdrawal and liquidation never stop.
contract OracleRouter is IOracleRouter, Ownable2Step {
    uint256 public constant WAD = 1e18;

    struct FeedConfig {
        IAggregatorV3 feed;
        uint8 decimals;
        uint32 heartbeat; // seconds the feed promises between prints
        IPancakeV3Pool pool; // zero to skip the TWAP cross-check
        bool stockIsToken0;
        uint32 twapWindow; // seconds
        uint64 bandWad; // max |feed - twap| / twap before the regime degrades
        bool configured;
    }

    struct Anchor {
        uint192 priceWad; // USD per raw token from the reference market, multiplier included
        uint64 updatedAt;
    }

    MarketCalendar public calendar;
    IAggregatorV3 public cashFeed;
    address public keeper;
    uint256 public stalenessGrace = 30 minutes;
    uint256 public cashHeartbeat = 1 days;
    uint256 public preOpenGuard = 30 minutes;
    uint256 public anchorMaxAge = 3 days;
    uint256 public gapPremiumPerHourWad = 0.001e18; // 0.1 percent per hour closed
    uint256 public gapPremiumMaxWad = 0.05e18; // capped at 5 percent
    mapping(address token => FeedConfig) public feeds;
    mapping(address token => Anchor) public anchors;

    event FeedSet(address indexed token, address feed, uint8 decimals, uint32 heartbeat);
    event PoolSet(address indexed token, address pool, bool stockIsToken0, uint32 twapWindow, uint64 bandWad);
    event CashFeedSet(address feed, uint256 heartbeat);
    event KeeperSet(address keeper);
    event GuardsSet(uint256 stalenessGrace, uint256 preOpenGuard, uint256 anchorMaxAge);
    event GapPremiumSet(uint256 perHourWad, uint256 maxWad);
    event AnchorSet(address indexed token, uint256 priceWad, uint256 updatedAt);

    error FeedNotConfigured(address token);
    error InvalidAnswer(address feed, int256 answer);
    error InvalidDecimals();
    error InvalidPool();
    error InvalidParams();
    error NotKeeper();

    modifier onlyKeeper() {
        if (msg.sender != keeper && msg.sender != owner()) revert NotKeeper();
        _;
    }

    constructor(MarketCalendar calendar_, address owner_) Ownable(owner_) {
        calendar = calendar_;
        keeper = owner_;
    }

    // ------------------------------------------------------------------ admin

    function setFeed(address token, IAggregatorV3 feed, uint32 heartbeat) external onlyOwner {
        uint8 decimals = feed.decimals();
        if (decimals > 18) revert InvalidDecimals();
        FeedConfig storage c = feeds[token];
        c.feed = feed;
        c.decimals = decimals;
        c.heartbeat = heartbeat;
        c.configured = true;
        emit FeedSet(token, address(feed), decimals, heartbeat);
    }

    /// @notice Attach the pool whose TWAP cross-checks the feed. Pass the zero address to drop the check.
    function setPool(address token, IPancakeV3Pool pool, uint32 twapWindow, uint64 bandWad) external onlyOwner {
        FeedConfig storage c = feeds[token];
        if (!c.configured) revert FeedNotConfigured(token);
        if (address(pool) != address(0)) {
            bool isToken0 = pool.token0() == token;
            if (!isToken0 && pool.token1() != token) revert InvalidPool();
            if (twapWindow == 0 || bandWad == 0 || bandWad >= WAD) revert InvalidParams();
            c.stockIsToken0 = isToken0;
        }
        c.pool = pool;
        c.twapWindow = twapWindow;
        c.bandWad = bandWad;
        emit PoolSet(token, address(pool), c.stockIsToken0, twapWindow, bandWad);
    }

    function setCashFeed(IAggregatorV3 feed, uint256 heartbeat) external onlyOwner {
        cashFeed = feed;
        cashHeartbeat = heartbeat;
        emit CashFeedSet(address(feed), heartbeat);
    }

    function setKeeper(address keeper_) external onlyOwner {
        keeper = keeper_;
        emit KeeperSet(keeper_);
    }

    function setGuards(uint256 stalenessGrace_, uint256 preOpenGuard_, uint256 anchorMaxAge_) external onlyOwner {
        stalenessGrace = stalenessGrace_;
        preOpenGuard = preOpenGuard_;
        anchorMaxAge = anchorMaxAge_;
        emit GuardsSet(stalenessGrace_, preOpenGuard_, anchorMaxAge_);
    }

    function setGapPremium(uint256 perHourWad, uint256 maxWad) external onlyOwner {
        if (maxWad >= WAD || perHourWad > maxWad) revert InvalidParams();
        gapPremiumPerHourWad = perHourWad;
        gapPremiumMaxWad = maxWad;
        emit GapPremiumSet(perHourWad, maxWad);
    }

    // ------------------------------------------------------------------ keeper

    /// @notice Record the latest reference print for `token`, in USD per raw token (the keeper multiplies the
    ///         underlying price by the token's current multiplier before pushing).
    function setAnchor(address token, uint256 priceWad) external onlyKeeper {
        if (!feeds[token].configured) revert FeedNotConfigured(token);
        if (priceWad == 0 || priceWad > type(uint192).max) revert InvalidParams();
        anchors[token] = Anchor({priceWad: uint192(priceWad), updatedAt: uint64(block.timestamp)});
        emit AnchorSet(token, priceWad, block.timestamp);
    }

    // ------------------------------------------------------------------ views

    /// @inheritdoc IOracleRouter
    function quote(address token) public view returns (Quote memory q) {
        FeedConfig memory c = feeds[token];
        if (!c.configured) revert FeedNotConfigured(token);
        (uint256 fp, uint256 updatedAt) = _feedPrice(c);
        q.updatedAt = updatedAt;

        (bool twapOk, uint256 twap) = _twap(c);
        uint256 price = fp;
        if (twapOk && twap > price) price = twap;

        if (tokenPaused(token) || multiplierPending(token)) {
            q.regime = Regime.Paused;
        } else if (block.timestamp > updatedAt + c.heartbeat + stalenessGrace) {
            q.regime = Regime.Degraded;
        } else if (twapOk && _deviation(fp, twap) > c.bandWad) {
            q.regime = Regime.Degraded;
        } else if (calendar.isOpen(block.timestamp)) {
            q.regime = Regime.Open;
        } else {
            q.regime = Regime.Closed;
        }

        if (q.regime != Regime.Open) {
            Anchor memory a = anchors[token];
            if (a.updatedAt != 0 && block.timestamp <= a.updatedAt + anchorMaxAge && a.priceWad > price) {
                price = a.priceWad;
            }
            if (q.regime == Regime.Closed) {
                price = Math.mulDiv(price, WAD + gapPremium(block.timestamp), WAD);
            }
        }
        q.priceWad = price;
    }

    /// @inheritdoc IOracleRouter
    function borrowAllowed(address token) external view returns (bool) {
        Quote memory q = quote(token);
        if (q.regime == Regime.Paused || q.regime == Regime.Degraded) return false;
        if (q.regime == Regime.Closed && calendar.nextOpen(block.timestamp) - block.timestamp <= preOpenGuard) {
            return false;
        }
        return true;
    }

    /// @inheritdoc IOracleRouter
    function cashPriceWad() external view returns (uint256) {
        if (address(cashFeed) == address(0)) return WAD;
        (, int256 answer,, uint256 updatedAt,) = cashFeed.latestRoundData();
        if (answer <= 0 || block.timestamp > updatedAt + cashHeartbeat + stalenessGrace) return WAD;
        uint256 price = uint256(answer) * (10 ** (18 - cashFeed.decimals()));
        return price < WAD ? price : WAD;
    }

    /// @notice Premium added to closed-session prices: grows with the hours since the close, capped.
    function gapPremium(uint256 timestamp) public view returns (uint256) {
        uint256 closed = calendar.closedFor(timestamp);
        if (closed == 0) return 0;
        uint256 premium = gapPremiumPerHourWad * closed / 1 hours;
        return premium > gapPremiumMaxWad ? gapPremiumMaxWad : premium;
    }

    /// @notice The feed's raw print, scaled to WAD, with its timestamp.
    function feedPrice(address token) external view returns (uint256 priceWad, uint256 updatedAt) {
        FeedConfig memory c = feeds[token];
        if (!c.configured) revert FeedNotConfigured(token);
        return _feedPrice(c);
    }

    /// @notice The pool TWAP in USD per raw token, and whether a pool is configured.
    function twapPrice(address token) external view returns (bool ok, uint256 priceWad) {
        return _twap(feeds[token]);
    }

    function tokenPaused(address token) public view returns (bool) {
        try IStockTokenFlags(token).oraclePaused() returns (bool paused) {
            if (paused) return true;
        } catch {}
        try IStockTokenFlags(token).paused() returns (bool paused) {
            return paused;
        } catch {}
        return false;
    }

    /// @notice True while a BEP-677 multiplier change is scheduled and not yet effective.
    function multiplierPending(address token) public view returns (bool) {
        try IScaledUIAmountNewUIMultiplier(token).effectiveAt() returns (uint256 at) {
            return at > block.timestamp;
        } catch {
            return false;
        }
    }

    // ------------------------------------------------------------------ internals

    function _feedPrice(FeedConfig memory c) internal view returns (uint256 priceWad, uint256 updatedAt) {
        int256 answer;
        (, answer,, updatedAt,) = c.feed.latestRoundData();
        if (answer <= 0) revert InvalidAnswer(address(c.feed), answer);
        priceWad = uint256(answer) * (10 ** (18 - c.decimals));
    }

    function _twap(FeedConfig memory c) internal view returns (bool ok, uint256 priceWad) {
        if (address(c.pool) == address(0)) return (false, 0);
        uint32[] memory ago = new uint32[](2);
        ago[0] = c.twapWindow;
        ago[1] = 0;
        try c.pool.observe(ago) returns (int56[] memory cumulatives, uint160[] memory) {
            int24 tick = TwapMath.averageTick(cumulatives[0], cumulatives[1], c.twapWindow);
            uint256 p = TwapMath.priceFromTick(tick); // token1 per token0
            priceWad = c.stockIsToken0 ? p : Math.mulDiv(WAD, WAD, p);
            ok = priceWad != 0;
        } catch {
            return (false, 0);
        }
    }

    function _deviation(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 diff = a > b ? a - b : b - a;
        return Math.mulDiv(diff, WAD, b);
    }
}
