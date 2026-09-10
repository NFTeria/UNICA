/**
 * Named worlds, one per state a checkout can actually be in.
 *
 * These are the states a person hits, not the states that are easy to construct: a reverted
 * payment, an expired link, a wallet on the wrong network, an unreachable RPC, and an indexer that
 * answers but is behind. Every one of them was reachable in the shipped page and none of them had a
 * dedicated view, which is precisely why they are enumerated before any view is written.
 */

import { OrderStatus } from "@unica/protocol";
import { FIXTURE, MockWorld } from "./world.js";
import { mockAdapters } from "./adapters.js";
import type { AdapterSet } from "../contracts.js";

export type ScenarioName =
  | "success"
  | "pending"
  | "reverted"
  | "expired"
  | "settled"
  | "wrongNetwork"
  | "noWallet"
  | "rpcUnavailable"
  | "indexerDelayed"
  | "indexerUnavailable";

export interface Scenario {
  readonly name: ScenarioName;
  readonly describe: string;
  readonly world: MockWorld;
  readonly adapters: AdapterSet;
  readonly orderId: string;
}

function build(name: ScenarioName, describe: string, make: (w: MockWorld) => string, config = {}): Scenario {
  const world = new MockWorld(config);
  for (let i = 0; i < 5; i++) world.makeReceipt();
  const orderId = make(world);
  return { name, describe, world, adapters: mockAdapters(world), orderId };
}

export const SCENARIOS: { readonly [K in ScenarioName]: () => Scenario } = {
  success: () =>
    build("success", "an open order, a fresh quote, a wallet on the right chain", (w) => w.makeOrder().id),
  pending: () =>
    build(
      "pending",
      "the order has been paid and is mid-settlement",
      (w) => w.makeOrder({ status: OrderStatus.Paying, payer: FIXTURE.payer }).id,
    ),
  settled: () =>
    build(
      "settled",
      "the order is already settled; the way back is a new order",
      (w) => w.makeOrder({ status: OrderStatus.Settled, payer: FIXTURE.payer }).id,
    ),
  reverted: () =>
    build("reverted", "the transaction mines with status 0 and nothing moves", (w) => w.makeOrder().id, {
      receiptStatus: 0,
    }),
  expired: () =>
    build(
      "expired",
      "the link outlived its deadline",
      (w) => w.makeOrder({ deadline: FIXTURE.startSeconds - 1n }).id,
    ),
  wrongNetwork: () =>
    build("wrongNetwork", "the wallet is connected to another chain", (w) => w.makeOrder().id, {
      walletChainId: 1,
    }),
  noWallet: () => build("noWallet", "no injected wallet at all", (w) => w.makeOrder().id, { accounts: [] }),
  rpcUnavailable: () =>
    build(
      "rpcUnavailable",
      "every chain read fails; the page must say so, not show zero",
      (w) => w.makeOrder().id,
      { chainUnavailable: true },
    ),
  indexerDelayed: () =>
    build("indexerDelayed", "the index answers, behind the chain", (w) => w.makeOrder().id, {
      indexerLagBlocks: 12n,
    }),
  indexerUnavailable: () =>
    build(
      "indexerUnavailable",
      "the index cannot be reached; distinct from having nothing",
      (w) => w.makeOrder().id,
      { indexerUnavailable: true },
    ),
};

export const SCENARIO_NAMES = Object.keys(SCENARIOS) as readonly ScenarioName[];
