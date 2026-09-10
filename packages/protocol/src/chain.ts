/**
 * The chains UNICA knows about, and the distinction the contracts insist on.
 *
 * `UnicaDeploymentsV3.routing()` resolves a routing stack for FIVE chain ids. `payoutCurrency()`
 * names a verified token for only FOUR of them, and reverts with a *different* error for the
 * fifth — `PayoutCurrencyNotVerified` rather than `UnsupportedChainId`. That is not an oversight
 * to be tidied away: a settlement is a promise to pay a specific token, and a chain with no
 * verified token cannot make that promise. Two facts, two errors, and a caller that catches one
 * must not silently absorb the other.
 *
 * So this module keeps them apart too. `ROUTED_CHAIN_IDS` is where the router stack resolves.
 * `SETTLEMENT_CHAIN_IDS` is where a payment can actually complete. Only the second is safe to
 * offer a merchant.
 */

/** A chain whose routing stack `UnicaDeploymentsV3` resolves. */
export const ROUTED_CHAIN_IDS = [46630, 11155111, 1301, 84532, 421614] as const;

/** A chain that additionally has a verified payout token, so a settlement can complete on it. */
export const SETTLEMENT_CHAIN_IDS = [11155111, 1301, 84532, 421614] as const;

export type RoutedChainId = (typeof ROUTED_CHAIN_IDS)[number];
export type SettlementChainId = (typeof SETTLEMENT_CHAIN_IDS)[number];

export interface ChainMetadata {
  readonly id: RoutedChainId;
  readonly name: string;
  /** Short label for a chip or a breadcrumb, where the full name does not fit. */
  readonly shortName: string;
  /** Every chain UNICA is deployed on is a testnet. Stated as data so no view has to assume it. */
  readonly isTestnet: true;
  readonly nativeCurrency: { readonly symbol: string; readonly decimals: 18 };
  /**
   * Block explorer origin, no trailing slash — or `null` where this repository has not verified
   * one. Only Ethereum Sepolia's is evidenced (it is pinned in the shipped page and used in the
   * committed proof rows). The other four are deliberately left null rather than filled in from
   * general knowledge: a proof link that 404s is worse than an absent one, and the whole claim of
   * this project is that its artifacts are checkable.
   */
  readonly explorer: string | null;
  /** False where `payoutCurrency()` reverts — the chain routes but cannot settle. */
  readonly canSettle: boolean;
}

const METADATA: { readonly [K in RoutedChainId]: ChainMetadata } = {
  46630: {
    id: 46630,
    name: "Robinhood testnet",
    shortName: "Robinhood",
    isTestnet: true,
    nativeCurrency: { symbol: "ETH", decimals: 18 },
    explorer: null, // no explorer verified for 46630; docs/chains/ROBINHOOD.md records none
    // Routes, but no USDC was found on it when the table was read, so the contracts refuse to
    // deploy here at all rather than name an unverified token. Note also that the tokenized
    // equities are NOT on this chain: docs/chains/ROBINHOOD.md records all 194 of Robinhood's
    // stock-token deployments on chain 4663, with zero on 46630, and the canonical mainnet TSLA,
    // WETH and USDG addresses reading back empty here.
    canSettle: false,
  },
  11155111: {
    id: 11155111,
    name: "Ethereum Sepolia",
    shortName: "Sepolia",
    isTestnet: true,
    nativeCurrency: { symbol: "ETH", decimals: 18 },
    explorer: "https://sepolia.etherscan.io",
    canSettle: true,
  },
  1301: {
    id: 1301,
    name: "Unichain Sepolia",
    shortName: "Unichain",
    isTestnet: true,
    nativeCurrency: { symbol: "ETH", decimals: 18 },
    explorer: null, // not yet verified in this repository
    canSettle: true,
  },
  84532: {
    id: 84532,
    name: "Base Sepolia",
    shortName: "Base",
    isTestnet: true,
    nativeCurrency: { symbol: "ETH", decimals: 18 },
    explorer: null, // not yet verified in this repository
    canSettle: true,
  },
  421614: {
    id: 421614,
    name: "Arbitrum Sepolia",
    shortName: "Arbitrum",
    isTestnet: true,
    nativeCurrency: { symbol: "ETH", decimals: 18 },
    explorer: null, // not yet verified in this repository
    canSettle: true,
  },
};

export function isRoutedChainId(id: number): id is RoutedChainId {
  return (ROUTED_CHAIN_IDS as readonly number[]).includes(id);
}

export function isSettlementChainId(id: number): id is SettlementChainId {
  return (SETTLEMENT_CHAIN_IDS as readonly number[]).includes(id);
}

/**
 * Metadata for a routed chain. Throws on anything else rather than returning a partial object —
 * a view that renders "undefined" for a chain name has already lost the argument.
 */
export function chainMetadata(id: RoutedChainId): ChainMetadata {
  return METADATA[id];
}

export function chainMetadataOrNull(id: number): ChainMetadata | null {
  return isRoutedChainId(id) ? METADATA[id] : null;
}

/** `0x`-prefixed lower-case chain id, the shape `eth_chainId` and `wallet_switchEthereumChain` use. */
export function toChainIdHex(id: number): string {
  return "0x" + id.toString(16);
}

/**
 * Explorer links, or `null` where no explorer is verified for the chain. Callers must handle the
 * null — rendering the string "null/tx/0x..." as a href is exactly the failure this shape exists
 * to prevent, and it is the failure that happens when a builder returns a string unconditionally.
 */
export function explorerTransactionUrl(id: RoutedChainId, transactionHash: string): string | null {
  const base = METADATA[id].explorer;
  return base === null ? null : `${base}/tx/${transactionHash}`;
}

export function explorerAddressUrl(id: RoutedChainId, address: string): string | null {
  const base = METADATA[id].explorer;
  return base === null ? null : `${base}/address/${address}`;
}

export function explorerBlockUrl(id: RoutedChainId, block: number | bigint): string | null {
  const base = METADATA[id].explorer;
  return base === null ? null : `${base}/block/${block}`;
}

/** Whether this chain can offer a proof link at all. */
export function hasExplorer(id: RoutedChainId): boolean {
  return METADATA[id].explorer !== null;
}
