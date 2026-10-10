// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ISwapRouterV3} from "../interfaces/ISwapRouterV3.sol";

/// @notice Uniswap v3 SwapRouter stand-in that fills at a configured USD price per token with optional slippage.
///         It reads the first and last token of a path and ignores the hops in between. Tests only.
contract MockSwapRouter is ISwapRouterV3 {
    using SafeERC20 for IERC20;

    uint256 public constant WAD = 1e18;
    mapping(address token => uint256 priceWad) public priceWad; // USD per whole token
    uint256 public slippageBps;

    error UnpricedToken(address token);
    error TooLittleReceived(uint256 amountOut, uint256 minimum);
    error TooMuchRequested(uint256 amountIn, uint256 maximum);

    function setPrice(address token, uint256 price) external {
        priceWad[token] = price;
    }

    function setSlippage(uint256 bps) external {
        slippageBps = bps;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut) {
        (address tokenIn, address tokenOut) = _ends(params.path);
        amountOut = _convert(tokenIn, tokenOut, params.amountIn) * (10_000 - slippageBps) / 10_000;
        if (amountOut < params.amountOutMinimum) revert TooLittleReceived(amountOut, params.amountOutMinimum);
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);
        IERC20(tokenOut).safeTransfer(params.recipient, amountOut);
    }

    function exactOutput(ExactOutputParams calldata params) external payable returns (uint256 amountIn) {
        (address tokenOut, address tokenIn) = _ends(params.path);
        amountIn = Math.ceilDiv(_convert(tokenOut, tokenIn, params.amountOut) * (10_000 + slippageBps), 10_000);
        if (amountIn > params.amountInMaximum) revert TooMuchRequested(amountIn, params.amountInMaximum);
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).safeTransfer(params.recipient, params.amountOut);
    }

    function _ends(bytes calldata path) internal pure returns (address first, address last) {
        first = address(bytes20(path[:20]));
        last = address(bytes20(path[path.length - 20:]));
    }

    function _convert(address from, address to, uint256 amount) internal view returns (uint256) {
        uint256 pFrom = priceWad[from];
        uint256 pTo = priceWad[to];
        if (pFrom == 0) revert UnpricedToken(from);
        if (pTo == 0) revert UnpricedToken(to);
        uint256 valueWad = Math.mulDiv(amount, pFrom, 10 ** IERC20Metadata(from).decimals());
        return Math.mulDiv(valueWad, 10 ** IERC20Metadata(to).decimals(), pTo);
    }
}
