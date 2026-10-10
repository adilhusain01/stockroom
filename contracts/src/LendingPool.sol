// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC3156FlashBorrower} from "@openzeppelin/contracts/interfaces/IERC3156FlashBorrower.sol";
import {IERC3156FlashLender} from "@openzeppelin/contracts/interfaces/IERC3156FlashLender.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IController} from "./interfaces/IController.sol";
import {ILendingPool} from "./interfaces/ILendingPool.sol";
import {IScaledUIAmount} from "./interfaces/IERC8056.sol";

/// @title LendingPool
/// @notice One ERC-4626 pool per stock token. Lenders deposit raw units and hold shares over them. The
///         Controller borrows raw units against USDT collateral and streams USDT fees back as lender rewards.
///         All accounting is in raw units: an ERC-8056 multiplier change never touches a claim or a debt, so
///         splits and dividends flow to lenders by construction.
/// @dev    Debt does not grow in token units. Fees are charged in USDT by the Controller, which is why the
///         share price only moves on flash-loan fees (up) and write-offs (down).
contract LendingPool is ERC4626, ReentrancyGuard, ILendingPool {
    using SafeERC20 for IERC20;
    using Math for uint256;

    uint256 public constant WAD = 1e18;
    uint256 public constant FLASH_FEE_BPS = 5;
    uint256 public constant REWARD_PRECISION = 1e36;
    bytes32 private constant CALLBACK_SUCCESS = keccak256("ERC3156FlashBorrower.onFlashLoan");

    /// @notice The only address allowed to borrow, repay, write off and notify rewards.
    address public immutable override controller;
    /// @notice Utilisation (WAD) that borrows may not exceed, so lenders always keep an exit buffer.
    uint256 public immutable override maxUtilisation;

    /// @notice Raw units currently lent out.
    uint256 public override totalBorrows;
    /// @notice Accumulated USDT rewards per share, scaled by REWARD_PRECISION.
    uint256 public rewardPerShareStored;
    /// @notice USDT notified and not yet claimed.
    uint256 public override totalRewardsOwed;
    mapping(address account => uint256) public userRewardPerSharePaid;
    mapping(address account => uint256) public rewards;

    error NotController();
    error ZeroAmount();
    error ZeroShares();
    error InsufficientLiquidity(uint256 idle);
    error UtilisationCapExceeded(uint256 utilisationAfter, uint256 cap);
    error RepayExceedsBorrows(uint256 totalBorrows);
    error WriteOffExceedsBorrows(uint256 totalBorrows);
    error NoShares();
    error UnsupportedToken(address token);
    error FlashCallbackFailed();
    error InvalidMaxUtilisation();

    modifier onlyController() {
        if (msg.sender != controller) revert NotController();
        _;
    }

    constructor(IERC20 asset_, string memory name_, string memory symbol_, address controller_, uint256 maxUtilisation_)
        ERC4626(asset_)
        ERC20(name_, symbol_)
    {
        if (controller_ == address(0)) revert NotController();
        if (maxUtilisation_ == 0 || maxUtilisation_ > WAD) revert InvalidMaxUtilisation();
        controller = controller_;
        maxUtilisation = maxUtilisation_;
    }

    // ------------------------------------------------------------------ views

    /// @notice Raw units sitting in the pool, available to withdraw, borrow or flash loan.
    function idle() public view returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    /// @inheritdoc ERC4626
    function totalAssets() public view override(ERC4626, IERC4626) returns (uint256) {
        return idle() + totalBorrows;
    }

    /// @notice Borrowed share of all assets, in WAD.
    function utilisation() public view returns (uint256) {
        uint256 total = totalAssets();
        return total == 0 ? 0 : totalBorrows.mulDiv(WAD, total);
    }

    /// @notice The underlying token's ERC-8056 multiplier, or 1.0 for tokens without one.
    function uiMultiplier() public view returns (uint256) {
        (bool ok, bytes memory data) = asset().staticcall(abi.encodeCall(IScaledUIAmount.uiMultiplier, ()));
        if (ok && data.length >= 32) {
            uint256 multiplier = abi.decode(data, (uint256));
            if (multiplier != 0) return multiplier;
        }
        return WAD;
    }

    /// @notice A lender's claim expressed in effective shares of the underlying stock.
    function balanceOfUI(address account) external view returns (uint256) {
        return convertToAssets(balanceOf(account)).mulDiv(uiMultiplier(), WAD);
    }

    /// @notice All pool assets expressed in effective shares of the underlying stock.
    function totalSupplyUI() external view returns (uint256) {
        return totalAssets().mulDiv(uiMultiplier(), WAD);
    }

    /// @notice USDT the account can claim right now.
    function claimable(address account) public view returns (uint256) {
        return rewards[account]
            + balanceOf(account).mulDiv(rewardPerShareStored - userRewardPerSharePaid[account], REWARD_PRECISION);
    }

    // ------------------------------------------------------------------ ERC-4626 limits

    /// @inheritdoc ERC4626
    function maxWithdraw(address owner) public view override(ERC4626, IERC4626) returns (uint256) {
        return Math.min(super.maxWithdraw(owner), idle());
    }

    /// @inheritdoc ERC4626
    function maxRedeem(address owner) public view override(ERC4626, IERC4626) returns (uint256) {
        return Math.min(super.maxRedeem(owner), _convertToShares(idle(), Math.Rounding.Floor));
    }

    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        if (shares == 0) revert ZeroShares();
        super._deposit(caller, receiver, assets, shares);
    }

    // ------------------------------------------------------------------ controller actions

    /// @notice Lend raw units to `to`. Reverts past idle liquidity or the utilisation cap.
    /// @dev Controller-only and checks-effects-interactions, so it carries no reentrancy guard: a flash
    ///      liquidation repays through `repay` from inside `flashLoan`, which does hold the guard.
    function borrow(uint256 rawAmount, address to) external onlyController {
        if (rawAmount == 0) revert ZeroAmount();
        uint256 idleNow = idle();
        if (rawAmount > idleNow) revert InsufficientLiquidity(idleNow);
        uint256 borrowsAfter = totalBorrows + rawAmount;
        uint256 utilisationAfter = borrowsAfter.mulDiv(WAD, idleNow + totalBorrows, Math.Rounding.Ceil);
        if (utilisationAfter > maxUtilisation) revert UtilisationCapExceeded(utilisationAfter, maxUtilisation);
        totalBorrows = borrowsAfter;
        IERC20(asset()).safeTransfer(to, rawAmount);
        emit Borrow(to, rawAmount);
    }

    /// @notice Pull raw units back from `from` (which must have approved this pool) and reduce borrows.
    /// @dev No reentrancy guard for the same reason as `borrow`.
    function repay(uint256 rawAmount, address from) external onlyController {
        if (rawAmount == 0) revert ZeroAmount();
        if (rawAmount > totalBorrows) revert RepayExceedsBorrows(totalBorrows);
        totalBorrows -= rawAmount;
        IERC20(asset()).safeTransferFrom(from, address(this), rawAmount);
        emit Repay(from, rawAmount);
    }

    /// @notice Forgive raw units that will never come back. Lenders take the loss pro rata.
    function writeOff(uint256 rawAmount) external onlyController {
        if (rawAmount > totalBorrows) revert WriteOffExceedsBorrows(totalBorrows);
        totalBorrows -= rawAmount;
        emit WriteOff(rawAmount);
    }

    /// @notice Credit USDT fees to current shareholders. The USDT itself stays with the Controller.
    function notifyReward(uint256 cashAmount) external onlyController {
        if (cashAmount == 0) revert ZeroAmount();
        uint256 supply = totalSupply();
        if (supply == 0) revert NoShares();
        rewardPerShareStored += cashAmount.mulDiv(REWARD_PRECISION, supply);
        totalRewardsOwed += cashAmount;
        emit RewardNotified(cashAmount, rewardPerShareStored);
    }

    // ------------------------------------------------------------------ lender actions

    /// @notice Pay out the caller's accrued USDT to `to`.
    function claim(address to) external nonReentrant returns (uint256 amount) {
        _settle(msg.sender);
        amount = rewards[msg.sender];
        if (amount == 0) return 0;
        rewards[msg.sender] = 0;
        totalRewardsOwed -= amount;
        IController(controller).payLenderReward(to, amount);
        emit RewardClaimed(msg.sender, to, amount);
    }

    // ------------------------------------------------------------------ ERC-3156

    /// @inheritdoc IERC3156FlashLender
    function maxFlashLoan(address token) public view returns (uint256) {
        return token == asset() ? idle() : 0;
    }

    /// @inheritdoc IERC3156FlashLender
    function flashFee(address token, uint256 amount) public view returns (uint256) {
        if (token != asset()) revert UnsupportedToken(token);
        return amount.mulDiv(FLASH_FEE_BPS, 10_000, Math.Rounding.Ceil);
    }

    /// @inheritdoc IERC3156FlashLender
    function flashLoan(IERC3156FlashBorrower receiver, address token, uint256 amount, bytes calldata data)
        external
        nonReentrant
        returns (bool)
    {
        if (token != asset()) revert UnsupportedToken(token);
        uint256 idleNow = idle();
        if (amount > idleNow) revert InsufficientLiquidity(idleNow);
        uint256 fee = flashFee(token, amount);
        IERC20(token).safeTransfer(address(receiver), amount);
        if (receiver.onFlashLoan(msg.sender, token, amount, fee, data) != CALLBACK_SUCCESS) {
            revert FlashCallbackFailed();
        }
        IERC20(token).safeTransferFrom(address(receiver), address(this), amount + fee);
        emit FlashLoan(address(receiver), amount, fee);
        return true;
    }

    // ------------------------------------------------------------------ internals

    function _settle(address account) internal {
        rewards[account] = claimable(account);
        userRewardPerSharePaid[account] = rewardPerShareStored;
    }

    /// @dev Settle rewards for both sides before any share balance changes.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0)) _settle(from);
        if (to != address(0)) _settle(to);
        super._update(from, to, value);
    }
}
