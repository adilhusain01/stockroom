// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IController} from "./interfaces/IController.sol";
import {IControllerCallback} from "./interfaces/IControllerCallback.sol";
import {ILendingPool} from "./interfaces/ILendingPool.sol";
import {IOracleRouter} from "./interfaces/IOracleRouter.sol";
import {IRiskEngine} from "./interfaces/IRiskEngine.sol";

/// @title Controller
/// @notice Accounts, USDT collateral, borrowing across every listed market, USDT fee accrual and Dutch-auction
///         liquidations. One account can short many tickers against one USDT balance.
/// @dev    Fees accrue per market as a USD index per whole token. Lenders are credited at accrual time through
///         the pool's reward index; borrowers pay lazily out of collateral whenever their account is touched.
///         Debt in raw units never grows, so a short stays a fixed number of shares.
contract Controller is IController, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    uint256 public constant WAD = 1e18;
    uint256 public constant YEAR = 365 days;
    uint256 public constant LENDER_SHARE_BPS = 9_000;
    uint256 public constant FULL_CLOSE_HEALTH = 0.95e18;

    struct MarketParams {
        uint256 initialRatioWad; // debt weight for new borrows and withdrawals, e.g. 1.5e18
        uint256 liqThresholdWad; // debt weight at liquidation, e.g. 1.25e18
        uint256 dutchMinWad; // auction discount at start
        uint256 dutchMaxWad; // auction discount at and after `dutchDuration`
        uint256 dutchDuration;
        uint256 borrowCapRaw; // raw units that may be outstanding across all borrowers
        IRiskEngine.IrmParams irm;
    }

    struct Market {
        ILendingPool pool;
        MarketParams params;
        uint256 totalDebtRaw;
        uint256 feeIndex; // cumulative USD (1e18) owed per whole token borrowed
        uint64 lastAccrual;
        bool listed;
        bool borrowPaused;
    }

    struct Position {
        uint256 debtRaw;
        uint256 feeIndexSnapshot;
    }

    struct Account {
        uint256 collateral; // USDT units, net of settled fees
        uint256 unpaidFees; // USDT units owed but not covered by collateral
        uint256 auctionStart;
        EnumerableSet.AddressSet borrowed;
        mapping(address token => Position) positions;
    }

    IERC20 public immutable cash;
    uint256 public immutable cashScale; // multiply USDT units by this to get WAD

    IOracleRouter public oracle;
    IRiskEngine public riskEngine;
    address public guardian;
    bool public borrowsPaused;
    uint256 public collateralCap; // per account, USDT units, zero means unlimited
    uint256 public insuranceBalance; // USDT units held here for bad debt

    mapping(address token => Market) internal _markets;
    mapping(address pool => address token) public poolToken;
    address[] public marketList;
    mapping(address account => Account) internal _accounts;
    mapping(address account => mapping(address operator => bool)) public isOperator;

    event MarketListed(address indexed token, address indexed pool);
    event MarketParamsUpdated(address indexed token);
    event BorrowPauseSet(address indexed token, bool paused);
    event GlobalBorrowPauseSet(bool paused);
    event OracleSet(address oracle);
    event RiskEngineSet(address riskEngine);
    event GuardianSet(address guardian);
    event CollateralCapSet(uint256 cap);
    event CollateralDeposited(address indexed account, address indexed from, uint256 amount);
    event CollateralWithdrawn(address indexed account, address indexed to, uint256 amount);
    event Borrowed(address indexed account, address indexed token, address indexed to, uint256 rawAmount);
    event Repaid(address indexed account, address indexed token, address indexed payer, uint256 rawAmount);
    event FeesAccrued(address indexed token, uint256 feeIndex, uint256 lenderCash, uint256 insuranceCash);
    event FeesSettled(address indexed account, uint256 paidCash, uint256 unpaidCash);
    event AuctionStarted(address indexed account, uint256 healthFactorWad);
    event AuctionCleared(address indexed account);
    event Liquidated(
        address indexed account,
        address indexed token,
        address indexed liquidator,
        uint256 repayRaw,
        uint256 cashOut,
        uint256 discountWad
    );
    event BadDebtAbsorbed(address indexed account, address indexed token, uint256 debtRaw, uint256 compensationCash);
    event InsuranceWithdrawn(address indexed to, uint256 amount);
    event OperatorSet(address indexed account, address indexed operator, bool approved);

    error NotGuardian();
    error NotPool();
    error MarketNotListed(address token);
    error MarketAlreadyListed(address token);
    error InvalidPool();
    error InvalidParams();
    error ZeroAmount();
    error BorrowsPaused();
    error BorrowNotAllowedByOracle();
    error BorrowCapExceeded(uint256 cap);
    error InitialRatioNotMet(uint256 collateralValueWad, uint256 requiredWad);
    error InsufficientCollateral(uint256 available);
    error CollateralCapExceeded(uint256 cap);
    error NothingToRepay();
    error NotLiquidatable(uint256 healthFactorWad);
    error BelowMinOut(uint256 cashOut, uint256 minCashOut);
    error CollateralRemains();
    error NoDebt();
    error NotOperator();

    modifier onlyGuardianOrOwner() {
        if (msg.sender != guardian && msg.sender != owner()) revert NotGuardian();
        _;
    }

    constructor(IERC20 cash_, IOracleRouter oracle_, IRiskEngine riskEngine_, address owner_) Ownable(owner_) {
        cash = cash_;
        uint8 decimals = IERC20Metadata(address(cash_)).decimals();
        if (decimals > 18) revert InvalidParams();
        cashScale = 10 ** (18 - decimals);
        oracle = oracle_;
        riskEngine = riskEngine_;
        guardian = owner_;
    }

    // ------------------------------------------------------------------ admin

    function listMarket(address token, ILendingPool pool, MarketParams calldata params) external onlyOwner {
        if (_markets[token].listed) revert MarketAlreadyListed(token);
        if (pool.asset() != token || pool.controller() != address(this)) revert InvalidPool();
        if (IERC20Metadata(token).decimals() != 18) revert InvalidParams();
        _validateParams(params);
        Market storage m = _markets[token];
        m.pool = pool;
        m.params = params;
        m.lastAccrual = uint64(block.timestamp);
        m.listed = true;
        poolToken[address(pool)] = token;
        marketList.push(token);
        emit MarketListed(token, address(pool));
    }

    function setMarketParams(address token, MarketParams calldata params) external onlyOwner {
        Market storage m = _market(token);
        _validateParams(params);
        _accrue(token, m);
        m.params = params;
        emit MarketParamsUpdated(token);
    }

    function setBorrowPaused(address token, bool paused) external onlyGuardianOrOwner {
        _market(token).borrowPaused = paused;
        emit BorrowPauseSet(token, paused);
    }

    function setGlobalBorrowPause(bool paused) external onlyGuardianOrOwner {
        borrowsPaused = paused;
        emit GlobalBorrowPauseSet(paused);
    }

    function setOracle(IOracleRouter oracle_) external onlyOwner {
        oracle = oracle_;
        emit OracleSet(address(oracle_));
    }

    function setRiskEngine(IRiskEngine riskEngine_) external onlyOwner {
        riskEngine = riskEngine_;
        emit RiskEngineSet(address(riskEngine_));
    }

    function setGuardian(address guardian_) external onlyOwner {
        guardian = guardian_;
        emit GuardianSet(guardian_);
    }

    function setCollateralCap(uint256 cap) external onlyOwner {
        collateralCap = cap;
        emit CollateralCapSet(cap);
    }

    function withdrawInsurance(address to, uint256 amount) external onlyOwner {
        if (amount > insuranceBalance) revert InsufficientCollateral(insuranceBalance);
        insuranceBalance -= amount;
        cash.safeTransfer(to, amount);
        emit InsuranceWithdrawn(to, amount);
    }

    // ------------------------------------------------------------------ pool callback

    /// @inheritdoc IController
    function payLenderReward(address to, uint256 cashAmount) external {
        if (poolToken[msg.sender] == address(0)) revert NotPool();
        cash.safeTransfer(to, cashAmount);
    }

    // ------------------------------------------------------------------ collateral

    /// @dev Not reentrancy-guarded on purpose: deferred-check callbacks deposit proceeds through here, and the
    ///      function only ever improves an account (USDT is a plain ERC-20 with no hooks).
    function depositCollateral(uint256 amount, address onBehalfOf) external {
        if (amount == 0) revert ZeroAmount();
        Account storage a = _accounts[onBehalfOf];
        cash.safeTransferFrom(msg.sender, address(this), amount);
        a.collateral += amount;
        _settle(onBehalfOf, a);
        if (collateralCap != 0 && a.collateral > collateralCap) revert CollateralCapExceeded(collateralCap);
        emit CollateralDeposited(onBehalfOf, msg.sender, amount);
    }

    function withdrawCollateral(uint256 amount, address to) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Account storage a = _accounts[msg.sender];
        _accrueAll(a);
        _settle(msg.sender, a);
        if (amount > a.collateral) revert InsufficientCollateral(a.collateral);
        a.collateral -= amount;
        _requireInitialRatio(msg.sender, a);
        cash.safeTransfer(to, amount);
        emit CollateralWithdrawn(msg.sender, to, amount);
    }

    // ------------------------------------------------------------------ borrowing

    function borrow(address token, uint256 rawAmount, address to) external nonReentrant {
        Account storage a = _borrow(msg.sender, token, rawAmount, to);
        _requireInitialRatio(msg.sender, a);
    }

    /// @notice Let `operator` borrow and withdraw on your behalf through the deferred-check functions.
    function setOperator(address operator, bool approved) external {
        isOperator[msg.sender][operator] = approved;
        emit OperatorSet(msg.sender, operator, approved);
    }

    /// @notice Borrow for `account`, hand the tokens to `receiver`, let it act, then check the initial ratio.
    ///         This is how a short works: the receiver sells the tokens and deposits the USDT before the check.
    function borrowWithCallback(address account, address token, uint256 rawAmount, address receiver, bytes calldata data)
        external
        nonReentrant
    {
        _requireOperator(account);
        Account storage a = _borrow(account, token, rawAmount, receiver);
        IControllerCallback(receiver).onStockroomBorrow(account, token, rawAmount, data);
        _requireInitialRatio(account, a);
    }

    /// @notice Withdraw USDT for `account` to `receiver`, let it act, then check the initial ratio.
    ///         This is how a cover works: the receiver buys the tokens back and repays before the check.
    function withdrawWithCallback(address account, uint256 amount, address receiver, bytes calldata data)
        external
        nonReentrant
    {
        if (amount == 0) revert ZeroAmount();
        _requireOperator(account);
        Account storage a = _accounts[account];
        _accrueAll(a);
        _settle(account, a);
        if (amount > a.collateral) revert InsufficientCollateral(a.collateral);
        a.collateral -= amount;
        cash.safeTransfer(receiver, amount);
        IControllerCallback(receiver).onStockroomWithdraw(account, amount, data);
        _requireInitialRatio(account, a);
        emit CollateralWithdrawn(account, receiver, amount);
    }

    /// @notice Repay up to `rawAmount` of `onBehalfOf`'s debt in `token`. Pass type(uint256).max for all of it.
    /// @dev Not reentrancy-guarded on purpose: deferred-check callbacks repay through here, and repaying only
    ///      ever improves an account. Tokens are owner-listed ERC-20s without hooks.
    function repay(address token, uint256 rawAmount, address onBehalfOf) external returns (uint256 repaid) {
        Market storage m = _market(token);
        Account storage a = _accounts[onBehalfOf];
        _accrue(token, m);
        _settle(onBehalfOf, a);
        Position storage p = a.positions[token];
        repaid = Math.min(rawAmount, p.debtRaw);
        if (repaid == 0) revert NothingToRepay();
        _pullAndRepay(m, token, msg.sender, repaid);
        _reduceDebt(a, p, m, token, repaid);
        _maybeClearAuction(onBehalfOf, a);
        emit Repaid(onBehalfOf, token, msg.sender, repaid);
    }

    // ------------------------------------------------------------------ liquidation

    /// @notice Repay part of an unhealthy account's `token` debt and receive its USDT at the auction discount.
    /// @return repaidRaw the raw units actually taken, after the close factor
    /// @return cashOut the USDT paid to the liquidator
    function liquidate(address account, address token, uint256 repayRaw, uint256 minCashOut)
        external
        nonReentrant
        returns (uint256 repaidRaw, uint256 cashOut)
    {
        Market storage m = _market(token);
        Account storage a = _accounts[account];
        _accrueAll(a);
        _settle(account, a);
        (uint256 health,,) = _evaluate(account, a);
        if (health >= WAD) revert NotLiquidatable(health);
        if (a.auctionStart == 0) {
            a.auctionStart = block.timestamp;
            emit AuctionStarted(account, health);
        }
        Position storage p = a.positions[token];
        if (p.debtRaw == 0) revert NoDebt();
        uint256 maxRepay = health < FULL_CLOSE_HEALTH ? p.debtRaw : Math.ceilDiv(p.debtRaw, 2);
        repayRaw = Math.min(repayRaw, maxRepay);
        if (repayRaw == 0) revert ZeroAmount();

        uint256 discount = riskEngine.dutchDiscount(
            block.timestamp - a.auctionStart, m.params.dutchMinWad, m.params.dutchMaxWad, m.params.dutchDuration
        );
        uint256 usdWad = Math.mulDiv(repayRaw, oracle.quote(token).priceWad, WAD);
        usdWad = Math.mulDiv(usdWad, WAD + discount, WAD);
        cashOut = Math.mulDiv(usdWad, WAD, oracle.cashPriceWad()) / cashScale;
        if (cashOut > a.collateral) cashOut = a.collateral;
        if (cashOut < minCashOut) revert BelowMinOut(cashOut, minCashOut);

        _pullAndRepay(m, token, msg.sender, repayRaw);
        _reduceDebt(a, p, m, token, repayRaw);
        a.collateral -= cashOut;
        cash.safeTransfer(msg.sender, cashOut);
        _maybeClearAuction(account, a);
        emit Liquidated(account, token, msg.sender, repayRaw, cashOut, discount);
        repaidRaw = repayRaw;
    }

    /// @notice Once an account has no collateral left, write its remaining debt off against the insurance fund.
    ///         Lenders receive USDT compensation from insurance first and take the token haircut for the rest.
    function absorb(address account) external nonReentrant {
        Account storage a = _accounts[account];
        _accrueAll(a);
        _settle(account, a);
        if (a.collateral != 0) revert CollateralRemains();
        if (a.borrowed.length() == 0 && a.unpaidFees == 0) revert NoDebt();

        address[] memory tokens = a.borrowed.values();
        for (uint256 i; i < tokens.length; ++i) {
            address token = tokens[i];
            Market storage m = _markets[token];
            Position storage p = a.positions[token];
            uint256 debtRaw = p.debtRaw;
            uint256 usdWad = Math.mulDiv(debtRaw, oracle.quote(token).priceWad, WAD);
            uint256 owedCash = Math.mulDiv(usdWad, WAD, oracle.cashPriceWad()) / cashScale;
            uint256 compensation = Math.min(owedCash, insuranceBalance);
            insuranceBalance -= compensation;
            if (compensation > 0) m.pool.notifyReward(compensation);
            m.pool.writeOff(debtRaw);
            m.totalDebtRaw -= debtRaw;
            delete a.positions[token];
            a.borrowed.remove(token);
            emit BadDebtAbsorbed(account, token, debtRaw, compensation);
        }
        uint256 unpaid = Math.min(a.unpaidFees, insuranceBalance);
        insuranceBalance -= unpaid;
        a.unpaidFees = 0;
        a.auctionStart = 0;
    }

    /// @notice Bring a market's fee index up to date and credit lenders. Anyone may call it.
    function accrue(address token) external {
        _accrue(token, _market(token));
    }

    // ------------------------------------------------------------------ views

    function market(address token) external view returns (Market memory) {
        return _markets[token];
    }

    function marketCount() external view returns (uint256) {
        return marketList.length;
    }

    function collateralOf(address account) external view returns (uint256) {
        return _accounts[account].collateral;
    }

    function unpaidFeesOf(address account) external view returns (uint256) {
        return _accounts[account].unpaidFees;
    }

    function auctionStartOf(address account) external view returns (uint256) {
        return _accounts[account].auctionStart;
    }

    function positionOf(address account, address token) external view returns (uint256 debtRaw) {
        return _accounts[account].positions[token].debtRaw;
    }

    function borrowedTokens(address account) external view returns (address[] memory) {
        return _accounts[account].borrowed.values();
    }

    /// @notice Fees owed right now that have not yet been taken out of collateral.
    function pendingFees(address account) public view returns (uint256) {
        return _pendingFees(_accounts[account]);
    }

    /// @notice Health factor (WAD) with pending fees already deducted from collateral.
    function healthFactor(address account) external view returns (uint256 health) {
        (health,,) = _evaluate(account, _accounts[account]);
    }

    /// @notice Current fee index of a market including time elapsed since the last accrual.
    function currentFeeIndex(address token) public view returns (uint256) {
        Market storage m = _markets[token];
        (uint256 index,) = _projectedIndex(token, m);
        return index;
    }

    // ------------------------------------------------------------------ internals: accrual and settlement

    function _projectedIndex(address token, Market storage m) internal view returns (uint256 index, uint256 delta) {
        index = m.feeIndex;
        uint256 dt = block.timestamp - m.lastAccrual;
        if (dt == 0 || m.totalDebtRaw == 0) return (index, 0);
        uint256 rate = riskEngine.borrowRate(m.pool.utilisation(), m.params.irm);
        uint256 price = oracle.quote(token).priceWad;
        delta = Math.mulDiv(Math.mulDiv(price, rate, WAD), dt, YEAR);
        index += delta;
    }

    function _accrue(address token, Market storage m) internal {
        (uint256 index, uint256 delta) = _projectedIndex(token, m);
        m.lastAccrual = uint64(block.timestamp);
        if (delta == 0) return;
        m.feeIndex = index;
        uint256 feesCash = Math.mulDiv(m.totalDebtRaw, delta, WAD) / cashScale;
        uint256 lenderCash = feesCash * LENDER_SHARE_BPS / 10_000;
        uint256 insuranceCash = feesCash - lenderCash;
        if (lenderCash > 0) m.pool.notifyReward(lenderCash);
        insuranceBalance += insuranceCash;
        emit FeesAccrued(token, index, lenderCash, insuranceCash);
    }

    function _accrueAll(Account storage a) internal {
        uint256 n = a.borrowed.length();
        for (uint256 i; i < n; ++i) {
            address token = a.borrowed.at(i);
            _accrue(token, _markets[token]);
        }
    }

    function _pendingFees(Account storage a) internal view returns (uint256 owed) {
        uint256 n = a.borrowed.length();
        for (uint256 i; i < n; ++i) {
            address token = a.borrowed.at(i);
            Market storage m = _markets[token];
            Position storage p = a.positions[token];
            (uint256 index,) = _projectedIndex(token, m);
            owed += Math.mulDiv(p.debtRaw, index - p.feeIndexSnapshot, WAD) / cashScale;
        }
        owed += a.unpaidFees;
    }

    /// @dev Requires every borrowed market to be accrued first.
    function _settle(address account, Account storage a) internal {
        uint256 owed = a.unpaidFees;
        uint256 n = a.borrowed.length();
        for (uint256 i; i < n; ++i) {
            address token = a.borrowed.at(i);
            Market storage m = _markets[token];
            Position storage p = a.positions[token];
            owed += Math.mulDiv(p.debtRaw, m.feeIndex - p.feeIndexSnapshot, WAD) / cashScale;
            p.feeIndexSnapshot = m.feeIndex;
        }
        if (owed == 0) return;
        uint256 paid = Math.min(owed, a.collateral);
        a.collateral -= paid;
        a.unpaidFees = owed - paid;
        emit FeesSettled(account, paid, a.unpaidFees);
    }

    // ------------------------------------------------------------------ internals: risk

    function _collateralValueWad(Account storage a) internal view returns (uint256) {
        uint256 pending = _pendingFees(a);
        if (pending >= a.collateral) return 0;
        return Math.mulDiv((a.collateral - pending) * cashScale, oracle.cashPriceWad(), WAD);
    }

    function _evaluate(address, Account storage a)
        internal
        view
        returns (uint256 health, uint256 debtValueWad, uint256 requiredWad)
    {
        uint256 n = a.borrowed.length();
        IRiskEngine.PositionInput[] memory inputs = new IRiskEngine.PositionInput[](n);
        for (uint256 i; i < n; ++i) {
            address token = a.borrowed.at(i);
            Market storage m = _markets[token];
            inputs[i] = IRiskEngine.PositionInput({
                debtRaw: a.positions[token].debtRaw,
                priceWad: oracle.quote(token).priceWad,
                liqThresholdWad: m.params.liqThresholdWad,
                initialRatioWad: m.params.initialRatioWad
            });
        }
        return riskEngine.evaluate(inputs, _collateralValueWad(a));
    }

    function _requireInitialRatio(address account, Account storage a) internal view {
        if (a.borrowed.length() == 0) return;
        (,, uint256 requiredWad) = _evaluate(account, a);
        uint256 collateralValueWad = _collateralValueWad(a);
        if (collateralValueWad < requiredWad) revert InitialRatioNotMet(collateralValueWad, requiredWad);
    }

    function _maybeClearAuction(address account, Account storage a) internal {
        if (a.auctionStart == 0) return;
        (uint256 health,,) = _evaluate(account, a);
        if (health >= WAD) {
            a.auctionStart = 0;
            emit AuctionCleared(account);
        }
    }

    // ------------------------------------------------------------------ internals: borrowing

    function _borrow(address account, address token, uint256 rawAmount, address to)
        internal
        returns (Account storage a)
    {
        if (rawAmount == 0) revert ZeroAmount();
        Market storage m = _market(token);
        if (borrowsPaused || m.borrowPaused) revert BorrowsPaused();
        if (!oracle.borrowAllowed(token)) revert BorrowNotAllowedByOracle();
        a = _accounts[account];
        _accrueAll(a);
        _accrue(token, m);
        _settle(account, a);

        if (m.totalDebtRaw + rawAmount > m.params.borrowCapRaw) revert BorrowCapExceeded(m.params.borrowCapRaw);
        Position storage p = a.positions[token];
        if (p.debtRaw == 0) {
            a.borrowed.add(token);
            p.feeIndexSnapshot = m.feeIndex;
        }
        p.debtRaw += rawAmount;
        m.totalDebtRaw += rawAmount;

        m.pool.borrow(rawAmount, to);
        emit Borrowed(account, token, to, rawAmount);
    }

    function _requireOperator(address account) internal view {
        if (msg.sender != account && !isOperator[account][msg.sender]) revert NotOperator();
    }

    // ------------------------------------------------------------------ internals: token movement

    function _pullAndRepay(Market storage m, address token, address payer, uint256 rawAmount) internal {
        IERC20(token).safeTransferFrom(payer, address(this), rawAmount);
        IERC20(token).forceApprove(address(m.pool), rawAmount);
        m.pool.repay(rawAmount, address(this));
    }

    function _reduceDebt(Account storage a, Position storage p, Market storage m, address token, uint256 rawAmount)
        internal
    {
        p.debtRaw -= rawAmount;
        m.totalDebtRaw -= rawAmount;
        if (p.debtRaw == 0) {
            a.borrowed.remove(token);
            p.feeIndexSnapshot = 0;
        }
    }

    function _market(address token) internal view returns (Market storage m) {
        m = _markets[token];
        if (!m.listed) revert MarketNotListed(token);
    }

    function _validateParams(MarketParams calldata p) internal view {
        if (p.liqThresholdWad < WAD || p.initialRatioWad < p.liqThresholdWad) revert InvalidParams();
        if (p.dutchMaxWad < p.dutchMinWad || p.dutchMaxWad >= WAD || p.dutchDuration == 0) revert InvalidParams();
        riskEngine.borrowRate(0, p.irm); // reverts on a malformed curve
    }
}
