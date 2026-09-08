/**
 * UNICA treasury guardian — the CRE entry point, and nothing else.
 *
 * This file is deliberately almost empty. The CRE toolchain compiles the ENTRY module's exports
 * into WASM exports, and Javy refuses any exported function that takes a parameter:
 *
 *     Error: Exported functions with parameters are not supported
 *
 * `decide`, `policyCommitment`, `onCronTrigger` and `initWorkflow` all take arguments and all
 * must stay exported for the suite to drive them, so they live in `guardian.ts`. Here there is
 * exactly one export and it takes nothing.
 *
 * The boundary, the policy, the leak analysis and the evidence grading are all documented at the
 * top of `guardian.ts`, which is where the code they describe lives.
 */

import { Runner } from "@chainlink/cre-sdk";
import { type Config, initWorkflow } from "./guardian";

/**
 * The CRE runtime invokes this. It is deliberately NOT called at module scope: the official
 * workflow does not self-invoke either, and a top-level `await main()` makes the module
 * unimportable outside the CRE WASM host — which is where the tests need to import it from.
 */
export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
