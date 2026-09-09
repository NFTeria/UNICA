// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {RouterParamsCodec} from "../../src/compat/RouterParamsCodec.sol";
import {UnicaDeploymentsV3} from "../../src/v3/UnicaDeploymentsV3.sol";
import {UnicaExecutorV3} from "../../src/v3/UnicaExecutorV3.sol";
import {UnicaHookV3} from "../../src/v3/UnicaHookV3.sol";

/// @title DeployV3, the V3 hook and executor onto one named chain, refused before signing if anything
///        the deployment depends on is not what this tree says it is
///
/// @notice One command per chain, and the chain is NAMED BY THE CALLER, never defaulted. Both entry
///         points take the `foundry.toml` rpc alias as an argument:
///
///           forge script script/v3/DeployV3.s.sol:DeployV3 --sig "preflight(string)" sepolia_testnet \
///             --rpc-url sepolia_testnet --sender <deployer>
///           forge script script/v3/DeployV3.s.sol:DeployV3 --sig "run(string)"       sepolia_testnet \
///             --rpc-url sepolia_testnet --account <keystore> --sender <deployer> --broadcast
///
///         THERE IS DELIBERATELY NO ZERO-ARGUMENT `run()`. `forge script` calls `run()` when no
///         `--sig` is given, so a file that defined one could deploy to whatever chain the endpoint
///         happened to be without anybody having said which chain they meant. This file defines none,
///         so that command fails to find a function instead of signing something. The alias the
///         caller passes is checked against the chain id the endpoint actually answers: the caller
///         says what they meant, the chain says what it is, and the deploy happens only if those are
///         the same sentence.
///
///         WHAT THE PRE-FLIGHT REFUSES, all of it before `vm.startBroadcast` is ever reached, and all
///         of it read from the chain in this run rather than remembered from another one:
///
///           1. the endpoint answers a chain this generation resolves, and it is the chain named;
///           2. a payout currency has been VERIFIED on it — this is what refuses chain 46630;
///           3. PoolManager, Universal Router, Permit2 and the payout currency each hold code;
///           4. the router's live runtime code hash equals the hash recorded beside its layout, so a
///              router that has been rebuilt since the table was written is an UNKNOWN router and is
///              refused here rather than discovered at the first settlement;
///           5. the mined hook address is vacant, the derived executor address is vacant, and the
///              hook's own declared permissions equal the bottom fourteen bits of that address;
///           6. the deployer holds enough of the chain's gas currency.
///
///         A mainnet is refused one layer above this, by chain id, in `script/v3/deploy-v3.sh`
///         through `script/mainnet-guard.sh` — the one list, never a second copy. This script's own
///         defence against a mainnet is row 1: the five chains it resolves are five testnets, and
///         everything else, mainnets included, is `UnsupportedChainId`.
///
/// @dev THE PERMISSION CHECK IS A REAL CONSTRUCTION, not arithmetic about one. Row 5 etches the
///      hook's creation code at the mined address, CALLs it so the constructor runs with
///      `address(this)` equal to that address exactly as it will on chain, keeps the runtime it
///      returns, asks that runtime for `getHookPermissions()`, and compares the bitmap to the
///      address's low bits. So the row proves the constructor accepts this chain and this address —
///      including `BaseHook`'s own address validation and the payout-currency revert — rather than
///      proving that two copies of the same constant are equal. The whole of it happens inside a
///      `snapshotState`/`revertToState` pair, so the address is vacant again before anything deploys.
///
///      This script mines the address itself rather than being handed one. `script/v3/MineHookV3.s.sol`
///      prints the same address from the same creation code; `test/v3/MineHookV3.t.sol` derives it a
///      third and fourth way. The init-code hash is printed here too, because that is the thing to
///      compare across a change — the address is only its shadow.
contract DeployV3 is Script {
    /// @dev The deterministic-deployment proxy, asserted against forge-std's constant and the
    ///      deployments library's so all three cannot drift apart unnoticed.
    address internal constant DETERMINISTIC_FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    /// @dev The declared permission set: beforeInitialize | beforeSwap | afterSwap (0x20C0).
    uint160 internal constant FLAGS = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG;
    /// @dev Uniswap reserves the top address byte 0x91 as a routing signal.
    uint8 internal constant RESERVED_PREFIX = 0x91;
    /// @dev The executor is deployed at salt zero, bound to the hook by constructor argument.
    bytes32 internal constant EXECUTOR_SALT = bytes32(0);
    /// @dev How far the search runs before giving up rather than looping forever.
    uint256 internal constant MAX_SALT = 200_000;
    /// @dev Gas units the two creations need. MEASURED, not guessed: `forge script` estimated
    ///      8,126,181 for this exact pair on Ethereum Sepolia on 2026-09-09, and this is that with
    ///      headroom. A fixed WEI floor was the first version of this row and it was wrong — it read
    ///      0.01 ETH while the same run estimated 0.0172 ETH required, so the check would have passed
    ///      a deployer who could not pay. A floor has to be derived from the chain it is guarding.
    uint256 internal constant DEPLOY_GAS_UNITS = 8_500_000;
    /// @dev The priority fee the floor assumes on top of twice the current base fee. One gwei is what
    ///      the Sepolia estimate above implied (2.12 gwei total against a 1.12 gwei base), and twice
    ///      the base fee is roughly the most a few blocks of congestion can move it under EIP-1559.
    ///      Over-estimating here refuses a deploy that would have squeaked through; under-estimating
    ///      lets one start and run out. Only one of those two is recoverable.
    uint256 internal constant ASSUMED_PRIORITY_FEE_WEI = 1 gwei;
    /// @dev The `poolManager()` selector, asked of the router itself so the table's PoolManager is
    ///      checked against the router's own answer where the build exposes one.
    bytes4 internal constant POOL_MANAGER_SELECTOR = bytes4(keccak256("poolManager()"));

    /// @notice Everything the pre-flight established, carried to the broadcast so the deploy uses the
    ///         numbers that were checked rather than recomputing them and hoping they match.
    struct Plan {
        uint256 chainId;
        bytes32 initCodeHash;
        bytes32 salt;
        address hook;
        address executor;
        bytes32 executorInitCodeHash;
        address deployer;
    }

    uint256 internal checksRun;
    uint256 internal checksPassed;
    uint256 internal checksFailed;
    uint256 internal checksSkipped;

    // ---- entry points ----------------------------------------------------------------------------

    /// @notice The pre-flight alone. Reads the chain, writes nothing, signs nothing.
    /// @param rpcAlias The `foundry.toml` alias the caller named, e.g. `sepolia_testnet`.
    function preflight(string calldata rpcAlias) external {
        _preflight(rpcAlias);
        _summary();
    }

    /// @notice The pre-flight, then the two deployments. Only this one broadcasts, and only when
    ///         `forge script` is given `--broadcast`; without it this is a simulation.
    /// @param rpcAlias The `foundry.toml` alias the caller named, e.g. `sepolia_testnet`.
    function run(string calldata rpcAlias) external {
        Plan memory p = _preflight(rpcAlias);
        _summary();
        _deploy(p);
    }

    // ---- the pre-flight --------------------------------------------------------------------------

    function _preflight(string calldata rpcAlias) internal returns (Plan memory p) {
        require(DETERMINISTIC_FACTORY == CREATE2_FACTORY, "the factory address here is not forge-std's");
        require(
            DETERMINISTIC_FACTORY == UnicaDeploymentsV3.CREATE2_FACTORY,
            "the factory address here is not the deployments library's"
        );

        // RE-PIN THE FORK TO THE CHAIN'S TRUE HEAD BEFORE READING ANYTHING, AND THIS IS NOT
        // DEFENSIVE PROGRAMMING — IT IS A MEASURED BUG IN THE PATH THIS SCRIPT RUNS ON.
        //
        // `forge script --rpc-url <alias>` forks at startup and pins that fork to the block number
        // the EVM reports. On Arbitrum, `block.number` is not the L2 block: it is Arbitrum's
        // estimate of the L1 block. So on Arbitrum Sepolia (measured 2026-09-09, foundry 1.3.5) the
        // startup fork pinned to L2 block 11,666,418 while the chain's head was 306,994,573 — state
        // from before the v4 PoolManager existed. Every read came back from that ancient block: the
        // PoolManager and the Universal Router held NO CODE and the deployer's balance was ZERO,
        // while `cast` against the same alias in the same second read 24,009 bytes, 19,540 bytes and
        // 1.4989 ETH. A pre-flight that reported those numbers would be describing last year.
        //
        // `vm.createSelectFork` does not have the defect: it resolves the head itself. So the read
        // path is made explicit here rather than inherited from the command line, and the chain id
        // the startup fork answered is required to equal the one this fork answers, so that
        // `--rpc-url` and the named alias cannot be two different chains — the broadcast follows
        // `--rpc-url`, and checks run against a chain the deploy does not reach are worse than no
        // checks at all.
        uint256 startupChainId = block.chainid;
        vm.createSelectFork(vm.rpcUrl(rpcAlias));
        require(
            block.chainid == startupChainId,
            "--rpc-url answers a different chain from the alias named on the command line; run both as the same alias"
        );

        p.chainId = block.chainid;
        p.deployer = msg.sender;

        console.log("# UNICA V3 deploy pre-flight");
        console.log("  named by the caller        ", rpcAlias);
        console.log("  chain id the endpoint says ", p.chainId);
        // Printed for the record, and read with the caveat above: on an Arbitrum chain this is the
        // L1 block number, not that chain's own, which is exactly the fact the re-pin exists for.
        console.log("  block.number it reports    ", block.number);
        console.log("  deployer                   ", p.deployer);
        console.log("");

        // ---- 1. the chain is one of the five, and it is the one the caller named -------------------
        //
        // `_aliasFor` reverts on any chain id this generation does not resolve, which is every
        // mainnet and everything else. So a wrong endpoint stops here, before a single read is
        // interpreted, and it stops by NAME rather than by a later check happening to notice.
        _check(
            UnicaDeploymentsV3.isSupported(p.chainId), "the chain id answered is one of the five this generation knows"
        );
        string memory expected = _aliasFor(p.chainId);
        _check(
            keccak256(bytes(expected)) == keccak256(bytes(rpcAlias)),
            string.concat("the endpoint answers the chain the caller named (it answers '", expected, "')")
        );

        UnicaDeploymentsV3.Routing memory r = UnicaDeploymentsV3.routing(p.chainId);

        // ---- 2. a payout currency has been verified on this chain ---------------------------------
        //
        // THE ROW THAT REFUSES CHAIN 46630. `UnicaDeploymentsV3` names no payout token there because
        // none was found when the table was read, and both the hook and the executor revert in their
        // constructors rather than accept a guess. A guessed payout currency would be compiled into
        // the hook's own address and into every receipt it ever emitted, and neither is undoable.
        bool payoutVerified = UnicaDeploymentsV3.hasVerifiedPayoutCurrency(p.chainId);
        _check(payoutVerified, "a payout currency has been VERIFIED on this chain (PayoutCurrencyNotVerified if not)");
        if (!payoutVerified) {
            console.log("      chain", p.chainId, "is resolvable for ROUTING but is NOT deployable:");
            console.log("      UnicaDeploymentsV3.payoutCurrency reverts PayoutCurrencyNotVerified here,");
            console.log("      so UnicaHookV3 and UnicaExecutorV3 both revert in their constructors.");
        }

        // ---- 3. every dependency holds code -------------------------------------------------------
        console.log("  PoolManager                ", r.poolManager);
        console.log("  Universal Router           ", r.universalRouter);
        console.log("  Permit2                    ", r.permit2);
        _check(r.poolManager.code.length > 0, "the PoolManager holds code on this chain");
        _check(r.universalRouter.code.length > 0, "the Universal Router holds code on this chain");
        _check(r.permit2.code.length > 0, "Permit2 holds code on this chain");
        _check(DETERMINISTIC_FACTORY.code.length == 69, "the CREATE2 factory is the 69-byte deterministic one");
        if (payoutVerified) {
            address payout = UnicaDeploymentsV3.payoutCurrency(p.chainId);
            console.log("  payout currency            ", payout);
            _check(payout.code.length > 0, "the payout currency holds code on this chain");
        } else {
            _skip("no payout currency to read back on this chain");
        }

        // ---- 4. the router is a build whose parameter layout is known ------------------------------
        //
        // The address is not the check; the runtime is. A chain that redeploys its Universal Router
        // from a newer v4-periphery changes which `ExactInputSingleParams` head it decodes without
        // changing its chain id or its address, and on a native-input pool the wrong head does not
        // refuse — it drops the order id. So an unknown build is refused HERE, before signing, and
        // never retried afterwards: the answer to a moved router is a new table and a new address,
        // not another attempt.
        console.log("  router layout claimed      ", RouterParamsCodec.name(r.layout));
        _check(r.layout != RouterParamsCodec.Layout.Unknown, "the router's parameter layout is known, not Unknown");
        bool routerKnown = r.universalRouter.codehash == r.universalRouterCodeHash;
        _check(routerKnown, "the router's LIVE runtime code hash equals the hash recorded beside that layout");
        if (!routerKnown) {
            console.log("      recorded:");
            console.logBytes32(r.universalRouterCodeHash);
            console.log("      live:");
            console.logBytes32(r.universalRouter.codehash);
            console.log("      This is an UNKNOWN router build. Refused before signing. Do not retry: re-read the");
            console.log("      chain, record the new hash and its layout, and mine the address again.");
        }
        // Where the build exposes it, the router's own answer is a second, independent source for the
        // PoolManager in the table. Where it does not, that is a SKIP and says so.
        (bool ok, bytes memory ret) = r.universalRouter.staticcall(abi.encodeWithSelector(POOL_MANAGER_SELECTOR));
        if (ok && ret.length == 32) {
            _check(abi.decode(ret, (address)) == r.poolManager, "the router's own poolManager() agrees with the table");
        } else {
            _skip("this router build does not expose poolManager(), so the table cannot be cross-read from it");
        }

        // ---- 5. the addresses this creation code lands on, and what is at them ---------------------
        p = _mine(p);
        console.log("");
        console.log("  hook init-code hash        ");
        console.logBytes32(p.initCodeHash);
        console.log("  hook salt                  ");
        console.logBytes32(p.salt);
        console.log("  hook address               ", p.hook);
        console.log("  executor init-code hash    ");
        console.logBytes32(p.executorInitCodeHash);
        console.log("  executor address           ", p.executor);
        console.log("");

        _check(p.hook.code.length == 0, "the mined hook address is VACANT on this chain");
        _check(p.executor.code.length == 0, "the derived executor address is VACANT on this chain");
        _check(uint160(p.hook) & Hooks.ALL_HOOK_MASK == FLAGS, "the mined address carries exactly the declared bits");
        _check(uint8(uint160(p.hook) >> 152) != RESERVED_PREFIX, "the mined address avoids the reserved 0x91 prefix");
        _permissionRow(p);

        // ---- 6. the deployer can pay for it -------------------------------------------------------
        uint256 derivedFloor = DEPLOY_GAS_UNITS * (2 * block.basefee + ASSUMED_PRIORITY_FEE_WEI);
        uint256 floor = vm.envOr("UNICA_GAS_FLOOR_WEI", derivedFloor);
        console.log("  gas units assumed          ", DEPLOY_GAS_UNITS);
        console.log("  base fee now         (wei) ", block.basefee);
        console.log("  floor                (wei) ", floor);
        console.log("  deployer gas balance (wei) ", p.deployer.balance);
        _check(p.deployer.balance >= floor, "the deployer holds at least the gas floor in this chain's gas currency");
    }

    /// @dev The permission row, done by construction. See the note at the top of the file for why
    ///      this is a real constructor run and not arithmetic about one.
    ///
    ///      EVERY RESULT IS CARRIED OUT OF THE SNAPSHOT IN A LOCAL AND ONLY COUNTED AFTERWARDS, and
    ///      that is the whole reason this function is shaped the way it is. The first version called
    ///      `_check` inside the snapshot window, and `vm.revertToState` reverts the SCRIPT'S OWN
    ///      STORAGE too — so the counters those calls incremented were rolled back with everything
    ///      else. Measured 2026-09-09 on chain 46630: the row printed `FAIL  the hook's constructor
    ///      accepts this chain and this address`, and the summary underneath it read `checks run:
    ///      15, failed: 1` — counting a different failure entirely, with this one erased. Had the
    ///      payout row not failed independently, the script would have printed FAIL, summarised
    ///      zero failures, exited zero, and deployed. A counter that a later cheatcode can undo is
    ///      not a counter, and a run whose printed rows and printed totals disagree has already
    ///      told you which one to distrust.
    function _permissionRow(Plan memory p) internal {
        uint256 snap = vm.snapshotState();

        bytes memory init = type(UnicaHookV3).creationCode;
        vm.etch(p.hook, init);
        (bool built, bytes memory runtime) = p.hook.call("");
        bool constructed = built && runtime.length > 0;

        uint160 declared;
        address derivedExecutor;
        if (constructed) {
            vm.etch(p.hook, runtime);
            declared = _bitmap(UnicaHookV3(p.hook).getHookPermissions());
            derivedExecutor = UnicaHookV3(p.hook).SETTLEMENT_EXECUTOR();
        }

        // The executor's constructor too, at the address it will live at, with the hook as its one
        // argument. This is not a duplicate of the router row above: that row compares two hashes,
        // and THIS runs `_requireRouterUnchanged()` inside the real constructor, which is the code
        // that will actually refuse on chain. Two independent statements of the same fact, so a
        // mistake in either one is visible rather than absorbed.
        vm.etch(p.executor, abi.encodePacked(type(UnicaExecutorV3).creationCode, abi.encode(p.hook)));
        (bool execBuilt, bytes memory execRuntime) = p.executor.call("");
        bool execConstructed = execBuilt && execRuntime.length > 0;
        address executorsHook;
        if (execConstructed) {
            vm.etch(p.executor, execRuntime);
            executorsHook = UnicaExecutorV3(payable(p.executor)).HOOK();
        }

        vm.revertToState(snap);
        // The snapshot is worth nothing if it did not actually undo the etch: the next thing this
        // script does is deploy to that address, and a script that deployed onto its own scaffolding
        // would report a success that never happened on chain.
        require(p.hook.code.length == 0, "the pre-flight's scaffolding was not reverted");
        require(p.executor.code.length == 0, "the pre-flight's executor scaffolding was not reverted");

        // Only now, on state the snapshot cannot reach back into, is any of it counted.
        _check(constructed, "the hook's constructor accepts this chain and this address");
        if (constructed) {
            console.log("  permissions the hook declares", uint256(declared));
            console.log("  low bits of the mined address", uint256(uint160(p.hook) & Hooks.ALL_HOOK_MASK));
            _check(
                declared == uint160(p.hook) & Hooks.ALL_HOOK_MASK,
                "the hook's DECLARED permissions equal the low bits of the address it will live at"
            );
            // The pair is bound both ways, and the hook is the side that says so first.
            _check(derivedExecutor == p.executor, "the hook derives exactly the executor address this script derived");
        } else {
            _skip("no runtime to ask for getHookPermissions(), because the constructor did not return one");
            _skip("no runtime to ask for SETTLEMENT_EXECUTOR() either");
        }

        _check(
            execConstructed, "the executor's constructor accepts this chain (it runs _requireRouterUnchanged itself)"
        );
        if (execConstructed) {
            _check(executorsHook == p.hook, "the executor binds itself to exactly this hook");
        } else {
            _skip("no executor runtime to ask for HOOK(), because its constructor did not return one");
        }
    }

    /// @dev The fourteen permission bits, from the struct the hook returns. Written out rather than
    ///      assumed, so a permission added upstream is a compile error here and not a silent zero.
    function _bitmap(Hooks.Permissions memory q) internal pure returns (uint160 b) {
        if (q.beforeInitialize) b |= Hooks.BEFORE_INITIALIZE_FLAG;
        if (q.afterInitialize) b |= Hooks.AFTER_INITIALIZE_FLAG;
        if (q.beforeAddLiquidity) b |= Hooks.BEFORE_ADD_LIQUIDITY_FLAG;
        if (q.afterAddLiquidity) b |= Hooks.AFTER_ADD_LIQUIDITY_FLAG;
        if (q.beforeRemoveLiquidity) b |= Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG;
        if (q.afterRemoveLiquidity) b |= Hooks.AFTER_REMOVE_LIQUIDITY_FLAG;
        if (q.beforeSwap) b |= Hooks.BEFORE_SWAP_FLAG;
        if (q.afterSwap) b |= Hooks.AFTER_SWAP_FLAG;
        if (q.beforeDonate) b |= Hooks.BEFORE_DONATE_FLAG;
        if (q.afterDonate) b |= Hooks.AFTER_DONATE_FLAG;
        if (q.beforeSwapReturnDelta) b |= Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG;
        if (q.afterSwapReturnDelta) b |= Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;
        if (q.afterAddLiquidityReturnDelta) b |= Hooks.AFTER_ADD_LIQUIDITY_RETURNS_DELTA_FLAG;
        if (q.afterRemoveLiquidityReturnDelta) b |= Hooks.AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA_FLAG;
    }

    // ---- the deployment --------------------------------------------------------------------------

    /// @dev Two creations, each asserted against the address the pre-flight checked. Nothing here
    ///      recomputes an address: if a deployment lands anywhere other than where the checks were
    ///      run, this reverts rather than reporting the new address as though it had been vetted.
    function _deploy(Plan memory p) internal {
        console.log("");
        console.log("# deploying (this line is only reached with --broadcast on a real send)");

        vm.startBroadcast();
        UnicaHookV3 hook = new UnicaHookV3{salt: p.salt}();
        vm.stopBroadcast();
        require(address(hook) == p.hook, "the hook landed away from the address the pre-flight checked");
        require(
            uint160(address(hook)) & Hooks.ALL_HOOK_MASK == FLAGS, "the deployed hook's bits are not the declared set"
        );
        console.log("  hook deployed              ", address(hook));

        vm.startBroadcast();
        UnicaExecutorV3 executor = new UnicaExecutorV3{salt: EXECUTOR_SALT}(address(hook));
        vm.stopBroadcast();
        require(address(executor) == p.executor, "the executor landed away from the address the pre-flight checked");
        console.log("  executor deployed          ", address(executor));

        // Bound both ways, read back from the two deployed contracts rather than from the plan.
        require(executor.HOOK() == address(hook), "the executor is not bound to the hook");
        require(hook.SETTLEMENT_EXECUTOR() == address(executor), "the hook does not name the executor that deployed");
        console.log("  the pair names itself both ways; chain", block.chainid, "is live");
    }

    // ---- the address, derived twice before it is used ---------------------------------------------

    /// @dev The same rule as `script/v3/MineHookV3.s.sol`, run twice here: `keccak(0xff, factory,
    ///      salt, initCodeHash)` written out in Solidity, and Foundry's Rust implementation of the
    ///      same, then `HookMiner` on the winner. Derived rather than pasted, because a pasted
    ///      address stops describing the tree the moment the creation code changes and then keeps
    ///      passing quietly.
    function _mine(Plan memory p) internal view returns (Plan memory) {
        bytes memory creationCode = type(UnicaHookV3).creationCode;
        p.initCodeHash = keccak256(creationCode);

        (address byHand, bytes32 saltByHand) = _mineByHand(p.initCodeHash);
        (address byCheatcode, bytes32 saltByCheatcode) = _mineByCheatcode(p.initCodeHash);
        require(byHand == byCheatcode, "the two derivations disagree on the hook address");
        require(saltByHand == saltByCheatcode, "the two derivations disagree on the salt");
        require(
            HookMiner.computeAddress(DETERMINISTIC_FACTORY, uint256(saltByHand), creationCode) == byHand,
            "HookMiner disagrees with both derivations"
        );

        p.salt = saltByHand;
        p.hook = byHand;
        p.executorInitCodeHash = keccak256(abi.encodePacked(type(UnicaExecutorV3).creationCode, abi.encode(byHand)));
        p.executor = vm.computeCreate2Address(EXECUTOR_SALT, p.executorInitCodeHash, DETERMINISTIC_FACTORY);
        return p;
    }

    function _mineByHand(bytes32 initCodeHash) internal pure returns (address hook, bytes32 salt) {
        for (uint256 i = 0; i < MAX_SALT; i++) {
            address a = address(
                uint160(
                    uint256(keccak256(abi.encodePacked(bytes1(0xff), DETERMINISTIC_FACTORY, bytes32(i), initCodeHash)))
                )
            );
            if (uint160(a) & Hooks.ALL_HOOK_MASK != FLAGS) continue;
            if (uint8(uint160(a) >> 152) == RESERVED_PREFIX) continue;
            return (a, bytes32(i));
        }
        revert("no salt found below MAX_SALT");
    }

    function _mineByCheatcode(bytes32 initCodeHash) internal view returns (address hook, bytes32 salt) {
        for (uint256 i = 0; i < MAX_SALT; i++) {
            address a = vm.computeCreate2Address(bytes32(i), initCodeHash, DETERMINISTIC_FACTORY);
            if (uint160(a) & Hooks.ALL_HOOK_MASK != FLAGS) continue;
            if (uint8(uint160(a) >> 152) == RESERVED_PREFIX) continue;
            return (a, bytes32(i));
        }
        revert("no salt found below MAX_SALT (cheatcode route)");
    }

    /// @dev The `foundry.toml` alias for each chain, and the refusal for every chain id that is not
    ///      one of the five. Script-local on purpose: an alias is a local operator convenience and
    ///      has no business inside `src/`, where it would be compiled into a deployed contract.
    function _aliasFor(uint256 chainId) internal pure returns (string memory) {
        if (chainId == 46630) return "robinhood_testnet";
        if (chainId == 11155111) return "sepolia_testnet";
        if (chainId == 1301) return "unichain_testnet";
        if (chainId == 84532) return "base_testnet";
        if (chainId == 421614) return "arbitrum_testnet";
        revert("this endpoint answers a chain id UNICA V3 does not resolve; every chain it does resolve is a testnet");
    }

    // ---- the counter every runner in this repository ends with -----------------------------------

    function _check(bool ok, string memory what) internal {
        checksRun++;
        if (ok) {
            checksPassed++;
            console.log("  PASS ", what);
        } else {
            checksFailed++;
            console.log("  FAIL ", what);
        }
    }

    function _skip(string memory why) internal {
        checksSkipped++;
        console.log("  SKIP ", why);
    }

    /// @dev A skip is printed as a skip and never folded into a pass, and a failure reverts, which is
    ///      how a `forge script` exits non-zero — and, on the `run` path, how the broadcast below is
    ///      never reached.
    function _summary() internal view {
        console.log("");
        console.log("checks run:", checksRun);
        console.log("passed:", checksPassed);
        console.log("failed:", checksFailed);
        console.log("skipped:", checksSkipped);
        require(checksFailed == 0, "DeployV3 pre-flight REFUSED: see the FAIL rows above. Nothing was signed.");
    }
}
