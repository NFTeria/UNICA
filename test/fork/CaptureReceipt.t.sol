// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Vm} from "forge-std/Vm.sol";
import {IQuoteSettlement} from "../../src/v2/interfaces/IQuoteSettlement.sol";
import {MerchantConfig} from "../../src/v2/MerchantConfig.sol";
import {V2ForkFixture} from "./util/V2ForkFixture.sol";

/// @title The fixture the V2 indexer's tests are built from, captured rather than invented
/// @notice A subgraph fixture written by hand is a subgraph tested against somebody's idea of a
///         receipt. This prints one REAL receipt, emitted by the real executor during a real
///         settlement against the pinned fork, and `integrations/graph-v2/tests` uses exactly these
///         values. If the receipt ever changes shape, the numbers here stop matching and the
///         indexer's tests are wrong in a way somebody has to look at.
contract CaptureReceiptForkTest is V2ForkFixture {
    function setUp() public {
        _setUpForkV2();
    }

    /// @dev The two derivations of the merchant configuration commitment, compared on the fork
    ///      rather than only locally — because the quote every row here settles now COMMITS to a
    ///      real resolution instead of `keccak256("fork merchant config")`, a word with no preimage
    ///      that no verifier could ever have been handed. `tools/unica-verify` needs the preimage to
    ///      close `docs/v2/COMPATIBILITY-001.md`, and a preimage that Solidity and the offline
    ///      encoder disagree about would close nothing.
    function test_ForkCapture_TheMerchantConfigurationAgreesWithTheOfflineDerivation() public view {
        assertEq(
            MerchantConfig.hash(_forkMerchantConfig()),
            FORK_CONFIG_HASH,
            "the on-chain and offline derivations of the fork merchant configuration disagree"
        );
        assertEq(
            _quote(bytes32("fork-1"), 100e6, 1e18).merchantConfigHash,
            FORK_CONFIG_HASH,
            "the fork quote does not commit to the configuration this fixture describes"
        );
    }

    function test_ForkCapture_PrintTheReceiptTheIndexerIsTestedAgainst() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("fork-1"), 100e6, 1e18);

        vm.recordLogs();
        vm.prank(relayer);
        (uint256 actualIn, uint256 deliveredOut) = executor.settle(q, _signQuoteAs(q, merchantKey), _auth(q, 0));

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topic = keccak256(
            "QuoteSettled(bytes32,address,address,uint16,bytes32,address,address,bytes32,address,uint256,uint256,address,uint256,uint256,uint32)"
        );
        uint256 found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length == 0 || logs[i].topics[0] != topic) continue;
            found++;
            emit log_string("---- captured V2 receipt, pinned Sepolia fork ----");
            emit log_named_address("emitter (executor)", logs[i].emitter);
            emit log_named_bytes32("topic0            ", logs[i].topics[0]);
            emit log_named_bytes32("quoteId           ", logs[i].topics[1]);
            emit log_named_address("recipient         ", address(uint160(uint256(logs[i].topics[2]))));
            emit log_named_address("payer             ", address(uint160(uint256(logs[i].topics[3]))));
            emit log_named_bytes32("quoteDigest       ", _quoteDigest(q));
            emit log_named_address("merchantSigner    ", q.merchantSigner);
            emit log_named_address("hook              ", q.hook);
            emit log_named_bytes32("poolId            ", _poolId(q));
            emit log_named_address("tokenIn           ", q.tokenIn);
            emit log_named_uint("actualIn          ", actualIn);
            emit log_named_uint("maxIn             ", q.maxIn);
            emit log_named_address("tokenOut          ", q.tokenOut);
            emit log_named_uint("amountOut         ", q.amountOut);
            emit log_named_uint("deliveredOut      ", deliveredOut);
            emit log_named_uint("policyVersion     ", q.policyVersion);
            emit log_named_uint("blockNumber       ", block.number);
            emit log_named_uint("blockTimestamp    ", block.timestamp);
            emit log_named_bytes32("data keccak       ", keccak256(logs[i].data));
        }
        assertEq(found, 1, "expected exactly one receipt to capture");
    }
}
