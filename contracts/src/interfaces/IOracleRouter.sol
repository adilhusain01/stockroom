// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Conservative USD prices per raw token plus the regime the market is in.
interface IOracleRouter {
    enum Regime {
        Open, // reference session running, feed fresh, feed and pool agree
        Closed, // reference session closed: the higher of feed, pool TWAP and last reference print, plus a gap premium
        Paused, // token paused or a multiplier change pending: no new borrows
        Degraded // feed stale, or feed and pool disagree beyond the band: no new borrows
    }

    struct Quote {
        uint256 priceWad; // USD per whole raw token, 1e18, already the conservative (higher) side
        Regime regime;
        uint256 updatedAt; // timestamp of the feed print the quote rests on
    }

    function quote(address token) external view returns (Quote memory);
    function cashPriceWad() external view returns (uint256);
    function borrowAllowed(address token) external view returns (bool);
}
