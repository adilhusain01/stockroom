// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MarketCalendar
/// @notice When the reference market for a bStock is printing prices. Default session: US extended hours,
///         04:00 to 20:00 Eastern on weekdays, closed on the holidays the owner lists. bStocks themselves trade
///         24/7 on-chain; the calendar only decides which oracle regime applies. Eastern Time follows US
///         daylight saving (second Sunday of March 02:00 to first Sunday of November 02:00).
contract MarketCalendar is Ownable {
    uint256 internal constant DAY = 86400;
    uint256 internal constant MAX_LOOKAHEAD = 14;

    /// @notice Session boundaries as seconds after midnight Eastern.
    uint256 public openSeconds = 4 hours;
    uint256 public closeSeconds = 20 hours;

    mapping(uint256 day => bool closed) public holiday;

    event HolidaySet(uint256 indexed day, uint256 year, uint256 month, uint256 dayOfMonth, bool closed);
    event SessionSet(uint256 openSeconds, uint256 closeSeconds);

    error InvalidSession();
    error NoSessionFound();

    constructor(address owner_) Ownable(owner_) {}

    // ------------------------------------------------------------------ admin

    function setHoliday(uint256 year, uint256 month, uint256 dayOfMonth, bool closed) external onlyOwner {
        uint256 day = daysFromCivil(year, month, dayOfMonth);
        holiday[day] = closed;
        emit HolidaySet(day, year, month, dayOfMonth, closed);
    }

    /// @notice Move the session, for example to 24/5 (0 to 86400) if the reference ever prints overnight.
    function setSession(uint256 openSeconds_, uint256 closeSeconds_) external onlyOwner {
        if (openSeconds_ >= closeSeconds_ || closeSeconds_ > DAY) revert InvalidSession();
        openSeconds = openSeconds_;
        closeSeconds = closeSeconds_;
        emit SessionSet(openSeconds_, closeSeconds_);
    }

    // ------------------------------------------------------------------ views

    /// @notice True while the reference session is running at `timestamp`.
    function isOpen(uint256 timestamp) public view returns (bool) {
        uint256 local = timestamp - etOffset(timestamp);
        uint256 day = local / DAY;
        uint256 tod = local % DAY;
        return _sessionDay(day) && tod >= openSeconds && tod < closeSeconds;
    }

    /// @notice `timestamp` itself when the session is open, otherwise the UTC time the next session starts.
    function nextOpen(uint256 timestamp) public view returns (uint256) {
        if (isOpen(timestamp)) return timestamp;
        uint256 local = timestamp - etOffset(timestamp);
        uint256 day = local / DAY;
        uint256 tod = local % DAY;
        if (_sessionDay(day) && tod < openSeconds) return _toUtc(day * DAY + openSeconds);
        for (uint256 i = 1; i <= MAX_LOOKAHEAD; ++i) {
            if (_sessionDay(day + i)) return _toUtc((day + i) * DAY + openSeconds);
        }
        revert NoSessionFound();
    }

    /// @notice Seconds since the last session closed, zero while open.
    function closedFor(uint256 timestamp) public view returns (uint256) {
        if (isOpen(timestamp)) return 0;
        uint256 local = timestamp - etOffset(timestamp);
        uint256 day = local / DAY;
        uint256 tod = local % DAY;
        if (_sessionDay(day) && tod >= closeSeconds) return timestamp - _toUtc(day * DAY + closeSeconds);
        for (uint256 i = 1; i <= MAX_LOOKAHEAD; ++i) {
            if (_sessionDay(day - i)) return timestamp - _toUtc((day - i) * DAY + closeSeconds);
        }
        revert NoSessionFound();
    }

    /// @notice Eastern Time offset from UTC in seconds at `timestamp` (4 hours in daylight time, else 5).
    function etOffset(uint256 timestamp) public pure returns (uint256) {
        (uint256 year,,) = civilFromDays(timestamp / DAY);
        uint256 dstStart = _nthSunday(year, 3, 2) * DAY + 7 hours; // 02:00 EST
        uint256 dstEnd = _nthSunday(year, 11, 1) * DAY + 6 hours; // 02:00 EDT
        return (timestamp >= dstStart && timestamp < dstEnd) ? 4 hours : 5 hours;
    }

    /// @notice Days since 1970-01-01 for a civil date (Howard Hinnant's algorithm).
    function daysFromCivil(uint256 year, uint256 month, uint256 day) public pure returns (uint256) {
        if (month <= 2) year -= 1;
        uint256 era = year / 400;
        uint256 yoe = year - era * 400;
        uint256 mp = month > 2 ? month - 3 : month + 9;
        uint256 doy = (153 * mp + 2) / 5 + day - 1;
        uint256 doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        return era * 146097 + doe - 719468;
    }

    /// @notice Civil date for days since 1970-01-01.
    function civilFromDays(uint256 z) public pure returns (uint256 year, uint256 month, uint256 day) {
        z += 719468;
        uint256 era = z / 146097;
        uint256 doe = z - era * 146097;
        uint256 yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        uint256 doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        uint256 mp = (5 * doy + 2) / 153;
        day = doy - (153 * mp + 2) / 5 + 1;
        month = mp < 10 ? mp + 3 : mp - 9;
        year = yoe + era * 400 + (month <= 2 ? 1 : 0);
    }

    // ------------------------------------------------------------------ internals

    function _sessionDay(uint256 day) internal view returns (bool) {
        uint256 weekday = (day + 4) % 7; // 0 = Sunday
        if (weekday == 0 || weekday == 6) return false;
        return !holiday[day];
    }

    /// @dev Eastern local seconds to UTC, resolving the offset at the resulting instant.
    function _toUtc(uint256 local) internal pure returns (uint256) {
        uint256 utc = local + etOffset(local + 5 hours);
        uint256 offset = etOffset(utc);
        if (utc - local != offset) utc = local + offset;
        return utc;
    }

    function _nthSunday(uint256 year, uint256 month, uint256 n) internal pure returns (uint256) {
        uint256 first = daysFromCivil(year, month, 1);
        uint256 weekday = (first + 4) % 7;
        return first + (7 - weekday) % 7 + (n - 1) * 7;
    }
}
