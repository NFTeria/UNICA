/**
 * One wallet request at a time, enforced here rather than in a component.
 *
 * This exists because the shipped page met the failure it prevents: two prompts were issued for one
 * click — `eth_requestAccounts` followed by a permissions request — and the wallet answered the
 * second with `-32002`, "already pending", which the page then rendered raw. Three defects, one
 * cause: nothing owned the question of whether a request was already open.
 *
 * A component cannot own it. There are several buttons, a component can unmount mid-prompt, and any
 * fix living in a click handler has to be repeated in every other click handler. So it lives at the
 * adapter boundary, where there is exactly one of it, and any wrapped adapter inherits the rule.
 */

import { AdapterError } from "./errors.js";
import type { Address, Hash, Hex, WalletAdapter } from "./contracts.js";
import type { RoutedChainId } from "@unica/protocol";

export function gateWallet(inner: WalletAdapter): WalletAdapter {
  let busy = false;

  async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (busy) {
      throw new AdapterError(
        "wallet-busy",
        "Your wallet already has a request open. Approve or dismiss it in the wallet window, then try again.",
      );
    }
    busy = true;
    try {
      return await fn();
    } finally {
      busy = false;
    }
  }

  return {
    // Non-prompting reads stay OUTSIDE the gate deliberately. They run on every page load, they
    // never open a window, and putting them inside would let a slow read block the pay button.
    isPresent: () => inner.isPresent(),
    getAccounts: () => inner.getAccounts(),
    getChainId: () => inner.getChainId(),
    waitForReceipt: (hash: Hash) => inner.waitForReceipt(hash),

    requestAccounts: (): Promise<Address[]> => exclusive(() => inner.requestAccounts()),
    switchChain: (chainId: RoutedChainId): Promise<void> => exclusive(() => inner.switchChain(chainId)),
    sendTransaction: (tx: { to: Address; value: bigint; data: Hex }): Promise<Hash> =>
      exclusive(() => inner.sendTransaction(tx)),
  };
}
