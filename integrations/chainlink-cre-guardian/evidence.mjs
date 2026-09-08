// What a local run can honestly say about itself.
//
// THE MODE IS THE POINT. Every record produced here carries `executionMode: "LOCAL_SIMULATION"`,
// and there is no argument that can set it to anything else. A record from this file is not a TEE
// attestation and not a DON execution receipt; it is a statement that a simulation ran, and the
// difference matters because the challenge awards points for confidential execution evidence and
// a simulation is not that.
//
// The clock is an INPUT. Nothing here calls Date.now(), so two runs of the same fixture produce
// byte-identical records and a test can assert that.

import {keccak256, toHex} from "../../web/ensv2/keccak.mjs";
import {concat, wordBytes32, wordInt, wordUint} from "../../tools/unica-sign/abi.mjs";
import {healthFactor} from "./policy.mjs";

const utf8 = (s) => new TextEncoder().encode(s);
const big = (v) => (typeof v === "bigint" ? v : BigInt(v));

export const EXECUTION_MODE = {LOCAL_SIMULATION: "LOCAL_SIMULATION"};

/// Deliberately NOT a member of EXECUTION_MODE. Listed so a test can assert no record claims one.
export const MODES_THIS_FILE_CANNOT_CLAIM = [
  "TEE_ATTESTED", "DON_EXECUTED", "CONFIDENTIAL_EXECUTION", "ONCHAIN_VERIFIED",
];

export function stateCommitment(position) {
  return toHex(
    keccak256(
      concat(
        wordBytes32(toHex(keccak256(utf8("UNICA.guardian.state.v1")))),
        wordUint(position.collateral),
        wordUint(position.debt),
        wordUint(position.price),
        wordUint(position.freeCollateral),
        wordUint(position.freeDebtToken),
      ),
    ),
  );
}

/// One record per adapter step. `transactionReference` is null in local mode and there is no path
/// that fills it, because nothing here sends anything.
export function record({
  workflowVersion, configVersion, profile, step, before, after, timestamp,
}) {
  const hfBefore = healthFactor(before);
  const hfAfter = after ? healthFactor(after) : null;
  return {
    workflowVersion,
    configVersion,
    deploymentProfile: profile,
    executionMode: EXECUTION_MODE.LOCAL_SIMULATION,
    timestamp: big(timestamp).toString(),
    sequence: step.sequence === undefined ? null : big(step.sequence).toString(),
    observationCommitment: step.observationCommitment ?? null,
    policyCommitment: step.policyCommitment ?? null,
    intent: step.intent,
    reason: step.decision?.reason ?? step.reason ?? null,
    asset: step.decision?.asset ?? null,
    amount: step.decision?.amount === undefined ? null : big(step.decision.amount).toString(),
    preStateCommitment: stateCommitment(before),
    postStateCommitment: after ? stateCommitment(after) : null,
    healthFactorBefore: hfBefore === null ? null : hfBefore.toString(),
    healthFactorAfter: hfAfter === null ? null : hfAfter.toString(),
    transactionReference: null,
    disclaimer:
      "Produced by a local simulation. This is NOT a TEE attestation and NOT a DON execution "
      + "receipt; no transaction was sent and no confidential runtime was involved.",
  };
}
