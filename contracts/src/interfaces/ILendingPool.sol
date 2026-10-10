// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IERC3156FlashLender} from "@openzeppelin/contracts/interfaces/IERC3156FlashLender.sol";

/// @notice One pool per stock token. Lenders hold ERC-4626 shares over raw units; the Controller borrows
///         raw units against USDT collateral and pushes USDT fees back as lender rewards.
interface ILendingPool is IERC4626, IERC3156FlashLender {
    event Borrow(address indexed to, uint256 rawAmount);
    event Repay(address indexed from, uint256 rawAmount);
    event WriteOff(uint256 rawAmount);
    event FlashLoan(address indexed receiver, uint256 rawAmount, uint256 fee);
    event RewardNotified(uint256 cashAmount, uint256 rewardPerShare);
    event RewardClaimed(address indexed account, address indexed to, uint256 cashAmount);

    function controller() external view returns (address);
    function maxUtilisation() external view returns (uint256);
    function totalBorrows() external view returns (uint256);
    function idle() external view returns (uint256);
    function utilisation() external view returns (uint256);
    function uiMultiplier() external view returns (uint256);
    function balanceOfUI(address account) external view returns (uint256);
    function totalSupplyUI() external view returns (uint256);
    function claimable(address account) external view returns (uint256);
    function totalRewardsOwed() external view returns (uint256);

    function borrow(uint256 rawAmount, address to) external;
    function repay(uint256 rawAmount, address from) external;
    function writeOff(uint256 rawAmount) external;
    function notifyReward(uint256 cashAmount) external;
    function claim(address to) external returns (uint256);
}
