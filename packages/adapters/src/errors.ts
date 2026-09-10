/**
 * Every way an adapter is allowed to fail.
 *
 * A closed union, on purpose. The rule it enforces is that **no raw provider error ever reaches a
 * view**: MetaMask's `-32002`, a fetch `TypeError`, a subgraph 502 and an RPC rate limit are four
 * unrelated objects with four unrelated shapes, and a component that renders `err.message` for all
 * of them produces "something went wrong" — which tells a payer nothing and hides the one case
 * they can actually act on.
 *
 * Each kind here corresponds to a different sentence and a different next action, which is the
 * only reason for a kind to exist. Adding one means there is a genuinely new thing to say.
 */

export type AdapterErrorKind =
  /** The wallet already has a prompt open. The action is to look at the wallet, not to retry. */
  | "wallet-busy"
  /** The person closed the wallet. Not an error — offer the action again and say nothing alarming. */
  | "wallet-dismissed"
  /** No injected wallet at all. The action is to install or unlock one. */
  | "wallet-absent"
  /** Connected, but to a chain this deployment is not on. The action is to switch. */
  | "wrong-chain"
  /** The wallet does not know the chain and must be asked to add it. */
  | "unknown-chain"
  /** The read endpoint did not answer. Distinct from an empty answer, always. */
  | "transport-unavailable"
  /** The endpoint answered with an error payload. */
  | "transport-error"
  /** The indexer answered, but is behind the chain. The data is real and stale, not absent. */
  | "indexer-behind"
  /** The chain reverted. `reason` carries the decoded custom error when one was decodable. */
  | "reverted"
  /** The thing asked for does not exist. An empty answer, and a successful read. */
  | "not-found";

export class AdapterError extends Error {
  readonly kind: AdapterErrorKind;
  /** Payer-facing, already written for a human. Never a provider string. */
  readonly display: string;
  override readonly cause?: unknown;

  constructor(kind: AdapterErrorKind, display: string, cause?: unknown) {
    super(`${kind}: ${display}`);
    this.name = "AdapterError";
    this.kind = kind;
    this.display = display;
    if (cause !== undefined) this.cause = cause;
  }
}

export function isAdapterError(e: unknown): e is AdapterError {
  return e instanceof AdapterError;
}

/**
 * The provider codes worth naming, mapped once. EIP-1193 numbers the first three; a component that
 * re-derives this mapping is a component that will get `-32002` wrong the same way the shipped page
 * did before it was fixed.
 */
export function fromProviderCode(code: number, cause?: unknown): AdapterError {
  switch (code) {
    case 4001:
      return new AdapterError("wallet-dismissed", "The request was dismissed in the wallet.", cause);
    case 4902:
      return new AdapterError("unknown-chain", "The wallet does not know this network yet.", cause);
    case -32002:
      return new AdapterError(
        "wallet-busy",
        "Your wallet already has a request open. Approve or dismiss it in the wallet window, then try again.",
        cause,
      );
    default:
      return new AdapterError("transport-error", "The wallet could not complete the request.", cause);
  }
}
