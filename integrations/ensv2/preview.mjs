// The transaction preview for the one edit the owner would actually sign — and the wall between
// this repository and that signature.
//
// WHAT THIS IS FOR. Everything else in this directory is read-only by nature. Setting a merchant's
// address record is not: it is a real transaction, from a real key, and it costs real gas. This
// file builds the complete description of that transaction — chain, to, value, calldata, the
// decoded call, a live gas estimate, and the authorization check that must hold for it to succeed —
// and then stops. The marker `REQUIRES_OWNER_WALLET_CONFIRMATION` is on the object because the
// object is the deliverable; the signature is the owner's, and it is taken in the owner's wallet.
//
// WHY IT CANNOT BROADCAST. Not "does not" — cannot. There is no signer imported, no key read from
// any environment variable or file, and no JSON-RPC method named anywhere in this directory that
// writes: `eth_sendRawTransaction`, `eth_sendTransaction` and `personal_sign` do not appear.
// `permissioned-test.mjs` reads these files back and fails if any of them ever does, so the
// property is enforced rather than promised.
//
// A PREVIEW WITHOUT AN AUTHORIZATION CHECK IS REFUSED. That is the rule this module exists to
// enforce and the one that has a sabotage row. A preview is a thing a human will look at once and
// then sign; if it can be produced without evidence that the signing account may actually make the
// edit, then the first time anyone learns the account was wrong is when the transaction reverts
// with gas spent — or worse, when it succeeds from the wrong account. So `buildPreview` refuses a
// reading that carries no authorization observation, and refuses one where the observation says
// the account does not hold the role.
//
//   node integrations/ensv2/preview.mjs [name] [target-address] [rpc-url]

import {
  ROLE, ROOT_RESOURCE, SIGNATURES, encodeSetAddrCall, nameLevelResource, readAuthorization,
} from "./permissioned.mjs";
import {ENSV2} from "../../web/ensv2/resolve.mjs";
import {resolve as pathResolve} from "node:path";
import {fileURLToPath} from "node:url";

export const OWNER_MARKER = "REQUIRES_OWNER_WALLET_CONFIRMATION";

export const PREVIEW_STATUS = {
  READY: "READY",
  NOT_A_READING: "NOT_A_READING",
  NO_AUTHORIZATION_CHECK: "NO_AUTHORIZATION_CHECK",
  AUTHORIZATION_UNPROVEN: "AUTHORIZATION_UNPROVEN",
  WRONG_CHAIN: "WRONG_CHAIN",
  MISSING_TARGET: "MISSING_TARGET",
  VALUE_MUST_BE_ZERO: "VALUE_MUST_BE_ZERO",
  NO_GAS_ESTIMATE: "NO_GAS_ESTIMATE",
};

export const PREVIEW_EXPLAIN = {
  READY: "Ready for the owner's wallet.",
  NOT_A_READING: "That is not the shape `readAuthorization` returns; nothing was previewed.",
  NO_AUTHORIZATION_CHECK: "The reading carried no authorization observation. A preview that cannot say who may sign it is not a preview.",
  AUTHORIZATION_UNPROVEN: "The chain does not show that account holding the role this edit needs.",
  WRONG_CHAIN: "ENSv2 previews are built for Ethereum Sepolia only.",
  MISSING_TARGET: "No address was given for the record to be set to.",
  VALUE_MUST_BE_ZERO: "A resolver setter is not payable; a preview carrying value is refused.",
  NO_GAS_ESTIMATE: "No gas estimate was observed, so the cost of this transaction is unknown.",
};

const isAddress = (v) => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
const lower = (v) => String(v ?? "").toLowerCase();
const refuse = (status, extra = {}) => ({ok: false, status, explain: PREVIEW_EXPLAIN[status], ...extra});

/// Build the preview for `setAddr(node, target)` on the name's own Permissioned Resolver.
///
/// @param read  the object `readAuthorization` returned. The ONLY source of the resolver, the
///              node, and the authorization observation — none of the three may be supplied.
/// @param opts  {target, from, gas, atBlock}. `from` must be one of the accounts the reading
///              observed holding ROLE_SET_ADDR; anything else is refused rather than previewed.
export function buildPreview(read, opts = {}) {
  for (const f of ["resolver", "node", "authorized", "candidates"]) {
    if (f in opts) return refuse(PREVIEW_STATUS.NOT_A_READING, {detail: `'${f}' may not be supplied`});
  }
  if (!read || typeof read !== "object" || read.ok !== true || typeof read.resolver !== "string") {
    return refuse(PREVIEW_STATUS.NOT_A_READING);
  }
  if (Number(read.chainId) !== ENSV2.chainId) {
    return refuse(PREVIEW_STATUS.WRONG_CHAIN, {chainId: read.chainId});
  }

  // The sabotage target. A reading with no `authorized` array — or an empty one — means nobody was
  // observed holding the role, and there is nothing to attach to the preview.
  if (!Array.isArray(read.authorized) || read.authorized.length === 0) {
    return refuse(PREVIEW_STATUS.NO_AUTHORIZATION_CHECK, {
      detail: `the reading's status was ${read.status}; no account was observed holding ROLE_SET_ADDR`,
    });
  }

  // Read defensively even though the check above already guaranteed a non-empty list. The refusal
  // above must be load-bearing for the REFUSAL and for nothing else: an earlier version indexed
  // straight into `authorized[0]`, so deleting that check turned a classified refusal into a raw
  // TypeError — which crashes a caller instead of telling it no. Measured by sabotage.
  const from = opts.from ?? read.authorized?.[0]?.address;
  const holder = (read.authorized ?? []).find((a) => lower(a.address) === lower(from));
  if (!isAddress(from) || !holder || holder.maySetAddr !== true) {
    return refuse(PREVIEW_STATUS.AUTHORIZATION_UNPROVEN, {
      from,
      observed: read.candidates?.map((c) => ({address: c.address, rootRoles: c.rootRoles})) ?? [],
    });
  }

  const target = opts.target ?? read.addrRecord;
  if (!isAddress(target)) return refuse(PREVIEW_STATUS.MISSING_TARGET);

  const value = opts.value ?? "0x0";
  if (BigInt(value) !== 0n) return refuse(PREVIEW_STATUS.VALUE_MUST_BE_ZERO, {value});

  const gas = opts.gas;
  if (gas === undefined || gas === null) return refuse(PREVIEW_STATUS.NO_GAS_ESTIMATE);

  const data = encodeSetAddrCall(read.node, target);

  return {
    ok: true,
    status: PREVIEW_STATUS.READY,
    explain: PREVIEW_EXPLAIN.READY,
    // The marker is first because it is the point. Anything that renders this object renders it.
    marker: OWNER_MARKER,
    transaction: {
      chainId: ENSV2.chainId,
      chainName: ENSV2.chainName,
      from,
      to: read.resolver,
      value,
      data,
    },
    decoded: {
      signature: SIGNATURES.setAddr,
      selector: data.slice(0, 10),
      arguments: [
        {name: "node", type: "bytes32", value: read.node, meaning: `namehash("${read.name}")`},
        {name: "a", type: "address", value: target, meaning: "the address this merchant name will publish"},
      ],
      isNoOp: read.addrRecord !== null && lower(target) === lower(read.addrRecord),
    },
    gas: {
      estimate: typeof gas === "string" ? gas : "0x" + BigInt(gas).toString(16),
      estimateDecimal: Number(BigInt(gas)),
      source: "eth_estimateGas against the deployed resolver",
      atBlock: opts.atBlock ?? null,
      note: "an estimate is a simulation at one block; it is not a promise about the block this lands in",
    },
    // The check that must hold. Copied out of the reading rather than recomputed, so a preview can
    // never claim an authorization that the reading did not actually observe.
    authorization: {
      mechanism: read.mechanism,
      resolver: read.resolver,
      implementation: read.implementation,
      resource: nameLevelResource(read.node),
      rootResource: "0x" + ROOT_RESOURCE.toString(16).padStart(64, "0"),
      requiredRole: "ROLE_SET_ADDR",
      requiredRoleBitmap: "0x" + ROLE.SET_ADDR.toString(16),
      account: from,
      observedRoles: holder.rootRoles,
      observedRoleNames: holder.rootRoleNames,
      discoveredVia: holder.source,
      holds: true,
    },
    broadcast: {
      byThisTool: false,
      why: "this directory imports no signer, reads no key, and names no writing JSON-RPC method",
      whoSigns: "the repository owner, in their own wallet",
      marker: OWNER_MARKER,
    },
  };
}

/// A last gate for anything that would render or hand off a preview. It exists so that a caller
/// cannot accidentally treat a refusal object as a preview: a refusal has no `transaction`, and
/// reading `.transaction.to` off one gives `undefined`, which is exactly the sort of thing that
/// reaches a wallet as a contract creation.
export function previewIsSignable(preview) {
  return Boolean(
    preview && preview.ok === true && preview.status === PREVIEW_STATUS.READY &&
    preview.marker === OWNER_MARKER &&
    preview.transaction && isAddress(preview.transaction.to) && isAddress(preview.transaction.from) &&
    BigInt(preview.transaction.value) === 0n &&
    typeof preview.transaction.data === "string" && preview.transaction.data.length === 138 &&
    preview.authorization && preview.authorization.holds === true &&
    preview.gas && Number.isFinite(preview.gas.estimateDecimal),
  );
}

// ── the command ───────────────────────────────────────────────────────────────────────────────

// Run as a command, or imported by the suite? Compared as resolved paths, because an `endsWith`
// on the basename matches any file whose name is a suffix of another one.
const isMain = process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === pathResolve(process.argv[1]);
if (isMain) {
  const args = process.argv.slice(2);
  const RPC = args.find((a) => a.startsWith("http")) || "https://ethereum-sepolia-rpc.publicnode.com";
  const rest = args.filter((a) => !a.startsWith("http"));
  const NAME = rest[0] || "raffy.eth";
  const TARGET = rest[1] || null;

  let id = 0;
  const rpc = async (method, params) => {
    const res = await fetch(RPC, {
      method: "POST", headers: {"content-type": "application/json"},
      body: JSON.stringify({jsonrpc: "2.0", id: ++id, method, params}),
    });
    const j = await res.json();
    if (j.error) { const e = new Error(j.error.message); e.data = j.error.data; throw e; }
    return j.result;
  };
  const chain = {
    call: (to, data, from) => rpc("eth_call", [from ? {to, data, from} : {to, data}, "latest"]),
    getCode: (a) => rpc("eth_getCode", [a, "latest"]),
    getStorageAt: (a, s) => rpc("eth_getStorageAt", [a, s, "latest"]),
  };

  const observed = Number(await rpc("eth_chainId", []));
  if (observed !== ENSV2.chainId) {
    console.error(`refusing: this endpoint is chain ${observed}, ENSv2 previews are built for ${ENSV2.chainId}`);
    process.exit(1);
  }
  const atBlock = Number(await rpc("eth_blockNumber", []));

  const read = await readAuthorization(NAME, chain);
  if (!read.ok) {
    console.error(`refusing: the authorization state could not be read (${read.status}${read.detail ? ` — ${read.detail}` : ""})`);
    process.exit(1);
  }

  const from = read.authorized[0]?.address;
  const target = TARGET ?? read.addrRecord;
  let gas = null;
  if (from && target) {
    try {
      gas = await rpc("eth_estimateGas", [{to: read.resolver, from, data: encodeSetAddrCall(read.node, target)}]);
    } catch (e) {
      // Fails closed either way — `buildPreview` refuses with NO_GAS_ESTIMATE on a null. But the
      // REASON was being discarded, so a refusal that meant "the endpoint rate-limited us" and one
      // that meant "this edit would revert" printed the same sentence, and neither is actionable
      // without the message. Kept on stderr so the JSON on stdout stays machine-readable.
      gas = null;
      console.error(`note: eth_estimateGas did not answer — ${e?.message ?? String(e)}`);
    }
  }

  const preview = buildPreview(read, {target, from, gas, atBlock});
  if (!preview.ok) {
    console.error(`REFUSED  ${preview.status}\n         ${preview.explain}${preview.detail ? `\n         ${preview.detail}` : ""}`);
    process.exit(1);
  }
  console.log(JSON.stringify({...preview, signable: previewIsSignable(preview)}, null, 2));
}
