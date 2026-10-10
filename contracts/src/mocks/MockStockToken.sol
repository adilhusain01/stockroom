// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Pausable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {
    IScaledUIAmount,
    IScaledUIAmountNewUIMultiplier,
    IScaledUIAmountConversion,
    IScaledUIAmountBalances
} from "../interfaces/IERC8056.sol";

/// @title MockStockToken
/// @notice Test double for a bStock: ERC-20 with the ERC-8056 extension, a schedulable
///         multiplier, an issuer pause switch and a rate-limited faucet. Testnets and tests only.
contract MockStockToken is
    ERC20Pausable,
    Ownable,
    ERC165,
    IScaledUIAmount,
    IScaledUIAmountNewUIMultiplier,
    IScaledUIAmountConversion,
    IScaledUIAmountBalances
{
    uint256 public constant ONE = 1e18;

    uint256 public faucetAmount = 1_000e18;
    uint256 public faucetCooldown = 1 days;
    mapping(address account => uint256) public lastFaucetAt;

    bool private _oraclePaused;
    uint256 private _multiplier = ONE;
    uint256 private _pendingMultiplier;
    uint256 private _pendingEffectiveAt;

    error InvalidMultiplier();
    error InvalidEffectiveAt();
    error FaucetCooldown(uint256 availableAt);

    constructor(string memory name_, string memory symbol_, address owner_) ERC20(name_, symbol_) Ownable(owner_) {}

    // ---------------------------------------------------------------- ERC-8056

    function uiMultiplier() public view returns (uint256) {
        if (_pendingEffectiveAt != 0 && block.timestamp >= _pendingEffectiveAt) return _pendingMultiplier;
        return _multiplier;
    }

    /// @dev Like the live Stock Token, the last scheduled values stay readable after they take effect; a
    ///      pending action is one whose `effectiveAt()` is still in the future.
    function newUIMultiplier() external view returns (uint256) {
        return _pendingEffectiveAt == 0 ? 0 : _pendingMultiplier;
    }

    function effectiveAt() external view returns (uint256) {
        return _pendingEffectiveAt;
    }

    function toUIAmount(uint256 rawAmount) public view returns (uint256) {
        return rawAmount * uiMultiplier() / ONE;
    }

    function fromUIAmount(uint256 uiAmount) public view returns (uint256) {
        return uiAmount * ONE / uiMultiplier();
    }

    function balanceOfUI(address account) external view returns (uint256) {
        return toUIAmount(balanceOf(account));
    }

    function totalSupplyUI() external view returns (uint256) {
        return toUIAmount(totalSupply());
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == type(IScaledUIAmount).interfaceId
            || interfaceId == type(IScaledUIAmountNewUIMultiplier).interfaceId
            || interfaceId == type(IScaledUIAmountConversion).interfaceId
            || interfaceId == type(IScaledUIAmountBalances).interfaceId || super.supportsInterface(interfaceId);
    }

    // ---------------------------------------------------------------- issuer actions

    /// @notice Schedule a corporate action. `effectiveAt_ == block.timestamp` applies it at once.
    function scheduleMultiplier(uint256 newMultiplier, uint256 effectiveAt_) external onlyOwner {
        if (newMultiplier == 0) revert InvalidMultiplier();
        if (effectiveAt_ < block.timestamp) revert InvalidEffectiveAt();
        _settlePending();
        emit UIMultiplierUpdated(_multiplier, newMultiplier, effectiveAt_);
        _pendingMultiplier = newMultiplier;
        _pendingEffectiveAt = effectiveAt_;
    }

    function cancelScheduledMultiplier() external onlyOwner {
        if (!_isPending()) revert InvalidEffectiveAt();
        emit UIMultiplierUpdateCancelled(_pendingMultiplier, _pendingEffectiveAt);
        _pendingMultiplier = 0;
        _pendingEffectiveAt = 0;
    }

    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Live bStocks expose this flag while a corporate action is being processed.
    function oraclePaused() external view returns (bool) {
        return _oraclePaused;
    }

    function setOraclePaused(bool paused_) external onlyOwner {
        _oraclePaused = paused_;
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function setFaucet(uint256 amount, uint256 cooldown) external onlyOwner {
        faucetAmount = amount;
        faucetCooldown = cooldown;
    }

    // ---------------------------------------------------------------- faucet

    function faucet() external {
        uint256 last = lastFaucetAt[msg.sender];
        uint256 availableAt = last + faucetCooldown;
        if (last != 0 && block.timestamp < availableAt) revert FaucetCooldown(availableAt);
        lastFaucetAt[msg.sender] = block.timestamp;
        _mint(msg.sender, faucetAmount);
    }

    // ---------------------------------------------------------------- internals

    function _isPending() internal view returns (bool) {
        return _pendingEffectiveAt != 0 && block.timestamp < _pendingEffectiveAt;
    }

    function _settlePending() internal {
        if (_pendingEffectiveAt != 0 && block.timestamp >= _pendingEffectiveAt) {
            _multiplier = _pendingMultiplier;
        }
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        emit TransferWithUIAmount(from, to, value, toUIAmount(value));
    }
}
