/**
 * The deterministic world the mocks read from.
 *
 * No `Date.now()`, no `Math.random()`, no network, no timers. Every hash is derived from a counter,
 * every timestamp comes from an injected `ManualClock`, and running the same scenario twice
 * produces byte-identical output — which the tests assert rather than assume.
 *
 * The fixtures are the real Sepolia deployment and its real settlements, so a mocked run and a live
 * run render the same shapes and the same magnitudes. A mock built on 1.0 and 2.0 hides every
 * formatting and precision bug that only appears at 2.216294.
 */

import {
  OrderStatus,
  ZERO_ADDRESS,
  ZERO_POLICY_ID,
  type Order,
  type OrderId,
  type Quote,
  type SettlementChainId,
  type SettlementReceipt,
} from "@unica/protocol";
import { ManualClock } from "../clock.js";
import type { Address } from "../contracts.js";

export const FIXTURE = {
  chainId: 11155111 as SettlementChainId,
  hook: "0x5d6AdF56facB123A2e46D36EA7034cb393D6A0c0",
  executor: "0x015692C9E43ca19a2504F79368D1156A56680517",
  payoutToken: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  merchant: "0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73",
  payer: "0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73",
  merchantName: "unica.eth",
  amountIn: 10n ** 15n,
  minOut: 500_000n,
  // The five real V3 settlements, newest first, in USDC's smallest unit.
  amountsOut: [1_024_770n, 1_210_685n, 1_452_240n, 1_774_099n, 2_216_294n] as const,
  startBlock: 11_676_042n,
  startSeconds: 1_789_057_411n,
  poolKey: {
    currency0: ZERO_ADDRESS,
    currency1: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    fee: 3000,
    tickSpacing: 60,
    hooks: "0x5d6AdF56facB123A2e46D36EA7034cb393D6A0c0",
  },
} as const;

/** A stable 32-byte value from a counter. Deterministic by construction, unique by prefix. */
export function deterministicHash(prefix: string, n: number): string {
  const tag = [...prefix].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  return "0x" + (tag + n.toString(16).padStart(8, "0")).padEnd(64, "0").slice(0, 64);
}

export interface MockConfig {
  /** Orders the world starts with. */
  readonly orders?: readonly Order[];
  /** Settlement history the indexer will answer with. */
  readonly receipts?: readonly SettlementReceipt[];
  /** What the wallet reports. A value other than the adapter's chain is the wrong-chain case. */
  readonly walletChainId?: number;
  readonly accounts?: readonly Address[];
  /** Reads fail with transport-unavailable when true. */
  readonly chainUnavailable?: boolean;
  /** The indexer answers, but behind the chain by this many blocks. */
  readonly indexerLagBlocks?: bigint | null;
  readonly indexerUnavailable?: boolean;
  /** The next sendTransaction mines with this status. */
  readonly receiptStatus?: 0 | 1;
  readonly revertReason?: string | null;
  readonly quoteOut?: bigint;
}

export class MockWorld {
  readonly clock: ManualClock;
  readonly config: Required<Omit<MockConfig, "orders" | "receipts">>;
  readonly orders = new Map<OrderId, Order>();
  readonly receipts: SettlementReceipt[] = [];
  blockNumber: bigint;
  #nonce = 0;

  constructor(config: MockConfig = {}) {
    this.clock = new ManualClock(FIXTURE.startSeconds);
    this.blockNumber = FIXTURE.startBlock;
    this.config = {
      walletChainId: config.walletChainId ?? FIXTURE.chainId,
      accounts: config.accounts ?? [FIXTURE.payer],
      chainUnavailable: config.chainUnavailable ?? false,
      indexerLagBlocks: config.indexerLagBlocks ?? 0n,
      indexerUnavailable: config.indexerUnavailable ?? false,
      receiptStatus: config.receiptStatus ?? 1,
      revertReason: config.revertReason ?? null,
      quoteOut: config.quoteOut ?? FIXTURE.amountsOut[0],
    };
    for (const o of config.orders ?? []) this.orders.set(o.id.toLowerCase(), o);
    this.receipts.push(...(config.receipts ?? []));
  }

  nextHash(prefix: string): string {
    return deterministicHash(prefix, ++this.#nonce);
  }

  makeOrder(over: Partial<Order> = {}): Order {
    const id = over.id ?? deterministicHash("order", this.orders.size + 1);
    const order: Order = {
      id,
      chainId: FIXTURE.chainId,
      recipient: FIXTURE.merchant,
      creator: FIXTURE.merchant,
      payer: ZERO_ADDRESS,
      key: { ...FIXTURE.poolKey },
      amountIn: FIXTURE.amountIn,
      minOut: FIXTURE.minOut,
      deadline: this.clock.nowSeconds() + 3600n,
      status: OrderStatus.Open,
      ...over,
    };
    this.orders.set(order.id.toLowerCase(), order);
    return order;
  }

  makeReceipt(over: Partial<SettlementReceipt> = {}): SettlementReceipt {
    const n = this.receipts.length;
    const receipt: SettlementReceipt = {
      orderId: deterministicHash("order", n + 1),
      chainId: FIXTURE.chainId,
      recipient: FIXTURE.merchant,
      payer: FIXTURE.payer,
      amountIn: FIXTURE.amountIn,
      amountOut: FIXTURE.amountsOut[n % FIXTURE.amountsOut.length] ?? FIXTURE.amountsOut[0],
      fee: 0n,
      policyId: ZERO_POLICY_ID,
      transactionHash: deterministicHash("settle", n + 1),
      blockNumber: FIXTURE.startBlock - BigInt(n),
      logIndex: 26 - n,
      ...over,
    };
    this.receipts.push(receipt);
    return receipt;
  }

  makeQuote(amountOut: bigint = this.config.quoteOut): Quote {
    return {
      amountIn: FIXTURE.amountIn,
      amountOut,
      payoutDecimals: 6,
      atBlock: this.blockNumber,
      readAtSeconds: this.clock.nowSeconds(),
    };
  }
}
