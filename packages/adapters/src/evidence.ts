/**
 * Evidence classification, and the guards that stop it being promoted.
 *
 * THE RULE. `confirmed` means a real, confirmed transaction on a real chain. `mock` means fixture
 * data. `simulated` means a local chain or the CRE local simulator. The danger is not that someone
 * writes `confirmed` deliberately — it is that a value flows in from a query string, a stored
 * preference, an adapter response, or a UI control, and arrives at a renderer that treats any
 * non-empty class as good news.
 *
 * So promotion is not merely discouraged, it is impossible through this module: `confirmed` is
 * reachable only by presenting the full proof, and every other entry point coerces down.
 */

export type EvidenceClass = "mock" | "simulated" | "confirmed";

/** Everything a `confirmed` claim must carry. Missing any field means it is not confirmed. */
export interface ConfirmedProof {
  readonly chainId: number;
  readonly transactionHash: string;
  /** 1 only. A mined-and-reverted transaction is not a settlement. */
  readonly receiptStatus: 0 | 1;
  readonly blockNumber: bigint;
  readonly blockHash: string;
  /** The contracts the settlement was expected to run through. */
  readonly expectedContracts: { readonly executor: string; readonly hook: string };
  readonly observedContracts: { readonly executor: string; readonly hook: string };
  /** The merchant's measured balance increase, and the floor it had to clear. */
  readonly merchantDelta: bigint;
  readonly committedMinimum: bigint;
  /** Whether the settlement event was found in that transaction's own logs. */
  readonly settlementEventFound: boolean;
}

const HASH32 = /^0x[0-9a-fA-F]{64}$/;
const ADDR = /^0x[0-9a-fA-F]{40}$/;

/**
 * The ONLY route to `confirmed`. Returns the class, and the reasons it could not be granted.
 *
 * A predicate returning a boolean would let a caller ignore the reason; returning the reasons makes
 * a refusal renderable, which is what stops an interface saying "something went wrong".
 */
export function classifyConfirmed(proof: Partial<ConfirmedProof> | null | undefined): {
  evidence: EvidenceClass;
  missing: readonly string[];
} {
  const missing: string[] = [];
  if (!proof) return { evidence: "simulated", missing: ["no proof supplied"] };

  if (typeof proof.chainId !== "number" || !Number.isInteger(proof.chainId) || proof.chainId <= 0)
    missing.push("chainId");
  if (typeof proof.transactionHash !== "string" || !HASH32.test(proof.transactionHash))
    missing.push("transactionHash");
  if (proof.receiptStatus !== 1) missing.push("receiptStatus must be 1");
  if (typeof proof.blockNumber !== "bigint" || proof.blockNumber <= 0n) missing.push("blockNumber");
  if (typeof proof.blockHash !== "string" || !HASH32.test(proof.blockHash)) missing.push("blockHash");

  const exp = proof.expectedContracts;
  const obs = proof.observedContracts;
  if (!exp || !obs || !ADDR.test(exp.executor ?? "") || !ADDR.test(exp.hook ?? "")) {
    missing.push("expectedContracts");
  } else if (
    exp.executor.toLowerCase() !== (obs.executor ?? "").toLowerCase() ||
    exp.hook.toLowerCase() !== (obs.hook ?? "").toLowerCase()
  ) {
    missing.push("observed contracts do not match the expected ones");
  }

  if (typeof proof.merchantDelta !== "bigint" || typeof proof.committedMinimum !== "bigint") {
    missing.push("balance evidence");
  } else if (proof.merchantDelta < proof.committedMinimum) {
    missing.push("merchant delta is below the committed minimum");
  }
  if (proof.settlementEventFound !== true) missing.push("settlement event");

  return { evidence: missing.length === 0 ? "confirmed" : "simulated", missing };
}

/**
 * Coerces anything arriving from outside into a class that can be trusted.
 *
 * Untrusted sources — a query string, stored state, an adapter's own claim — may say `mock` or
 * `simulated` and are believed. They may NEVER say `confirmed`: that word is downgraded here, so a
 * crafted URL cannot relabel a fixture as a settlement.
 */
export function fromUntrusted(value: unknown): EvidenceClass {
  if (value === "simulated") return "simulated";
  return "mock";
}

/** Whether a class may be rendered to a person as a completed payment. Exactly one may. */
export function mayRenderAsSettled(evidence: EvidenceClass): boolean {
  return evidence === "confirmed";
}

/** The label a surface must show. Never blank, so an unlabelled state cannot read as confirmed. */
export function evidenceLabel(evidence: EvidenceClass): string {
  switch (evidence) {
    case "confirmed":
      return "Testnet settled";
    case "simulated":
      return "Simulation";
    default:
      return "Mock";
  }
}
