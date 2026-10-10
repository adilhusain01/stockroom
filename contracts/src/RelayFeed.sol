// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";

/// @title RelayFeed
/// @notice An AggregatorV3-shaped feed a keeper writes into. APRO's bStocks feeds on BSC only answer calls that
///         come straight from an externally owned account ("No access" for contracts until the reader is
///         allowlisted), so until Stockroom's router is allowlisted the keeper reads APRO from an EOA every few
///         minutes and relays the same answer and timestamp here. The OracleRouter treats this exactly like the
///         APRO address: same decimals, same heartbeat, same staleness rule, and the PancakeSwap TWAP still
///         cross-checks every print on-chain. Swap the router to the APRO address with one `setFeed` once access
///         is granted.
contract RelayFeed is IAggregatorV3, Ownable2Step {
    uint8 public immutable override decimals;
    string public override description;
    uint256 public constant version = 1;
    address public source; // the feed being relayed, for the record

    address public keeper;
    uint80 private _roundId;
    int256 private _answer;
    uint256 private _updatedAt;

    event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt);
    event KeeperSet(address keeper);

    error NotKeeper();
    error StaleRelay(uint256 updatedAt, uint256 latest);
    error InvalidAnswer(int256 answer);

    constructor(uint8 decimals_, string memory description_, address source_, address owner_) Ownable(owner_) {
        decimals = decimals_;
        description = description_;
        source = source_;
        keeper = owner_;
    }

    modifier onlyKeeper() {
        if (msg.sender != keeper && msg.sender != owner()) revert NotKeeper();
        _;
    }

    function setKeeper(address keeper_) external onlyOwner {
        keeper = keeper_;
        emit KeeperSet(keeper_);
    }

    /// @notice Relay a print. `updatedAt` is the source's own timestamp, so staleness stays honest; it may not go
    ///         backwards and may not sit in the future.
    function setAnswer(int256 answer, uint256 updatedAt) external onlyKeeper {
        if (answer <= 0) revert InvalidAnswer(answer);
        if (updatedAt < _updatedAt || updatedAt > block.timestamp) revert StaleRelay(updatedAt, _updatedAt);
        _roundId += 1;
        _answer = answer;
        _updatedAt = updatedAt;
        emit AnswerUpdated(answer, _roundId, updatedAt);
    }

    function latestAnswer() external view returns (int256) {
        return _answer;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (_roundId, _answer, _updatedAt, _updatedAt, _roundId);
    }
}
