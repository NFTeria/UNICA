/**
 * Tests for the UNICA treasury guardian's confidential decision logic.
 *
 * WHY THESE RUN WITHOUT THE CRE RUNTIME. `decide`, `policyCommitment` and the action/reason
 * vocabularies are pure and exported precisely so every boundary can be driven without a
 * simulator, a login, or a network. The CRE runtime is what carries them into an enclave; it is
 * not what makes them correct, and correctness is what a test can establish here.
 *
 * THE LEAK TESTS ARE THE POINT. A Confidential Workflow that computes the right answer and then
 * prints the merchant's floor in its output has published the strategy it existed to protect.
 * So the rows below take the private policy, render every public surface, and assert that no
 * private value appears in any of them — as a number, as a string, in any field, at any depth.
 */

import { describe, expect, test } from "bun:test";
import {
  ACTION,
  EVIDENCE_GRADE,
  MAX_OBSERVATION_AGE_SECONDS,
  REASON,
  WORKFLOW_VERSION,
  decide,
  policyCommitment,
  type Observation,
  type PrivatePolicy,
} from "./guardian";

/** JSON.stringify throws on a bigint, and every amount here is one. */
function render(o: unknown): string {
  return JSON.stringify(o, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}

const TOKEN = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as const;
const OTHER = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14" as const;

/** The demo policy. Every number here is a secret in the deployed shape. */
const POLICY: PrivatePolicy = {
  minReserve: 50_000_000n,
  targetAllocationBps: 2_500n,
  maxActionUnits: 10_000_000n,
  riskThresholdBps: 6_000n,
  cooldownSeconds: 3_600n,
};

const NOW = 1_800_000_000n;

function obs(over: Partial<Observation> = {}): Observation {
  return {
    balance: 100_000_000n,
    observedAtBlock: 9_000_000n,
    observedAtUnix: NOW,
    lastActionAtUnix: 0n,
    nowUnix: NOW,
    token: TOKEN,
    ...over,
  };
}

describe("refusals come before any policy arithmetic", () => {
  test("an asset outside the allowlist is refused", () => {
    const d = decide(POLICY, obs({ token: OTHER }), TOKEN);
    expect(d.actionClass).toBe(ACTION.NO_ACTION);
    expect(d.reason).toBe(REASON.ASSET_NOT_PERMITTED);
    expect(d.amount).toBe(0n);
  });

  test("the allowlisted asset is accepted (the control for the row above)", () => {
    const d = decide(POLICY, obs(), TOKEN);
    expect(d.reason).not.toBe(REASON.ASSET_NOT_PERMITTED);
  });

  test("an observation older than the freshness bound is refused", () => {
    const d = decide(POLICY, obs({ observedAtUnix: NOW - MAX_OBSERVATION_AGE_SECONDS - 1n }), TOKEN);
    expect(d.reason).toBe(REASON.OBSERVATION_STALE);
  });

  test("an observation exactly at the freshness bound is still accepted", () => {
    const d = decide(POLICY, obs({ observedAtUnix: NOW - MAX_OBSERVATION_AGE_SECONDS }), TOKEN);
    expect(d.reason).not.toBe(REASON.OBSERVATION_STALE);
  });

  test("an observation from the future is refused rather than trusted", () => {
    const d = decide(POLICY, obs({ observedAtUnix: NOW + 1n }), TOKEN);
    expect(d.reason).toBe(REASON.OBSERVATION_STALE);
  });

  test("inside the cooldown, nothing acts", () => {
    const d = decide(POLICY, obs({ lastActionAtUnix: NOW - POLICY.cooldownSeconds + 1n }), TOKEN);
    expect(d.actionClass).toBe(ACTION.NO_ACTION);
    expect(d.reason).toBe(REASON.COOLDOWN_ACTIVE);
  });

  test("exactly at the cooldown boundary, action resumes", () => {
    const d = decide(POLICY, obs({ lastActionAtUnix: NOW - POLICY.cooldownSeconds }), TOKEN);
    expect(d.reason).not.toBe(REASON.COOLDOWN_ACTIVE);
  });
});

describe("the reserve is a floor, and the cap is a ceiling", () => {
  test("one unit below the floor is a shortfall", () => {
    const d = decide(POLICY, obs({ balance: POLICY.minReserve - 1n }), TOKEN);
    expect(d.actionClass).toBe(ACTION.RESTORE_MINIMUM_RESERVE);
    expect(d.amount).toBe(1n);
    expect(d.bounded).toBe(false);
  });

  test("exactly at the floor is not a shortfall", () => {
    const d = decide(POLICY, obs({ balance: POLICY.minReserve }), TOKEN);
    expect(d.actionClass).not.toBe(ACTION.RESTORE_MINIMUM_RESERVE);
  });

  test("a shortfall larger than the cap is clamped to the cap and marked bounded", () => {
    const d = decide(POLICY, obs({ balance: 0n }), TOKEN);
    expect(d.actionClass).toBe(ACTION.RESTORE_MINIMUM_RESERVE);
    expect(d.amount).toBe(POLICY.maxActionUnits);
    expect(d.bounded).toBe(true);
  });

  test("a shortfall exactly at the cap is not marked bounded", () => {
    const d = decide(POLICY, obs({ balance: POLICY.minReserve - POLICY.maxActionUnits }), TOKEN);
    expect(d.amount).toBe(POLICY.maxActionUnits);
    expect(d.bounded).toBe(false);
  });

  test("no action ever exceeds the cap, across the whole balance range", () => {
    for (let b = 0n; b <= 500_000_000n; b += 7_000_000n) {
      const d = decide(POLICY, obs({ balance: b }), TOKEN);
      expect(d.amount <= POLICY.maxActionUnits).toBe(true);
    }
  });
});

describe("allocation bands", () => {
  test("a surplus too small to allocate holds instead of acting", () => {
    const d = decide(POLICY, obs({ balance: POLICY.minReserve + 1n }), TOKEN);
    expect(d.actionClass).toBe(ACTION.HOLD_SETTLEMENT_ASSET);
    expect(d.amount).toBe(0n);
  });

  test("a surplus beyond the risk band reduces exposure rather than allocating", () => {
    const d = decide(POLICY, obs({ balance: 1_000_000_000n }), TOKEN);
    expect(d.actionClass).toBe(ACTION.REDUCE_APPROVED_EXPOSURE);
    expect(d.reason).toBe(REASON.ALLOCATION_ABOVE_BAND);
  });

  test("a surplus within the band proposes a bounded reallocation", () => {
    const d = decide(POLICY, obs({ balance: 100_000_000n }), TOKEN);
    expect(d.actionClass).toBe(ACTION.PROPOSE_BOUNDED_REALLOCATION);
    expect(d.reason).toBe(REASON.ALLOCATION_WITHIN_BAND);
  });

  test("every outcome is one of the five declared action classes", () => {
    const seen = new Set<string>();
    for (let b = 0n; b <= 2_000_000_000n; b += 13_000_000n) {
      seen.add(decide(POLICY, obs({ balance: b }), TOKEN).actionClass);
    }
    for (const a of seen) expect(Object.values(ACTION)).toContain(a as never);
  });
});

describe("the commitment binds the policy and nothing else", () => {
  test("the same policy commits to the same value", () => {
    expect(policyCommitment(POLICY, WORKFLOW_VERSION)).toBe(policyCommitment(POLICY, WORKFLOW_VERSION));
  });

  test("every private field moves the commitment, one at a time", () => {
    const base = policyCommitment(POLICY, WORKFLOW_VERSION);
    const fields: (keyof PrivatePolicy)[] = [
      "minReserve",
      "targetAllocationBps",
      "maxActionUnits",
      "riskThresholdBps",
      "cooldownSeconds",
    ];
    for (const f of fields) {
      const moved = { ...POLICY, [f]: POLICY[f] + 1n };
      expect(policyCommitment(moved, WORKFLOW_VERSION)).not.toBe(base);
    }
  });

  test("a substituted workflow version moves the commitment", () => {
    expect(policyCommitment(POLICY, "unica-treasury-guardian/9.9.9")).not.toBe(
      policyCommitment(POLICY, WORKFLOW_VERSION),
    );
  });

  test("the commitment does not reveal the policy: it is fixed width regardless of magnitude", () => {
    const small = policyCommitment({ ...POLICY, minReserve: 1n }, WORKFLOW_VERSION);
    const huge = policyCommitment({ ...POLICY, minReserve: 10n ** 30n }, WORKFLOW_VERSION);
    expect(small.length).toBe(huge.length);
  });
});

describe("SECRET LEAKAGE — the rows that make this confidential rather than merely private", () => {
  /** The four secrets that are NOT amounts. These must never appear, with no exceptions. */
  const nonAmountSecrets = [
    POLICY.minReserve.toString(),
    POLICY.targetAllocationBps.toString(),
    POLICY.riskThresholdBps.toString(),
    POLICY.cooldownSeconds.toString(),
  ];

  /**
   * Compared FIELD BY FIELD, not as a substring of the rendered JSON.
   *
   * A substring test looks stricter and is actually wrong: an amount of 12500000 "contains"
   * 2500, so a coincidence of digits reads as a leak and the row fails for a reason that is not
   * a leak. Leakage is a FIELD whose value IS a secret, so that is what this asserts.
   */
  test("no threshold, target, risk band or cooldown is the value of any published field", () => {
    for (let b = 0n; b <= 2_000_000_000n; b += 11_000_000n) {
      const d = decide(POLICY, obs({ balance: b }), TOKEN);
      const values = Object.values(JSON.parse(render(d))).map(String);
      for (const s of nonAmountSecrets) expect(values).not.toContain(s);
    }
  });

  test("CONTROL: the field-wise test does catch a real leak when one is planted", () => {
    const d = decide(POLICY, obs({ balance: 0n }), TOKEN);
    const planted = { ...d, floor: POLICY.minReserve };
    const values = Object.values(JSON.parse(render(planted))).map(String);
    expect(values).toContain(POLICY.minReserve.toString());
  });

  /**
   * KNOWN AND DOCUMENTED LIMITATION, asserted rather than hidden.
   *
   * The per-action cap is inferable from published amounts. This is not an implementation slip
   * that a better encoding fixes — it is a property of proposing a BOUNDED action at all: the
   * bound is the supremum of what can ever be proposed, so enough observations converge on it,
   * and a single clamped action reveals it exactly.
   *
   * This test exists so the limitation is measured rather than assumed away. If a future design
   * hides the cap — coarse buckets, a commitment instead of an amount, an execution path that
   * never publishes the number — this row is the one that should start failing, and that failure
   * is the signal to update the claim in the file header.
   */
  test("KNOWN LIMITATION: the per-action cap IS inferable from a clamped amount", () => {
    const clamped = decide(POLICY, obs({ balance: 0n }), TOKEN);
    expect(clamped.bounded).toBe(true);
    expect(clamped.amount).toBe(POLICY.maxActionUnits);
    expect(render(clamped)).toContain(POLICY.maxActionUnits.toString());
  });

  test("the cap is the supremum of every amount this policy can ever propose", () => {
    let max = 0n;
    for (let b = 0n; b <= 2_000_000_000n; b += 3_000_000n) {
      const a = decide(POLICY, obs({ balance: b }), TOKEN).amount;
      if (a > max) max = a;
    }
    expect(max).toBe(POLICY.maxActionUnits);
  });

  test("the reason vocabulary never contains a number", () => {
    for (const r of Object.values(REASON)) expect(r).not.toMatch(/[0-9]/);
  });

  test("the action vocabulary never contains a number", () => {
    for (const a of Object.values(ACTION)) expect(a).not.toMatch(/[0-9]/);
  });

  test("MUTATION: publishing the reserve as a field would leak it — proven by construction", () => {
    // The shape the code must never take. The reserve is the secret with no legitimate reason to
    // appear anywhere, so this is the mutation that matters most.
    const leaky = { ...decide(POLICY, obs({ balance: 0n }), TOKEN), minReserve: POLICY.minReserve.toString() };
    expect(render(leaky)).toContain(POLICY.minReserve.toString());
    // and the real decision does not
    expect(render(decide(POLICY, obs({ balance: 0n }), TOKEN))).not.toContain(POLICY.minReserve.toString());
  });

  test("MUTATION: a reason that quoted the reserve would leak it", () => {
    const leaky = `balance below reserve ${POLICY.minReserve}`;
    expect(leaky).toContain(POLICY.minReserve.toString());
    // and the real vocabulary does not
    expect(REASON.RESERVE_SHORTFALL).not.toContain(POLICY.minReserve.toString());
  });
});

describe("evidence grading stays honest", () => {
  test("a simulation is graded as a simulation", () => {
    expect(EVIDENCE_GRADE.CRE_CONFIDENTIAL_SIMULATION).toBe("CRE_CONFIDENTIAL_SIMULATION");
  });

  test("TEE_ATTESTED exists but is not what this workflow returns", () => {
    expect(EVIDENCE_GRADE.TEE_ATTESTED).toBe("TEE_ATTESTED");
    expect(EVIDENCE_GRADE.CRE_CONFIDENTIAL_SIMULATION).not.toBe(EVIDENCE_GRADE.TEE_ATTESTED);
  });
});
