// A COMMITTED fixture of the local deployment manifest's SHAPE, for apps/web/tests/serve-config.test.mjs.
//
// WHY THIS FILE EXISTS. The serve-config rows used to read `deployments/31337.local.json`, under a
// test named "the committed local manifest". That file is not committed: `.gitignore` carries
// `deployments/31337*`, and every `make business-demo` and `make anvil-test` regenerates it. So the
// rows were asserting against locally generated state, and when the direct-settlement work made the
// deploy write a `directSettlement` address into it, a row that asserted `directSettlement === null`
// started failing on any machine that had run the demo. The state had legitimately moved on; the
// test had frozen a moment of it.
//
// A test about what `runtimeConfig` DOES with a manifest needs a manifest it owns. This is that
// manifest: hand written from the shape the anvil deploy produces, carrying one value per field the
// served configuration reads and nothing else. It is not a capture, it names no real deployment,
// and it is not evidence of anything on any chain. The addresses are the well-known deterministic
// local ones; the local tokens are uUSD, a local test dollar, and tAST, a local test asset.
//
// The runtime manifest is still checked, in its own row, and only when it is present. That row
// asserts the server serves whatever it carries, rather than a value frozen when the row was
// written.
//
// LOCAL_ANVIL_NO_VALUE. Nothing here has value and nothing here is a price.

export const UUSD = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
export const TAST = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";

/// The labels a server reads off the chain before it will name an asset on a screen. Kept beside
/// the fixture because an asset is only ever listed with a label that was actually read.
export const LOCAL_TOKEN_LABELS = {
  [UUSD.toLowerCase()]: { symbol: "uUSD", decimals: 6 },
  [TAST.toLowerCase()]: { symbol: "tAST", decimals: 18 },
};

export const LOCAL_MANIFEST = {
  environment: "LOCAL_ANVIL_NO_VALUE",
  chainId: 31337,
  contracts: {
    payoutToken: { address: UUSD },
    assetToken: { address: TAST },
    poolManager: { address: "0x5FbDB2315678afecb367f032d93F642f64180aa3" },
    oracleAdapter: { address: "0x0B306BF915C4d645ff596e518fAf3F9669b97016" },
    registry: { address: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9" },
    hook: { address: "0x3A2cf49e4635fDF8b8EA80a8A4E191043325E0c0" },
    executor: { address: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9" },
    directSettlement: { address: "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707" },
    identityFixture: { address: "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6" },
    identityToken: { address: "0x8A791620dd6260079BF849Dc5567aDC3F2FdC318" },
    merchantOnboarding: { address: "0x610178dA211FEF7D417bC0e6FeD39F05609AD788" },
    terminalAdmission: { address: "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853" },
  },
  market: {
    marketId: "0x0000000000000000000000000000000000000000000000000000000000000a01", // bytes32, a fixture value
    version: 1,
    poolKey: { currency0: UUSD, currency1: TAST, fee: 3000, tickSpacing: 60 },
    poolId: "0x0000000000000000000000000000000000000000000000000000000000000b02", // pool id, a fixture value
    status: 4, // ACTIVE in the frozen status numbering of src/unica-v4/UnicaMarketTypes.sol
  },
  identity: {
    parentName: "unica.eth",
    parentNode: "0x0000000000000000000000000000000000000000000000000000000000000c03", // bytes32 namehash, a fixture value
    terminalStatusKey: "com.unica.terminal-status",
  },
};

/// The same deployment BEFORE the direct settler was part of it, which is the case the served
/// configuration answers `null` for. One field differs from `LOCAL_MANIFEST`, so a row that uses
/// this one and a row that uses that one differ by exactly the thing under test.
export const LOCAL_MANIFEST_WITHOUT_DIRECT_SETTLER = {
  ...LOCAL_MANIFEST,
  contracts: Object.fromEntries(
    Object.entries(LOCAL_MANIFEST.contracts).filter(([key]) => key !== "directSettlement"),
  ),
};
