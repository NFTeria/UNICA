/**
 * The five adapter contracts.
 *
 * Nothing here imports a framework, a wallet library, or a network client, and nothing here is
 * async-optional: every method that crosses a boundary returns a Promise, so a mock and a real
 * implementation have the same shape and no call site changes when one replaces the other.
 *
 * The read/write split is at the type level rather than by convention. `BlockchainAdapter` cannot
 * sign — it has no method that could. Everything that moves value is on `WalletAdapter`, and there
 * are exactly three such methods, which makes the surface a person can audit in one sitting.
 */

import type {
  Order,
  OrderId,
  Quote,
  RoutedChainId,
  SettlementChainId,
  SettlementReceipt,
} from "@unica/protocol";

export type Address = string;
export type Hash = string;
export type Hex = string;

/** Read-only chain access. Cannot sign, by construction. */
export interface BlockchainAdapter {
  readonly chainId: SettlementChainId;
  /** The chain the endpoint actually reports, for the disagreement case. */
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  /** Settlements the hook has receipted. The chain's own count, not the indexer's. */
  getReceiptCount(): Promise<bigint>;
  getOrderCount(): Promise<bigint>;
  getOrder(id: OrderId): Promise<Order>;
  /** Runtime code size, for proving an address holds the build it claims to. */
  getCodeSize(address: Address): Promise<number>;
  /** The recipient's payout-token balance, which is what settlement is actually measured against. */
  getPayoutBalance(address: Address): Promise<bigint>;
}

/** Wallet access. Every method that can move value is here, and there are three. */
export interface WalletAdapter {
  isPresent(): boolean;
  /** Accounts already granted. Never prompts, so it is safe on every page load. */
  getAccounts(): Promise<Address[]>;
  getChainId(): Promise<number>;
  /** Prompts. */
  requestAccounts(): Promise<Address[]>;
  /** Prompts. */
  switchChain(chainId: RoutedChainId): Promise<void>;
  /** Prompts, and is the only method that can broadcast. */
  sendTransaction(tx: { to: Address; value: bigint; data: Hex }): Promise<Hash>;
  waitForReceipt(hash: Hash): Promise<{ status: 0 | 1; blockNumber: bigint; logs: readonly RawLog[] }>;
}

export interface RawLog {
  readonly address: Address;
  readonly topics: readonly Hex[];
  readonly data: Hex;
  readonly logIndex: number;
}

/** Name resolution. Read-only on purpose: nothing in the customer app may mutate a name record. */
export interface IdentityAdapter {
  /**
   * Resolves a merchant name to the address an order will be created against.
   *
   * Fails closed. An unset record resolves to nothing rather than to the zero address, because the
   * zero address is a valid-looking value that would sail through a truthiness check and produce an
   * order paying nobody.
   */
  resolve(name: string): Promise<{ name: string; address: Address }>;
  /** Whether a scoped delegation is currently held. Display only; settlement never depends on it. */
  getDelegation(name: string): Promise<{ agent: Address; resource: Hex; held: boolean } | null>;
}

export interface QuoteAdapter {
  /** What the pool would pay out right now for this order's fixed input. */
  quote(order: Pick<Order, "key" | "amountIn">): Promise<Quote>;
}

/**
 * Settlement history.
 *
 * `getLatest` and `listForOrder` may answer `indexer-behind` — an answer, not a failure. The
 * distinction between "the indexer has nothing" and "the indexer could not be reached" is the one
 * the shipped page already makes loudly, and it is preserved here rather than rediscovered.
 */
export interface IndexerAdapter {
  readonly kind: "indexer" | "chain-fallback";
  getLatest(limit: number): Promise<readonly SettlementReceipt[]>;
  listForOrder(id: OrderId): Promise<readonly SettlementReceipt[]>;
  /** How far behind the chain the index is, or null when it cannot be established. */
  getLagBlocks(): Promise<bigint | null>;
}

/** Everything the application needs, in one bag, so a runtime mode is one object to swap. */
export interface AdapterSet {
  readonly blockchain: BlockchainAdapter;
  readonly wallet: WalletAdapter;
  readonly identity: IdentityAdapter;
  readonly quotes: QuoteAdapter;
  readonly indexer: IndexerAdapter;
}
