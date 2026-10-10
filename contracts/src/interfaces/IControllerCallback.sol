// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Receivers of a deferred-check borrow or withdrawal. The Controller hands over the tokens or USDT,
///         calls back, and only then checks the account's initial ratio. Inside the callback the receiver may
///         deposit collateral or repay for the account; it may not borrow, withdraw, liquidate or absorb.
interface IControllerCallback {
    function onStockroomBorrow(address account, address token, uint256 rawAmount, bytes calldata data) external;
    function onStockroomWithdraw(address account, uint256 cashAmount, bytes calldata data) external;
}
