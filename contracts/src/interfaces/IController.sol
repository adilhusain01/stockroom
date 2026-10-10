// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice The part of the Controller a LendingPool relies on. The Controller holds all USDT, so lender
///         rewards are paid out through it.
interface IController {
    function payLenderReward(address to, uint256 cashAmount) external;
}
