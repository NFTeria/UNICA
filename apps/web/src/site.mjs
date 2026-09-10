/**
 * Site-wide configuration. No secret, no endpoint that needs one, nothing environment-dependent.
 *
 * BASE PATH. GitHub Pages serves a project site under `/<repo>/`, so an absolute `/assets/x.css`
 * resolves to the wrong origin path. Every link this generator emits is therefore RELATIVE and
 * computed from the route's own depth. That makes the output work at a domain root, under a project
 * path, and behind an IPFS CID prefix without a build-time base-path variable to get wrong.
 */
export const SITE = {
  name: "UNICA",
  tagline: "A Uniswap v4 settlement hook, and the payment application built on it.",
  repo: "https://github.com/NFTeria/UNICA",
  /** The single approved public claim. Reproduced verbatim; `script/check-surface.sh` owns it. */
  approvedClaim:
    "UNICA demonstrates a live, verified USDC settlement flow on Uniswap v4 Sepolia, with order-bound full-fill enforcement and an indexable receipt.",
};

/** The live V3 deployment, pinned. Every value here is public and already on the shipped page. */
export const V3 = {
  chainId: 11155111,
  chainName: "Ethereum Sepolia",
  executor: "0x015692C9E43ca19a2504F79368D1156A56680517",
  hook: "0x5d6AdF56facB123A2e46D36EA7034cb393D6A0c0",
  poolManager: "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543",
  stateView: "0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C",
  payout: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  poolId: "0xf9b873f83814234224be42592795ec812fb948a300188e0c597796171ab9c57a", // V3 pool id
  fee: 3000,
  tickSpacing: 60,
  deployBlock: 11667702,
  releaseTag: "v3-settled-indexed",
  releaseCommit: "8cdf141",
  explorer: "https://sepolia.etherscan.io",
  amountIn: "0.001",
};

/** The experimental subject. Nothing here is deployed and nothing here settles. */
export const EXPERIMENT = {
  chainId: 46630,
  chainName: "Robinhood testnet",
  explorer: "https://explorer.testnet.chain.robinhood.com",
  inputSymbol: "TSLA",
  inputToken: "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E",
  payoutName: "UNICA Test Dollar",
  payoutSymbol: "uTUSD",
  referenceVenueFee: 3000,
  referenceVenueSpacing: 60,
};
