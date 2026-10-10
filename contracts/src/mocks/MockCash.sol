// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Six-decimal stand-in for Paxos USDT on testnets, with a rate-limited faucet. Never deploy to mainnet.
contract MockCash is ERC20, Ownable {
    uint256 public faucetAmount = 1_000e18;
    uint256 public faucetCooldown = 1 days;
    mapping(address account => uint256) public lastFaucetAt;

    error FaucetCooldown(uint256 availableAt);

    constructor(address owner_) ERC20("Tether USD (Stockroom test)", "USDT") Ownable(owner_) {}

    function decimals() public pure override returns (uint8) {
        return 18;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function setFaucet(uint256 amount, uint256 cooldown) external onlyOwner {
        faucetAmount = amount;
        faucetCooldown = cooldown;
    }

    function faucet() external {
        uint256 last = lastFaucetAt[msg.sender];
        uint256 availableAt = last + faucetCooldown;
        if (last != 0 && block.timestamp < availableAt) revert FaucetCooldown(availableAt);
        lastFaucetAt[msg.sender] = block.timestamp;
        _mint(msg.sender, faucetAmount);
    }
}
