// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Flags read from a bStock itself (checked on mainnet NVDA, 2026-10-02):
///         `oraclePaused()` is set while a corporate action is processed, `paused()` halts transfers.
interface IStockTokenFlags {
    function oraclePaused() external view returns (bool);
    function paused() external view returns (bool);
}
