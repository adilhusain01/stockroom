// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Controller} from "../src/Controller.sol";
import {LendingPool} from "../src/LendingPool.sol";
import {RiskMathRef} from "../src/RiskMathRef.sol";
import {MarketCalendar} from "../src/MarketCalendar.sol";
import {OracleRouter} from "../src/OracleRouter.sol";
import {RelayFeed} from "../src/RelayFeed.sol";
import {ShortRouter} from "../src/periphery/ShortRouter.sol";
import {Liquidator} from "../src/periphery/Liquidator.sol";
import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";
import {IPancakeV3Pool} from "../src/interfaces/IPancakeV3.sol";
import {IRiskEngine} from "../src/interfaces/IRiskEngine.sol";
import {ISwapRouterV3} from "../src/interfaces/ISwapRouterV3.sol";
import {IScaledUIAmount} from "../src/interfaces/IERC8056.sol";

/// @notice Deploys Stockroom on BSC mainnet from script/config/bsc-markets.json and writes
///         deployments/56.json. Run with:
///         forge script script/DeployBsc.s.sol --rpc-url $BSC_RPC_URL --broadcast --slow
///         Env: DEPLOYER_PRIVATE_KEY, KEEPER_ADDRESS, optional DEPLOY_MARKET_COUNT to deploy only the first N.
contract DeployBsc is Script {
    struct Cfg {
        address usdt;
        address usdtAproFeed;
        address swapRouter;
        uint32 twapWindow;
        uint64 bandWad;
        string[] tickers;
        address[] tokens;
        address[] aproFeeds;
        address[] pools;
        string[] tiers;
        string[] caps;
    }

    struct Core {
        MarketCalendar calendar;
        OracleRouter oracle;
        RiskMathRef engine;
        Controller controller;
        ShortRouter shortRouter;
        Liquidator liquidator;
        RelayFeed usdtFeed;
    }

    Cfg internal cfg;
    Core internal core;
    address[] internal feeds;
    address[] internal lendingPools;
    address internal keeper;
    address internal deployer;

    function run() external {
        _loadConfig();
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        deployer = vm.addr(deployerKey);
        keeper = vm.envOr("KEEPER_ADDRESS", deployer);
        uint256 n = vm.envOr("DEPLOY_MARKET_COUNT", cfg.tickers.length);
        if (n > cfg.tickers.length) n = cfg.tickers.length;

        vm.startBroadcast(deployerKey);
        _deployCore();
        for (uint256 i; i < n; ++i) {
            _deployMarket(i);
        }
        vm.stopBroadcast();
        _writeDeployment(n);
    }

    function _loadConfig() internal {
        string memory json = vm.readFile("script/config/bsc-markets.json");
        cfg.usdt = vm.parseJsonAddress(json, ".usdt");
        cfg.usdtAproFeed = vm.parseJsonAddress(json, ".usdtAproFeed");
        cfg.swapRouter = vm.parseJsonAddress(json, ".swapRouter");
        cfg.twapWindow = uint32(vm.parseJsonUint(json, ".twapWindow"));
        cfg.bandWad = uint64(vm.parseUint(vm.parseJsonString(json, ".bandWad")));
        cfg.tickers = vm.parseJsonStringArray(json, ".tickers");
        cfg.tokens = vm.parseJsonAddressArray(json, ".tokens");
        cfg.aproFeeds = vm.parseJsonAddressArray(json, ".aproFeeds");
        cfg.pools = vm.parseJsonAddressArray(json, ".pools");
        cfg.tiers = vm.parseJsonStringArray(json, ".tiers");
        cfg.caps = vm.parseJsonStringArray(json, ".borrowCapsRaw");
        require(
            cfg.tokens.length == cfg.tickers.length && cfg.pools.length == cfg.tickers.length
                && cfg.aproFeeds.length == cfg.tickers.length && cfg.caps.length == cfg.tickers.length,
            "config lengths"
        );
    }

    function _deployCore() internal {
        core.calendar = new MarketCalendar(deployer);
        core.oracle = new OracleRouter(core.calendar, deployer);
        core.engine = new RiskMathRef();
        core.controller = new Controller(IERC20(cfg.usdt), core.oracle, core.engine, deployer);
        core.shortRouter = new ShortRouter(core.controller, ISwapRouterV3(cfg.swapRouter));
        core.liquidator = new Liquidator(core.controller, ISwapRouterV3(cfg.swapRouter));
        core.usdtFeed = new RelayFeed(8, "USDT/USD (APRO relay)", cfg.usdtAproFeed, deployer);
        core.usdtFeed.setKeeper(keeper);
        core.oracle.setCashFeed(IAggregatorV3(address(core.usdtFeed)), 1 days);
        core.oracle.setKeeper(keeper);
        core.controller.setGuardian(keeper);
    }

    function _deployMarket(uint256 i) internal {
        address token = cfg.tokens[i];
        require(IScaledUIAmount(token).uiMultiplier() > 0, "not a BEP-677 token");
        RelayFeed feed = new RelayFeed(8, string.concat(cfg.tickers[i], "/USD (APRO relay)"), cfg.aproFeeds[i], deployer);
        feed.setKeeper(keeper);
        core.oracle.setFeed(token, IAggregatorV3(address(feed)), 1 hours);
        if (cfg.pools[i] != address(0)) {
            core.oracle.setPool(token, IPancakeV3Pool(cfg.pools[i]), cfg.twapWindow, cfg.bandWad);
        }
        LendingPool pool = new LendingPool(
            IERC20(token),
            string.concat("Stockroom ", cfg.tickers[i]),
            string.concat("s", cfg.tickers[i]),
            address(core.controller),
            0.9e18
        );
        Controller.MarketParams memory p = tierParams(cfg.tiers[i]);
        p.borrowCapRaw = vm.parseUint(cfg.caps[i]);
        core.controller.listMarket(token, pool, p);
        feeds.push(address(feed));
        lendingPools.push(address(pool));
        console2.log(cfg.tickers[i], "lending pool", address(pool));
        console2.log(cfg.tickers[i], "relay feed", address(feed));
    }

    function _writeDeployment(uint256 n) internal {
        string memory out = "deployment";
        vm.serializeUint(out, "chainId", block.chainid);
        vm.serializeAddress(out, "deployer", deployer);
        vm.serializeAddress(out, "keeper", keeper);
        vm.serializeAddress(out, "usdt", cfg.usdt);
        vm.serializeAddress(out, "swapRouter", cfg.swapRouter);
        vm.serializeAddress(out, "calendar", address(core.calendar));
        vm.serializeAddress(out, "oracle", address(core.oracle));
        vm.serializeAddress(out, "riskEngine", address(core.engine));
        vm.serializeAddress(out, "controller", address(core.controller));
        vm.serializeAddress(out, "shortRouter", address(core.shortRouter));
        vm.serializeAddress(out, "liquidator", address(core.liquidator));
        vm.serializeAddress(out, "usdtFeed", address(core.usdtFeed));
        vm.serializeAddress(out, "usdtAproFeed", cfg.usdtAproFeed);
        string[] memory tickers = new string[](n);
        address[] memory tokens = new address[](n);
        address[] memory apro = new address[](n);
        address[] memory pools = new address[](n);
        for (uint256 i; i < n; ++i) {
            tickers[i] = cfg.tickers[i];
            tokens[i] = cfg.tokens[i];
            apro[i] = cfg.aproFeeds[i];
            pools[i] = cfg.pools[i];
        }
        vm.serializeString(out, "tickers", tickers);
        vm.serializeAddress(out, "tokens", tokens);
        vm.serializeAddress(out, "aproFeeds", apro);
        vm.serializeAddress(out, "dexPools", pools);
        vm.serializeAddress(out, "feeds", feeds);
        string memory finalJson = vm.serializeAddress(out, "lendingPools", lendingPools);
        vm.writeJson(finalJson, string.concat("deployments/", vm.toString(block.chainid), ".json"));
    }

    function tierParams(string memory tier) internal pure returns (Controller.MarketParams memory p) {
        bool a = keccak256(bytes(tier)) == keccak256("A");
        p.initialRatioWad = a ? 1.5e18 : 2e18;
        p.liqThresholdWad = a ? 1.25e18 : 1.5e18;
        p.dutchMinWad = a ? 0.01e18 : 0.02e18;
        p.dutchMaxWad = a ? 0.12e18 : 0.15e18;
        p.dutchDuration = 20 minutes;
        p.irm = a
            ? IRiskEngine.IrmParams({baseWad: 0.01e18, kinkWad: 0.8e18, rateAtKinkWad: 0.10e18, maxRateWad: 1.5e18})
            : IRiskEngine.IrmParams({baseWad: 0.02e18, kinkWad: 0.8e18, rateAtKinkWad: 0.15e18, maxRateWad: 2e18});
    }
}
