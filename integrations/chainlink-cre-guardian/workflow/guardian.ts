/**
 * UNICA treasury guardian — the workflow's logic, and everything the tests read.
 *
 * WHY THIS IS A SEPARATE FILE FROM main.ts, which is the only reason the split exists.
 * The CRE toolchain bundles this workflow and hands it to Javy, which compiles JavaScript to
 * WASM — and Javy refuses to compile a module whose EXPORTS take parameters:
 *
 *     Error: Exported functions with parameters are not supported
 *
 * Only the ENTRY module's exports become WASM exports. `decide`, `policyCommitment`,
 * `onCronTrigger` and `initWorkflow` all take arguments, and all four must stay exported so the
 * suite can drive them directly rather than through the runtime. So they live here, one import
 * away from the entry, where Javy never sees them as exports at all.
 *
 * That is a real constraint of the compiler and not a style choice: with all of this in main.ts
 * the workflow typechecks, bundles, and then fails at the WASM step with the line above.
 *
 * WHAT MAKES THIS CONFIDENTIAL, AND WHY THE PREVIOUS VERSION DID NOT COUNT.
 * `integrations/chainlink-cre-guardian/*.mjs` is a deterministic policy with a secrets-shaped
 * boundary and a commitment. It is tested, it is useful, and it is NOT a Confidential Workflow:
 * it never registered a TEE handler, never imported the CRE SDK, and never ran under the CRE
 * runtime. The published bar is `handlerInTee`, and a JavaScript function named "confidential"
 * does not meet it. This file is the real thing; the .mjs modules remain the reference model the
 * decision arithmetic is checked against.
 *
 * THE BOUNDARY, STATED ONCE.
 *
 *   PRIVATE — read from CRE secrets, used only inside this handler, never logged, never
 *   returned: the merchant's minimum settlement reserve, their target allocation, their maximum
 *   action size, their risk threshold, and their cooldown.
 *
 *   PUBLIC — the returned decision: a policy commitment, the workflow version, an action class
 *   from a fixed set, the bounded amount actually proposed, a reason CATEGORY, the permitted
 *   target and selector, and an evidence grade.
 *
 * WHAT THE PUBLIC OUTPUT OMITS, AND THE ONE THING IT CANNOT.
 * The reserve, the target allocation, the risk band and the cooldown never appear in any field.
 * `main.test.ts` asserts that field by field across the whole balance range, with a control row
 * that plants a leak and proves the check catches it.
 *
 * The per-action cap is different, and pretending otherwise would be the dishonest thing to do
 * here. The cap is the supremum of every amount this policy can ever propose, so enough
 * observations converge on it — and a single CLAMPED action publishes it exactly, because the
 * clamped amount IS the cap. That is not a slip a better encoding fixes; it is a property of
 * proposing a bounded action at all. It is asserted as a KNOWN LIMITATION in `main.test.ts`
 * rather than assumed away, and if a future design hides it, that row is what starts failing.
 *
 * WHAT THE COMMITMENT PROVES. That this decision was produced under a policy whose values hash
 * to `policyCommitment`, and that the same values would produce the same commitment again. It
 * does NOT prove the policy is safe, is profitable, was executed inside a TEE, or that the
 * output does not itself reveal the policy. Those are separate claims and this file makes none
 * of them.
 *
 * EXECUTION GRADE. A `cre workflow simulate` run is a SIMULATION. It is not a DON deployment and
 * not a TEE attestation, and the grade this workflow returns says so.
 */

import {
  CronCapability,
  HTTPClient,
  Runner,
  handlerInTee,
  type TeeRuntime,
  type Workflow,
} from "@chainlink/cre-sdk";
import { decodeFunctionResult, encodeFunctionData, type Address } from "viem";

// ─── Config (all PUBLIC) ──────────────────────────────────────────────────────

type SecretsConfig = {
  min_reserve_id: string;
  target_allocation_bps_id: string;
  max_action_units_id: string;
  risk_threshold_bps_id: string;
  cooldown_seconds_id: string;
};

export type Config = {
  schedule: string;
  rpc_url: string;
  chain_id: number;
  settlement_token: string;
  merchant: string;
  permitted_target: string;
  permitted_selector: string;
  policy_version: number;
  secrets_ids: SecretsConfig;
};

// ─── The only actions this workflow may ever propose ──────────────────────────
//
// A fixed, typed set. Nothing here builds arbitrary calldata, and there is no parameter that
// could carry a request to call something else — the target and the selector come from config
// and are checked against it before any action is returned.

export const ACTION = {
  NO_ACTION: "NO_ACTION",
  HOLD_SETTLEMENT_ASSET: "HOLD_SETTLEMENT_ASSET",
  RESTORE_MINIMUM_RESERVE: "RESTORE_MINIMUM_RESERVE",
  REDUCE_APPROVED_EXPOSURE: "REDUCE_APPROVED_EXPOSURE",
  PROPOSE_BOUNDED_REALLOCATION: "PROPOSE_BOUNDED_REALLOCATION",
} as const;
export type ActionClass = (typeof ACTION)[keyof typeof ACTION];

/**
 * Reason categories. Deliberately coarse: a reason like "balance 41 below reserve 50" would
 * publish the reserve, so the categories name the SHAPE of the decision and never a number.
 */
export const REASON = {
  RESERVE_INTACT: "RESERVE_INTACT",
  RESERVE_SHORTFALL: "RESERVE_SHORTFALL",
  ALLOCATION_WITHIN_BAND: "ALLOCATION_WITHIN_BAND",
  ALLOCATION_ABOVE_BAND: "ALLOCATION_ABOVE_BAND",
  COOLDOWN_ACTIVE: "COOLDOWN_ACTIVE",
  OBSERVATION_STALE: "OBSERVATION_STALE",
  ASSET_NOT_PERMITTED: "ASSET_NOT_PERMITTED",
} as const;
export type ReasonCategory = (typeof REASON)[keyof typeof REASON];

export const EVIDENCE_GRADE = {
  /** Produced by `cre workflow simulate`. Real CRE runtime, real confidential handler, local. */
  CRE_CONFIDENTIAL_SIMULATION: "CRE_CONFIDENTIAL_SIMULATION",
  /** Reserved. Only a real DON run with attestation evidence may ever set this. */
  TEE_ATTESTED: "TEE_ATTESTED",
} as const;

export const WORKFLOW_VERSION = "unica-treasury-guardian/1.0.0";

// ─── ABIs — read-only, plus the one permitted write shape ─────────────────────

const ERC20_BALANCE_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const ERC20_TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

// ─── Deterministic helpers — the arithmetic, with no I/O ──────────────────────
//
// Kept pure and exported so `main.test.ts` can drive every boundary without the CRE
// runtime. Integers only: no floats anywhere near a number that decides where money goes.

export type PrivatePolicy = {
  minReserve: bigint;
  targetAllocationBps: bigint;
  maxActionUnits: bigint;
  riskThresholdBps: bigint;
  cooldownSeconds: bigint;
};

export type Observation = {
  balance: bigint;
  observedAtBlock: bigint;
  observedAtUnix: bigint;
  lastActionAtUnix: bigint;
  nowUnix: bigint;
  token: Address;
};

export type Decision = {
  actionClass: ActionClass;
  reason: ReasonCategory;
  /** The amount actually proposed. Zero for every no-action outcome. */
  amount: bigint;
  /** True when a private bound reduced the amount. The bound itself is never published. */
  bounded: boolean;
};

/** Freshness bound on the observation, in seconds. Public: it is not a strategy value. */
export const MAX_OBSERVATION_AGE_SECONDS = 900n;

/**
 * The whole decision, as one pure function.
 *
 * Order matters and is deliberate: the cheapest refusals come first, so a stale or
 * unpermitted observation can never reach the arithmetic that reads the merchant's policy.
 */
export function decide(
  policy: PrivatePolicy,
  obs: Observation,
  permittedToken: Address,
): Decision {
  if (obs.token.toLowerCase() !== permittedToken.toLowerCase()) {
    return { actionClass: ACTION.NO_ACTION, reason: REASON.ASSET_NOT_PERMITTED, amount: 0n, bounded: false };
  }
  if (obs.nowUnix < obs.observedAtUnix) {
    return { actionClass: ACTION.NO_ACTION, reason: REASON.OBSERVATION_STALE, amount: 0n, bounded: false };
  }
  if (obs.nowUnix - obs.observedAtUnix > MAX_OBSERVATION_AGE_SECONDS) {
    return { actionClass: ACTION.NO_ACTION, reason: REASON.OBSERVATION_STALE, amount: 0n, bounded: false };
  }
  if (obs.lastActionAtUnix > 0n && obs.nowUnix - obs.lastActionAtUnix < policy.cooldownSeconds) {
    return { actionClass: ACTION.NO_ACTION, reason: REASON.COOLDOWN_ACTIVE, amount: 0n, bounded: false };
  }

  // Below the merchant's floor: restore it, bounded by the per-action cap.
  if (obs.balance < policy.minReserve) {
    const shortfall = policy.minReserve - obs.balance;
    const amount = shortfall > policy.maxActionUnits ? policy.maxActionUnits : shortfall;
    return {
      actionClass: ACTION.RESTORE_MINIMUM_RESERVE,
      reason: REASON.RESERVE_SHORTFALL,
      amount,
      bounded: shortfall > policy.maxActionUnits,
    };
  }

  // Above the floor. Is the surplus large enough to be worth allocating?
  const surplus = obs.balance - policy.minReserve;
  const allocatable = (surplus * policy.targetAllocationBps) / 10_000n;
  if (allocatable === 0n) {
    return { actionClass: ACTION.HOLD_SETTLEMENT_ASSET, reason: REASON.ALLOCATION_WITHIN_BAND, amount: 0n, bounded: false };
  }

  // A surplus beyond the merchant's risk band is reduced rather than allocated further.
  const surplusBps = (surplus * 10_000n) / (obs.balance === 0n ? 1n : obs.balance);
  if (surplusBps > policy.riskThresholdBps) {
    const amount = allocatable > policy.maxActionUnits ? policy.maxActionUnits : allocatable;
    return {
      actionClass: ACTION.REDUCE_APPROVED_EXPOSURE,
      reason: REASON.ALLOCATION_ABOVE_BAND,
      amount,
      bounded: allocatable > policy.maxActionUnits,
    };
  }

  const amount = allocatable > policy.maxActionUnits ? policy.maxActionUnits : allocatable;
  return {
    actionClass: ACTION.PROPOSE_BOUNDED_REALLOCATION,
    reason: REASON.ALLOCATION_WITHIN_BAND,
    amount,
    bounded: allocatable > policy.maxActionUnits,
  };
}

/**
 * The commitment. FNV-1a over the policy's decimal values, in a fixed order.
 *
 * Chosen because it needs no dependency inside the enclave and is deterministic. It binds a
 * decision to a policy and detects substitution; it is NOT collision-resistant in the
 * cryptographic sense and this file does not claim it is. `docs/v2/` records that limit.
 */
export function policyCommitment(p: PrivatePolicy, version: string): string {
  const preimage = [
    version,
    p.minReserve.toString(),
    p.targetAllocationBps.toString(),
    p.maxActionUnits.toString(),
    p.riskThresholdBps.toString(),
    p.cooldownSeconds.toString(),
  ].join("|");
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = (1n << 64n) - 1n;
  for (let i = 0; i < preimage.length; i++) {
    h = (h ^ BigInt(preimage.charCodeAt(i))) & mask;
    h = (h * prime) & mask;
  }
  return "0x" + h.toString(16).padStart(16, "0");
}

/** The public result. Every field here is safe to log, index, or publish. */
export type PublicResult = {
  workflowVersion: string;
  policyVersion: number;
  policyCommitment: string;
  actionClass: ActionClass;
  reason: ReasonCategory;
  amount: string;
  bounded: boolean;
  permittedToken: string;
  permittedTarget: string;
  permittedSelector: string;
  observedAtBlock: string;
  observedAtUnix: string;
  sequence: string;
  expiryUnix: string;
  evidenceGrade: string;
  calldata: string | null;
};

// ─── The confidential handler ─────────────────────────────────────────────────

export const onCronTrigger = async (runtime: TeeRuntime<Config>): Promise<string> => {
  const config = runtime.config;
  const ids = config.secrets_ids;

  // PRIVATE. Everything below this line stays inside the handler.
  const secrets = await runtime
    .getSecrets([
      { id: ids.min_reserve_id },
      { id: ids.target_allocation_bps_id },
      { id: ids.max_action_units_id },
      { id: ids.risk_threshold_bps_id },
      { id: ids.cooldown_seconds_id },
    ])
    .result();

  const policy: PrivatePolicy = {
    minReserve: BigInt(secrets[ids.min_reserve_id].value),
    targetAllocationBps: BigInt(secrets[ids.target_allocation_bps_id].value),
    maxActionUnits: BigInt(secrets[ids.max_action_units_id].value),
    riskThresholdBps: BigInt(secrets[ids.risk_threshold_bps_id].value),
    cooldownSeconds: BigInt(secrets[ids.cooldown_seconds_id].value),
  };

  // A CATEGORY, never a value. The official challenge logs the same way and it is the right
  // habit: a log line is public, and "secrets loaded" is all a reader is entitled to.
  runtime.log("unica-guardian-secrets-loaded");

  // PUBLIC state. One read: what the merchant currently holds in the settlement asset.
  const client = new HTTPClient();
  const balanceCall = encodeFunctionData({
    abi: ERC20_BALANCE_ABI,
    functionName: "balanceOf",
    args: [config.merchant as Address],
  });

  const rpcResponse = await client
    .sendRequest(runtime, {
      url: config.rpc_url,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: new TextEncoder().encode(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_call",
          params: [{ to: config.settlement_token, data: balanceCall }, "latest"],
        }),
      ),
    })
    .result();

  const decoded = JSON.parse(new TextDecoder().decode(rpcResponse.body));
  if (decoded.error || typeof decoded.result !== "string") {
    runtime.log("unica-guardian-observation-unavailable");
    return JSON.stringify(refusal(config, policy, REASON.OBSERVATION_STALE));
  }

  const balance = decodeFunctionResult({
    abi: ERC20_BALANCE_ABI,
    functionName: "balanceOf",
    data: decoded.result as `0x${string}`,
  }) as bigint;

  const nowUnix = BigInt(Math.floor(Date.now() / 1000));
  const obs: Observation = {
    balance,
    observedAtBlock: 0n,
    observedAtUnix: nowUnix,
    lastActionAtUnix: 0n,
    nowUnix,
    token: config.settlement_token as Address,
  };

  const decision = decide(policy, obs, config.settlement_token as Address);
  runtime.log(`unica-guardian-decision:${decision.actionClass}`);

  // The one permitted write shape, and only when an action is actually proposed. The target and
  // the selector are checked against config rather than taken from anywhere else, so there is no
  // path by which this handler emits calldata for a contract it was not authorised to name.
  let calldata: string | null = null;
  if (decision.amount > 0n) {
    const encoded = encodeFunctionData({
      abi: ERC20_TRANSFER_ABI,
      functionName: "transfer",
      args: [config.merchant as Address, decision.amount],
    });
    if (
      encoded.slice(0, 10).toLowerCase() !== config.permitted_selector.toLowerCase() ||
      config.permitted_target.toLowerCase() !== config.settlement_token.toLowerCase()
    ) {
      runtime.log("unica-guardian-target-refused");
      return JSON.stringify(refusal(config, policy, REASON.ASSET_NOT_PERMITTED));
    }
    calldata = encoded;
  }

  const result: PublicResult = {
    workflowVersion: WORKFLOW_VERSION,
    policyVersion: config.policy_version,
    policyCommitment: policyCommitment(policy, WORKFLOW_VERSION),
    actionClass: decision.actionClass,
    reason: decision.reason,
    amount: decision.amount.toString(),
    bounded: decision.bounded,
    permittedToken: config.settlement_token,
    permittedTarget: config.permitted_target,
    permittedSelector: config.permitted_selector,
    observedAtBlock: obs.observedAtBlock.toString(),
    observedAtUnix: obs.observedAtUnix.toString(),
    sequence: obs.observedAtUnix.toString(),
    expiryUnix: (obs.observedAtUnix + MAX_OBSERVATION_AGE_SECONDS).toString(),
    evidenceGrade: EVIDENCE_GRADE.CRE_CONFIDENTIAL_SIMULATION,
    calldata,
  };
  return JSON.stringify(result);
};

/** A no-action result that still carries the commitment, so a refusal is evidence too. */
function refusal(config: Config, policy: PrivatePolicy, reason: ReasonCategory): PublicResult {
  return {
    workflowVersion: WORKFLOW_VERSION,
    policyVersion: config.policy_version,
    policyCommitment: policyCommitment(policy, WORKFLOW_VERSION),
    actionClass: ACTION.NO_ACTION,
    reason,
    amount: "0",
    bounded: false,
    permittedToken: config.settlement_token,
    permittedTarget: config.permitted_target,
    permittedSelector: config.permitted_selector,
    observedAtBlock: "0",
    observedAtUnix: "0",
    sequence: "0",
    expiryUnix: "0",
    evidenceGrade: EVIDENCE_GRADE.CRE_CONFIDENTIAL_SIMULATION,
    calldata: null,
  };
}

// ─── Workflow init ────────────────────────────────────────────────────────────

export const initWorkflow = (config: Config): Workflow<Config> => {
  if (
    !config.schedule ||
    !config.rpc_url ||
    !config.settlement_token ||
    !config.merchant ||
    !config.permitted_target ||
    !config.permitted_selector
  ) {
    throw new Error(
      "config requires schedule, rpc_url, settlement_token, merchant, permitted_target, permitted_selector",
    );
  }
  if (
    !config.secrets_ids?.min_reserve_id ||
    !config.secrets_ids?.target_allocation_bps_id ||
    !config.secrets_ids?.max_action_units_id ||
    !config.secrets_ids?.risk_threshold_bps_id ||
    !config.secrets_ids?.cooldown_seconds_id
  ) {
    throw new Error("config requires all secrets_ids fields");
  }

  const cron = new CronCapability();

  return [
    handlerInTee(
      cron.trigger({ schedule: config.schedule }),
      onCronTrigger,
      {},
      // Production would name a Nitro TEE region here. Left commented on purpose: this
      // repository runs the simulation path only, and an uncommented region would suggest a
      // deployment that has not happened.
      // [{ tee: "nitro", regions: [NITRO_REGIONS[0]] }],
    ),
  ];
};

