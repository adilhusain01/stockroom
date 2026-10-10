// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Chainlink AggregatorV3 shaped feed with the `oraclePaused` flag Robinhood Chain feeds expose.
///         On testnets a keeper mirrors the mainnet feed into it, including `updatedAt`, so staleness is real.
contract MockFeed is Ownable {
    uint8 public immutable decimals;
    string public description;
    uint256 public constant version = 4;

    address public keeper;
    uint80 private _roundId;
    int256 private _answer;
    uint256 private _updatedAt;
    bool private _paused;

    event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt);
    event PausedSet(bool paused);

    error NotKeeper();

    constructor(uint8 decimals_, string memory description_, address owner_) Ownable(owner_) {
        decimals = decimals_;
        description = description_;
        keeper = owner_;
    }

    modifier onlyKeeper() {
        if (msg.sender != keeper && msg.sender != owner()) revert NotKeeper();
        _;
    }

    function setKeeper(address keeper_) external onlyOwner {
        keeper = keeper_;
    }

    function setAnswer(int256 answer, uint256 updatedAt) external onlyKeeper {
        _roundId += 1;
        _answer = answer;
        _updatedAt = updatedAt;
        emit AnswerUpdated(answer, _roundId, updatedAt);
    }

    function setPaused(bool paused_) external onlyKeeper {
        _paused = paused_;
        emit PausedSet(paused_);
    }

    function oraclePaused() external view returns (bool) {
        return _paused;
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
