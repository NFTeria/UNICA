/**
 * The states a confidential-orchestration surface must be able to render.
 *
 * TYPES ONLY. Nothing here is connected to the published `web/` surface, and no adapter
 * implementation exists yet. They are defined now so the states are enumerated before any view is
 * written — the same reason the payment phases were.
 *
 * The distinction that matters most is between `waitlisted`, `deploymentUnavailable` and
 * `liveCapabilityUnavailable`. They are three different sentences and three different next actions,
 * and a surface that collapses them into "unavailable" tells an operator nothing.
 */

// EvidenceClass is declared once, in evidence.ts, beside the guards that police it. Re-declaring
// it here would let the two drift, and a second definition of "confirmed" is exactly the defect
// the guards exist to prevent.
import type { EvidenceClass } from "./evidence.js";
export type { EvidenceClass };

export type WorkflowState =
  /** Access to hosted Confidential Workflows is requested and under review. Not a failure. */
  | { readonly kind: "waitlisted" }
  /** The local simulator is installed and usable. Nothing is deployed. */
  | { readonly kind: "simulator-available"; readonly cliVersion: string }
  | { readonly kind: "simulation-running" }
  /** The workflow decided not to proceed. `reason` is a verdict code, never a private value. */
  | { readonly kind: "simulation-rejected"; readonly reason: string }
  /** A simulation passed. This is NOT a settlement and must never be rendered as one. */
  | { readonly kind: "simulation-passed"; readonly evidence: "mock" | "simulated" }
  /** Deployment is not available to this account. Distinct from the capability being absent. */
  | { readonly kind: "deployment-unavailable" }
  /** Deployed, but a hosted capability (chain read/write/log trigger) is not available. */
  | { readonly kind: "live-capability-unavailable" }
  | { readonly kind: "live-capability-enabled" }
  | { readonly kind: "chain-unsupported"; readonly chainId: number }
  /** The only state that may claim a settlement happened. Requires a confirmed transaction. */
  | { readonly kind: "confirmed-settlement"; readonly transactionHash: string; readonly chainId: number };

/**
 * Whether a state may be presented to a person as a completed payment.
 *
 * Exactly one state qualifies. A simulation that passed is not a settlement, and the whole reason
 * this predicate exists rather than a truthiness check is that `simulation-passed` reads like
 * success and is not.
 */
export function isSettlementProven(state: WorkflowState): boolean {
  return state.kind === "confirmed-settlement";
}
