// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC3156FlashBorrower} from "@openzeppelin/contracts/interfaces/IERC3156FlashBorrower.sol";

/// @dev Repays amount plus fee.
contract GoodFlashBorrower is IERC3156FlashBorrower {
    bytes32 public constant SUCCESS = keccak256("ERC3156FlashBorrower.onFlashLoan");
    uint256 public lastAmount;
    uint256 public lastFee;

    function onFlashLoan(address, address token, uint256 amount, uint256 fee, bytes calldata)
        external
        returns (bytes32)
    {
        lastAmount = amount;
        lastFee = fee;
        IERC20(token).approve(msg.sender, amount + fee);
        return SUCCESS;
    }
}

/// @dev Approves the principal only, never the fee.
contract StingyFlashBorrower is IERC3156FlashBorrower {
    function onFlashLoan(address, address token, uint256 amount, uint256, bytes calldata)
        external
        returns (bytes32)
    {
        IERC20(token).approve(msg.sender, amount);
        return keccak256("ERC3156FlashBorrower.onFlashLoan");
    }
}

/// @dev Repays in full but returns the wrong magic value.
contract WrongReturnFlashBorrower is IERC3156FlashBorrower {
    function onFlashLoan(address, address token, uint256 amount, uint256 fee, bytes calldata)
        external
        returns (bytes32)
    {
        IERC20(token).approve(msg.sender, amount + fee);
        return bytes32(0);
    }
}
