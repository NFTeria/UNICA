/** The five adapters, backed entirely by a `MockWorld`. No network, no timers, no ambient time. */

import { AdapterError } from "../errors.js";
import type {
  Address,
  AdapterSet,
  BlockchainAdapter,
  Hash,
  Hex,
  IdentityAdapter,
  IndexerAdapter,
  QuoteAdapter,
  WalletAdapter,
} from "../contracts.js";
import { gateWallet } from "../wallet-gate.js";
import { FIXTURE, MockWorld } from "./world.js";
import { OrderStatus, type OrderId, type RoutedChainId } from "@unica/protocol";

const unavailable = () =>
  new AdapterError(
    "transport-unavailable",
    "The network could not be reached. This is a failed read, not an empty result.",
  );

export function mockBlockchain(world: MockWorld): BlockchainAdapter {
  const guard = () => {
    if (world.config.chainUnavailable) throw unavailable();
  };
  return {
    chainId: FIXTURE.chainId,
    async getChainId() {
      guard();
      return FIXTURE.chainId;
    },
    async getBlockNumber() {
      guard();
      return world.blockNumber;
    },
    async getReceiptCount() {
      guard();
      return BigInt(world.receipts.length);
    },
    async getOrderCount() {
      guard();
      return BigInt(world.orders.size);
    },
    async getOrder(id: OrderId) {
      guard();
      const order = world.orders.get(id.toLowerCase());
      if (!order) throw new AdapterError("not-found", "No order with that id exists on this chain.");
      return order;
    },
    async getCodeSize(address: Address) {
      guard();
      if (address.toLowerCase() === FIXTURE.hook.toLowerCase()) return 10_634;
      if (address.toLowerCase() === FIXTURE.executor.toLowerCase()) return 12_953;
      return 0;
    },
    async getPayoutBalance() {
      guard();
      return world.receipts.reduce((sum, r) => sum + r.amountOut, 0n);
    },
  };
}

export function mockWallet(world: MockWorld): WalletAdapter {
  let granted: Address[] = [];
  const inner: WalletAdapter = {
    isPresent: () => world.config.accounts.length > 0,
    async getAccounts() {
      return granted;
    },
    async getChainId() {
      return world.config.walletChainId;
    },
    async requestAccounts() {
      if (!inner.isPresent()) throw new AdapterError("wallet-absent", "No wallet was found in this browser.");
      granted = [...world.config.accounts];
      return granted;
    },
    async switchChain(chainId: RoutedChainId) {
      if (chainId !== FIXTURE.chainId) {
        throw new AdapterError("unknown-chain", "The wallet does not know this network yet.");
      }
      (world.config as { walletChainId: number }).walletChainId = chainId;
    },
    async sendTransaction(_tx: { to: Address; value: bigint; data: Hex }) {
      if (world.config.walletChainId !== FIXTURE.chainId) {
        throw new AdapterError("wrong-chain", "Your wallet is on a different network than this payment.");
      }
      return world.nextHash("tx");
    },
    async waitForReceipt(hash: Hash) {
      world.blockNumber += 1n;
      if (world.config.receiptStatus === 0) {
        throw new AdapterError(
          "reverted",
          world.config.revertReason ?? "The payment was refused on chain and nothing moved.",
          { hash },
        );
      }
      return { status: 1 as const, blockNumber: world.blockNumber, logs: [] };
    },
  };
  // Wrapped, so the mock obeys the same one-request-at-a-time rule the browser adapter will.
  return gateWallet(inner);
}

export function mockIdentity(world: MockWorld): IdentityAdapter {
  return {
    async resolve(name: string) {
      if (world.config.chainUnavailable) throw unavailable();
      if (name.toLowerCase() !== FIXTURE.merchantName) {
        // Fails closed. An unset record is NOT the zero address — that value would pass a
        // truthiness check and produce an order that pays nobody.
        throw new AdapterError(
          "not-found",
          `${name} has no address record, so no order can be created for it.`,
        );
      }
      return { name: FIXTURE.merchantName, address: FIXTURE.merchant };
    },
    async getDelegation(name: string) {
      if (name.toLowerCase() !== FIXTURE.merchantName) return null;
      return {
        agent: "0x19E56831a10d43CfF5d77f886c799C6b916da7Ae",
        resource: "0x9b289d4e553d53cae7128b89eba6a145403bcf03abd52b51158be2191e070e6f",
        held: false,
      };
    },
  };
}

export function mockQuotes(world: MockWorld): QuoteAdapter {
  return {
    async quote() {
      if (world.config.chainUnavailable) throw unavailable();
      return world.makeQuote();
    },
  };
}

export function mockIndexer(world: MockWorld): IndexerAdapter {
  const guard = () => {
    if (world.config.indexerUnavailable) {
      throw new AdapterError(
        "transport-unavailable",
        "The settlement index could not be reached. This is a failed read, not an empty result.",
      );
    }
    const lag = world.config.indexerLagBlocks;
    if (lag !== null && lag > 0n) {
      throw new AdapterError(
        "indexer-behind",
        `The settlement index is ${lag} block(s) behind the chain. What it shows is real but not current.`,
      );
    }
  };
  return {
    kind: "indexer",
    async getLatest(limit: number) {
      guard();
      return world.receipts.slice(0, limit);
    },
    async listForOrder(id: OrderId) {
      guard();
      return world.receipts.filter((r) => r.orderId.toLowerCase() === id.toLowerCase());
    },
    async getLagBlocks() {
      if (world.config.indexerUnavailable) return null;
      return world.config.indexerLagBlocks;
    },
  };
}

export function mockAdapters(world: MockWorld): AdapterSet {
  return {
    blockchain: mockBlockchain(world),
    wallet: mockWallet(world),
    identity: mockIdentity(world),
    quotes: mockQuotes(world),
    indexer: mockIndexer(world),
  };
}

export { OrderStatus };
