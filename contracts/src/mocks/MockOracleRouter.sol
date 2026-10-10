// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IOracleRouter} from "../interfaces/IOracleRouter.sol";

/// @notice Settable oracle for Controller tests. The real router is tested on its own.
contract MockOracleRouter is IOracleRouter {
    mapping(address token => Quote) internal quotes;
    mapping(address token => bool) internal blocked;
    uint256 public cashPriceWad = 1e18;

    function setQuote(address token, uint256 priceWad, Regime regime) external {
        quotes[token] = Quote({priceWad: priceWad, regime: regime, updatedAt: block.timestamp});
    }

    function setBorrowBlocked(address token, bool isBlocked) external {
        blocked[token] = isBlocked;
    }

    function setCashPrice(uint256 priceWad) external {
        cashPriceWad = priceWad;
    }

    function quote(address token) external view returns (Quote memory) {
        return quotes[token];
    }

    function borrowAllowed(address token) external view returns (bool) {
        Regime r = quotes[token].regime;
        return !blocked[token] && (r == Regime.Open || r == Regime.Closed);
    }
}
