// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice The Uniswap v3 periphery SwapRouter surface Stockroom uses. Paths are the usual packed
///         (token, fee, token, ...) encoding; exactOutput paths are reversed.
interface ISwapRouterV3 {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    struct ExactOutputParams {
        bytes path;
        address recipient;
        uint256 deadline;
        uint256 amountOut;
        uint256 amountInMaximum;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
    function exactOutput(ExactOutputParams calldata params) external payable returns (uint256 amountIn);
}
