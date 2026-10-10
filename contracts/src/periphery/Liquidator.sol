// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC3156FlashBorrower} from "@openzeppelin/contracts/interfaces/IERC3156FlashBorrower.sol";
import {Controller} from "../Controller.sol";
import {ILendingPool} from "../interfaces/ILendingPool.sol";
import {ISwapRouterV3} from "../interfaces/ISwapRouterV3.sol";

/// @title Liquidator
/// @notice Capital-free liquidations: flash-borrow the tokens from their own pool, repay the unhealthy account,
///         buy the tokens back on Uniswap with the USDT received, return the flash loan plus fee and keep the
///         difference. Anyone can call it.
contract Liquidator is IERC3156FlashBorrower {
    using SafeERC20 for IERC20;

    bytes32 private constant CALLBACK_SUCCESS = keccak256("ERC3156FlashBorrower.onFlashLoan");

    Controller public immutable controller;
    IERC20 public immutable cash;
    ISwapRouterV3 public immutable swapRouter;

    uint256 private _lastProfit;

    event FlashLiquidated(
        address indexed account, address indexed token, address indexed caller, uint256 repaidRaw, uint256 profitCash
    );

    error NotPool();
    error NotSelf();
    error BelowMinProfit(uint256 profit, uint256 minProfit);

    constructor(Controller controller_, ISwapRouterV3 swapRouter_) {
        controller = controller_;
        cash = controller_.cash();
        swapRouter = swapRouter_;
    }

    /// @notice Liquidate up to `repayRaw` of `account`'s `token` debt. `buyPath` is the exactOutput path that
    ///         ends in USDT (token first). Profit in USDT goes to the caller.
    function liquidateWithFlash(
        address account,
        address token,
        uint256 repayRaw,
        bytes calldata buyPath,
        uint256 minProfitCash
    ) external returns (uint256 profit) {
        ILendingPool pool = controller.market(token).pool;
        pool.flashLoan(this, token, repayRaw, abi.encode(msg.sender, account, buyPath, minProfitCash));
        profit = _lastProfit;
        _lastProfit = 0;
    }

    /// @inheritdoc IERC3156FlashBorrower
    function onFlashLoan(address initiator, address token, uint256 amount, uint256 fee, bytes calldata data)
        external
        returns (bytes32)
    {
        if (controller.poolToken(msg.sender) != token) revert NotPool();
        if (initiator != address(this)) revert NotSelf();
        (address caller, address account, bytes memory buyPath, uint256 minProfit) =
            abi.decode(data, (address, address, bytes, uint256));

        IERC20(token).forceApprove(address(controller), amount);
        (uint256 repaidRaw, uint256 cashOut) = controller.liquidate(account, token, amount, 0);

        // buy back what was actually used plus the fee; unused flash tokens are returned as they are
        cash.forceApprove(address(swapRouter), cashOut);
        uint256 spent = swapRouter.exactOutput(
            ISwapRouterV3.ExactOutputParams({
                path: buyPath,
                recipient: address(this),
                deadline: block.timestamp,
                amountOut: repaidRaw + fee,
                amountInMaximum: cashOut
            })
        );
        IERC20(token).forceApprove(msg.sender, amount + fee);

        uint256 profit = cashOut - spent;
        if (profit < minProfit) revert BelowMinProfit(profit, minProfit);
        cash.safeTransfer(caller, profit);
        _lastProfit = profit;
        emit FlashLiquidated(account, token, caller, repaidRaw, profit);
        return CALLBACK_SUCCESS;
    }
}
