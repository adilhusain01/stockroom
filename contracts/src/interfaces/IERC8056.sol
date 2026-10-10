// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice ERC-8056 Scaled UI Amount Extension, the standard bStocks implement.
///         Raw ERC-20 amounts never change on a corporate action; `uiMultiplier` (1e18 = 1.0) scales them to shares.
interface IScaledUIAmount {
    event UIMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier, uint256 effectiveAtTimestamp);
    event TransferWithUIAmount(address indexed from, address indexed to, uint256 amount, uint256 uiAmount);
    event UIMultiplierUpdateCancelled(uint256 cancelledMultiplier, uint256 cancelledEffectiveAt);

    function uiMultiplier() external view returns (uint256);
}

interface IScaledUIAmountNewUIMultiplier {
    function newUIMultiplier() external view returns (uint256);
    function effectiveAt() external view returns (uint256);
}

interface IScaledUIAmountConversion {
    function toUIAmount(uint256 rawAmount) external view returns (uint256);
    function fromUIAmount(uint256 uiAmount) external view returns (uint256);
}

interface IScaledUIAmountBalances {
    function balanceOfUI(address account) external view returns (uint256);
    function totalSupplyUI() external view returns (uint256);
}
