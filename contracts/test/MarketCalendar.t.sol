// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MarketCalendar} from "../src/MarketCalendar.sol";

/// Requirements: the reference session for a bStock is US extended hours, 04:00 to 20:00 Eastern on weekdays,
/// closed on the holidays the owner lists, with Eastern Time switching between EDT and EST. The owner can move
/// the boundaries. Timestamps below were produced with GNU date (TZ=America/New_York), independently of the
/// contract's own arithmetic.
contract MarketCalendarTest is Test {
    uint256 constant WED_OCT7_0400ET = 1791360000; // session start
    uint256 constant WED_OCT7_0359ET = 1791359940;
    uint256 constant WED_OCT7_1000ET = 1791381600;
    uint256 constant WED_OCT7_1959ET = 1791417540;
    uint256 constant WED_OCT7_2000ET = 1791417600; // session end
    uint256 constant FRI_OCT9_2000ET = 1791590400; // last close before the weekend
    uint256 constant SAT_OCT10_1200ET = 1791648000;
    uint256 constant MON_OCT12_0330ET = 1791790200; // inside the pre-open half hour
    uint256 constant MON_OCT12_0400ET = 1791792000; // next open after the weekend
    uint256 constant THU_NOV26_1000ET = 1795705200; // Thanksgiving
    uint256 constant WED_NOV25_2000ET = 1795654800; // close before Thanksgiving
    uint256 constant FRI_NOV27_0400ET = 1795770000; // open after Thanksgiving
    uint256 constant FRI_NOV6_1930ET = 1794011400; // EST, after DST ended
    uint256 constant FRI_NOV6_2030ET = 1794015000;
    uint256 constant SUN_MAR8_0159ET = 1772953140; // one minute before DST starts
    uint256 constant SUN_MAR8_0300ET = 1772953200; // DST starts (02:00 becomes 03:00)

    MarketCalendar cal;
    address outsider = makeAddr("outsider");

    function setUp() public {
        cal = new MarketCalendar(address(this));
    }

    function test_weekdaySessionRunsFourToEightEastern() public view {
        assertFalse(cal.isOpen(WED_OCT7_0359ET));
        assertTrue(cal.isOpen(WED_OCT7_0400ET));
        assertTrue(cal.isOpen(WED_OCT7_1000ET));
        assertTrue(cal.isOpen(WED_OCT7_1959ET));
        assertFalse(cal.isOpen(WED_OCT7_2000ET));
    }

    function test_weekendIsClosed() public view {
        assertFalse(cal.isOpen(SAT_OCT10_1200ET));
        assertFalse(cal.isOpen(MON_OCT12_0330ET));
        assertTrue(cal.isOpen(MON_OCT12_0400ET));
    }

    function test_nextOpenAndClosedFor() public view {
        assertEq(cal.nextOpen(WED_OCT7_1000ET), WED_OCT7_1000ET, "already open returns the input");
        assertEq(cal.nextOpen(WED_OCT7_0359ET), WED_OCT7_0400ET, "same day, before the open");
        assertEq(cal.nextOpen(WED_OCT7_2000ET), WED_OCT7_0400ET + 1 days, "after the close, next day");
        assertEq(cal.nextOpen(SAT_OCT10_1200ET), MON_OCT12_0400ET);
        assertEq(cal.closedFor(WED_OCT7_1000ET), 0);
        assertEq(cal.closedFor(WED_OCT7_2000ET), 0, "exactly at the close");
        assertEq(cal.closedFor(SAT_OCT10_1200ET), SAT_OCT10_1200ET - FRI_OCT9_2000ET);
        assertEq(cal.closedFor(WED_OCT7_0359ET), WED_OCT7_0359ET - (WED_OCT7_2000ET - 1 days));
    }

    function test_holidayClosesTheDay() public {
        assertTrue(cal.isOpen(THU_NOV26_1000ET), "open until the holiday is set");
        cal.setHoliday(2026, 11, 26, true);
        assertFalse(cal.isOpen(THU_NOV26_1000ET));
        assertEq(cal.nextOpen(THU_NOV26_1000ET), FRI_NOV27_0400ET);
        assertEq(cal.closedFor(THU_NOV26_1000ET), THU_NOV26_1000ET - WED_NOV25_2000ET);
        cal.setHoliday(2026, 11, 26, false);
        assertTrue(cal.isOpen(THU_NOV26_1000ET));
    }

    function test_easternTimeFollowsDaylightSaving() public view {
        assertEq(cal.etOffset(SUN_MAR8_0159ET), 5 hours);
        assertEq(cal.etOffset(SUN_MAR8_0300ET), 4 hours);
        assertEq(cal.etOffset(WED_OCT7_1000ET), 4 hours);
        assertEq(cal.etOffset(THU_NOV26_1000ET), 5 hours);
        assertTrue(cal.isOpen(FRI_NOV6_1930ET), "19:30 EST on a Friday is still inside the session");
        assertFalse(cal.isOpen(FRI_NOV6_2030ET));
    }

    function test_sessionCanBeMoved() public {
        cal.setSession(0, 1 days);
        assertTrue(cal.isOpen(WED_OCT7_0359ET), "24/5: open all day on weekdays");
        assertTrue(cal.isOpen(WED_OCT7_2000ET));
        assertFalse(cal.isOpen(SAT_OCT10_1200ET));
        vm.expectRevert(MarketCalendar.InvalidSession.selector);
        cal.setSession(10 hours, 9 hours);
        vm.expectRevert(MarketCalendar.InvalidSession.selector);
        cal.setSession(1 hours, 25 hours);
    }

    function test_civilDateRoundTrip() public view {
        assertEq(cal.daysFromCivil(1970, 1, 1), 0);
        assertEq(cal.daysFromCivil(2026, 10, 10), 1791590400 / 1 days);
        (uint256 y, uint256 m, uint256 d) = cal.civilFromDays(1791590400 / 1 days);
        assertEq(y, 2026);
        assertEq(m, 10);
        assertEq(d, 10);
    }

    function test_onlyOwnerConfigures() public {
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, outsider));
        cal.setHoliday(2026, 11, 26, true);
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, outsider));
        cal.setSession(0, 1 days);
    }
}
