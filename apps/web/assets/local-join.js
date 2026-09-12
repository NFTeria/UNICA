/**
 * The join screen (/join/): "Add your business", in plain language, from the owner's own wallet.
 *
 * WHAT ONE PRESS DOES. `join(label, payout, firstTerminalLabel)` on the onboarding contract
 * (src/identity/IMerchantOnboarding.sol, frozen) creates the business name under the practice
 * parent, records where the money goes, opens the `terminals` branch, switches on the first
 * register with the owner's wallet as its operator, and mints the business badge. Either all of
 * that exists when the transaction is mined, or none of it does; this screen never sends a second
 * transaction to "finish" a join.
 *
 * NOTHING HERE IS BAKED IN. Contract addresses, the parent name and the network all come from one
 * relative fetch of `./../local/config.json` (script/anvil/serve.sh). When that file names no
 * onboarding contract, the screen says so and stays a static page.
 *
 * THE OWNER SIGNS IN THEIR WALLET, OR NOT AT ALL. Sending goes through apps/web/assets/wallet.js,
 * which never sees a key. On the local practice network with no wallet installed, the chain's own
 * unlocked account is used, exactly as the pay screen already does.
 *
 * ABI ENCODING, BY HAND, FROM THE SPECIFICATION. `join`, `register`, `authorizeTextRoles` and
 * `setText` all take dynamic strings, which the pay screen's static-word encoder cannot express.
 * The head/tail encoder below is written from the Solidity ABI specification's description of
 * dynamic types (a head word holding the byte offset of the tail, the tail holding a length word
 * and the right-padded bytes) and is tested against calldata produced independently with `cast`
 * in apps/web/tests/local-join.test.mjs. keccak-256 itself is the one thing imported, from the
 * same browser-safe file the pay screen already uses.
 *
 * WORDS ON SCREEN. A person reads "business", "pay name", "register", "badge", "Local practice
 * network". No contract name, no calldata, and no hex reaches the page outside a "details"
 * disclosure, where one short copyable id is offered for support conversations.
 */
import { keccak256, toHex } from "../../../web/ensv2/keccak.mjs";
import { connectWallet, discoverProviders, isPracticeNetwork, networkName, waitForReceipt } from "./wallet.js";

// ---- ABI encoding: static words and dynamic strings ---------------------------------------------

const stripHex = (h) => (typeof h === "string" && (h.startsWith("0x") || h.startsWith("0X")) ? h.slice(2) : h);
const WORD = 64;

export function wordFromAddress(address) {
  const h = stripHex(address).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(h)) throw new Error(`not a 20-byte address: ${address}`);
  return h.padStart(WORD, "0");
}

export function wordFromUint(value) {
  const v = typeof value === "bigint" ? value : BigInt(value);
  if (v < 0n) throw new Error("uint256 is unsigned");
  const h = v.toString(16);
  if (h.length > WORD) throw new Error("value does not fit in 32 bytes");
  return h.padStart(WORD, "0");
}

export function wordFromBytes32(value) {
  const h = stripHex(value).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(h)) throw new Error(`not 32 bytes: ${value}`);
  return h;
}

export function wordFromBool(value) {
  return wordFromUint(value ? 1 : 0);
}

/** UTF-8 bytes of `s`, as hex, right-padded to a whole number of 32-byte words. */
export function paddedUtf8Hex(s) {
  const bytes = new TextEncoder().encode(String(s));
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  const remainder = hex.length % WORD;
  if (remainder !== 0) hex += "0".repeat(WORD - remainder);
  return { hex, byteLength: bytes.length };
}

const isDynamic = (type) => type === "string" || type === "bytes";

function encodeStatic(type, value) {
  switch (type) {
    case "address": return wordFromAddress(value);
    case "uint256": return wordFromUint(value);
    case "bytes32": return wordFromBytes32(value);
    case "bool": return wordFromBool(value);
    default: throw new Error(`unsupported static type: ${type}`);
  }
}

function encodeDynamic(type, value) {
  if (type !== "string") throw new Error(`unsupported dynamic type: ${type}`);
  const { hex, byteLength } = paddedUtf8Hex(value);
  return wordFromUint(byteLength) + hex;
}

/**
 * Encode `values` as the argument tuple for `types`. Static arguments occupy one head word each;
 * a dynamic argument's head word is the byte offset of its tail, measured from the start of the
 * tuple, and the tails follow the head in argument order.
 */
export function abiEncode(types, values) {
  if (types.length !== values.length) throw new Error(`expected ${types.length} values, got ${values.length}`);
  const headBytes = types.length * 32;
  const heads = [];
  const tails = [];
  let tailBytes = 0;
  for (let i = 0; i < types.length; i++) {
    if (isDynamic(types[i])) {
      const tail = encodeDynamic(types[i], values[i]);
      heads.push(wordFromUint(headBytes + tailBytes));
      tails.push(tail);
      tailBytes += tail.length / 2;
    } else {
      heads.push(encodeStatic(types[i], values[i]));
    }
  }
  return heads.join("") + tails.join("");
}

export function selectorOf(signature) {
  return toHex(keccak256(new TextEncoder().encode(signature)).slice(0, 4));
}

/** keccak-256 of an event signature: the first topic of every log that event emits. */
export function topicOf(signature) {
  return toHex(keccak256(new TextEncoder().encode(signature)));
}

export function typesOf(signature) {
  const inner = signature.slice(signature.indexOf("(") + 1, signature.lastIndexOf(")"));
  return inner === "" ? [] : inner.split(",").map((t) => t.trim());
}

/** Selector plus encoded arguments: the `data` field of a call or a transaction. */
export function encodeCall(signature, values) {
  return selectorOf(signature) + abiEncode(typesOf(signature), values);
}

// ---- ABI decoding of what the chain answers -----------------------------------------------------

export function wordsOf(hex) {
  const h = stripHex(hex ?? "");
  const out = [];
  for (let i = 0; i + WORD <= h.length; i += WORD) out.push(h.slice(i, i + WORD));
  return out;
}

export function decodeBool(hex) {
  return BigInt("0x" + (wordsOf(hex)[0] ?? "0")) !== 0n;
}

export function decodeBytes32(hex) {
  const w = wordsOf(hex)[0];
  return w ? "0x" + w : null;
}

export function decodeUint(hex) {
  const w = wordsOf(hex)[0];
  return w ? BigInt("0x" + w) : null;
}

export function decodeAddress(hex) {
  const w = wordsOf(hex)[0];
  return w ? "0x" + w.slice(24) : null;
}

/** Decode one `string` at byte offset `at` of the tuple `hex` (the offset a head word named). */
export function decodeStringAt(hex, at) {
  const h = stripHex(hex);
  const start = at * 2;
  const length = Number(BigInt("0x" + h.slice(start, start + WORD)));
  const data = h.slice(start + WORD, start + WORD + length * 2);
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = parseInt(data.slice(i * 2, i * 2 + 2), 16);
  return new TextDecoder().decode(bytes);
}

/** A function that returns a single `string`: head word is the offset, then length, then bytes. */
export function decodeString(hex) {
  const words = wordsOf(hex);
  if (words.length < 2) return "";
  return decodeStringAt(hex, Number(BigInt("0x" + words[0])));
}

const ZERO32 = "0x" + "0".repeat(64); // bytes32 zero: "nobody joined with it" in the interface
export function isZeroBytes32(value) {
  return !value || String(value).toLowerCase() === ZERO32;
}

export const BUSINESS_JOINED_SIGNATURE = "BusinessJoined(bytes32,address,string,address,bytes32,bytes32,uint256)";
export const SUBNAME_REGISTERED_SIGNATURE = "SubnameRegistered(bytes32,bytes32,string,address)";
export const ROLES_GRANTED_SIGNATURE = "RolesGranted(uint256,uint256,address)";
export const ROLES_REVOKED_SIGNATURE = "RolesRevoked(uint256,uint256,address)";

/** `BusinessJoined`: topics carry merchantNode and owner; data carries the rest. */
export function decodeBusinessJoinedLog(log) {
  const topics = log?.topics ?? [];
  if (topics.length !== 3) return null;
  const words = wordsOf(log.data);
  if (words.length < 5) return null;
  return {
    merchantNode: topics[1],
    owner: "0x" + stripHex(topics[2]).slice(24),
    label: decodeStringAt(log.data, Number(BigInt("0x" + words[0]))),
    payout: "0x" + words[1].slice(24),
    terminalsNode: "0x" + words[2],
    firstTerminalNode: "0x" + words[3],
    badgeTokenId: BigInt("0x" + words[4]),
  };
}

/** `SubnameRegistered`: topics carry parent and node; data carries label and owner. */
export function decodeSubnameRegisteredLog(log) {
  const topics = log?.topics ?? [];
  if (topics.length !== 3) return null;
  const words = wordsOf(log.data);
  if (words.length < 2) return null;
  return {
    parent: topics[1],
    node: topics[2],
    label: decodeStringAt(log.data, Number(BigInt("0x" + words[0]))),
    owner: "0x" + words[1].slice(24),
  };
}

/**
 * Replay grant and revoke logs in chain order and return the accounts that currently hold the
 * role. A revoke after a grant removes the account; a grant after a revoke restores it.
 */
export function foldRoleEvents(events) {
  const held = new Set();
  const sorted = [...events].sort((a, b) => {
    const blockDelta = Number(BigInt(a.blockNumber ?? 0)) - Number(BigInt(b.blockNumber ?? 0));
    if (blockDelta !== 0) return blockDelta;
    return Number(BigInt(a.logIndex ?? 0)) - Number(BigInt(b.logIndex ?? 0));
  });
  for (const ev of sorted) {
    const account = ("0x" + stripHex(ev.topics?.[2] ?? "").slice(24)).toLowerCase();
    if (ev.kind === "granted") held.add(account);
    else if (ev.kind === "revoked") held.delete(account);
  }
  return [...held];
}

// ---- name math, the same derivations the fixture uses -------------------------------------------

function hexToBytes(hex) {
  const h = stripHex(hex);
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** keccak256(parent ‖ keccak256(label)): the node of `<label>.<parent>`, as namehash defines it. */
export function childNode(parentNode, label) {
  const labelHash = keccak256(new TextEncoder().encode(label));
  const packed = new Uint8Array(64);
  packed.set(hexToBytes(parentNode), 0);
  packed.set(labelHash, 32);
  return toHex(keccak256(packed));
}

/** uint256(keccak256(abi.encode(node, keccak256(key)))): the per-key text resource. */
export function textResource(node, key) {
  const keyHash = keccak256(new TextEncoder().encode(key));
  const packed = new Uint8Array(64);
  packed.set(hexToBytes(node), 0);
  packed.set(keyHash, 32);
  return toHex(keccak256(packed));
}

// ---- label rules, mirrored for instant feedback; the contract's isValidLabel is the truth ------

export const LABEL_RULE_SENTENCE = "Use 3 to 32 lowercase letters, numbers and single hyphens, with no hyphen at the start or end.";

export function isValidLabelLocal(label) {
  if (typeof label !== "string") return false;
  if (label.length < 3 || label.length > 32) return false;
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(label);
}

/** "Register 1" -> "register-1": the name a person types becomes the label the chain stores. */
export function slugify(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function payNameFor(label, parentName) {
  return `${label}.${parentName ?? "unica.eth"}`;
}

/** A short id a person can read aloud or paste into a support message. Never the whole value. */
export function shortId(hex) {
  const h = String(hex ?? "");
  if (h.length <= 14) return h;
  return `${h.slice(0, 8)}…${h.slice(-4)}`;
}

// ---- the readiness rule for the one button ------------------------------------------------------

/**
 * Whether "Add my business" may be pressed, and the one sentence to show when it may not. Every
 * blocker is a plain sentence; the first unmet step in reading order is the one named, because
 * that is the next thing the person has to do.
 */
export function joinReadiness(state = {}) {
  if (!state.onboardingPresent) return { ready: false, sentence: "This practice setup has no onboarding contract yet, so a business cannot be added here." };
  if (!state.connected) return { ready: false, sentence: "Connect a wallet first. It becomes the owner of the business." };
  if (state.alreadyJoined) return { ready: false, sentence: "This wallet already owns a business. One business per wallet in this release." };
  if (!state.labelValid) return { ready: false, sentence: LABEL_RULE_SENTENCE };
  if (state.labelChecked === false) return { ready: false, sentence: "Checking whether that name is free..." };
  if (state.labelTaken) return { ready: false, sentence: "That name is already taken. Try another." };
  if (!state.payoutValid) return { ready: false, sentence: "The payout address must be a full address starting with 0x." };
  if (!state.registerValid) return { ready: false, sentence: `Give the first register a name. ${LABEL_RULE_SENTENCE}` };
  return { ready: true, sentence: "Ready. Your wallet will ask you to confirm one transaction." };
}

export function isAddress(value) {
  return /^0x[0-9a-fA-F]{40}$/.test(String(value ?? ""));
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// ---- the badge ------------------------------------------------------------------------------------

function base64Decode(b64) {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  throw new Error("no base64 decoder available");
}

/** `data:application/json;base64,...` -> { name, image, description }. Anything else -> null. */
export function parseTokenUri(uri) {
  const prefix = "data:application/json;base64,";
  if (typeof uri !== "string" || !uri.startsWith(prefix)) return null;
  try {
    const json = JSON.parse(base64Decode(uri.slice(prefix.length)));
    if (typeof json.image !== "string" || !json.image.startsWith("data:image/svg+xml;base64,")) return null;
    return { name: json.name ?? null, image: json.image, description: json.description ?? null };
  } catch {
    return null;
  }
}

// ---- chain readers, each taking the session from wallet.js -------------------------------------

export async function readLabelStatus(session, onboarding, label) {
  const valid = decodeBool(await session.call({ to: onboarding, data: encodeCall("isValidLabel(string)", [label]) }));
  if (!valid) return { valid: false, taken: false };
  const node = decodeBytes32(await session.call({ to: onboarding, data: encodeCall("nodeOf(string)", [label]) }));
  return { valid: true, taken: !isZeroBytes32(node), node };
}

export async function readMerchantOf(session, onboarding, owner) {
  return decodeBytes32(await session.call({ to: onboarding, data: encodeCall("merchantOf(address)", [owner]) }));
}

export async function readTerminalStatusKey(session, onboarding, fallback = "com.unica.terminal-status") {
  try {
    const key = decodeString(await session.call({ to: onboarding, data: encodeCall("TERMINAL_STATUS_KEY()", []) }));
    return key || fallback;
  } catch {
    return fallback;
  }
}

export async function readBadgeAddress(session, onboarding, fallback = null) {
  try {
    const a = decodeAddress(await session.call({ to: onboarding, data: encodeCall("badge()", []) }));
    return a && a !== ZERO_ADDRESS ? a : fallback;
  } catch {
    return fallback;
  }
}

/** The BusinessJoined record for `owner`, read back from the chain's own logs. */
export async function readBusinessJoined(session, onboarding, owner) {
  const logs = await session.request("eth_getLogs", [{
    fromBlock: "0x0",
    toBlock: "latest",
    address: onboarding,
    topics: [topicOf(BUSINESS_JOINED_SIGNATURE), null, "0x" + wordFromAddress(owner)],
  }]);
  const decoded = (logs ?? []).map(decodeBusinessJoinedLog).filter(Boolean);
  return decoded.length ? decoded[decoded.length - 1] : null;
}

export async function readBadge(session, badgeAddress, tokenId) {
  if (!badgeAddress || tokenId === null || tokenId === undefined) return null;
  const uri = decodeString(await session.call({ to: badgeAddress, data: encodeCall("tokenURI(uint256)", [tokenId]) }));
  return parseTokenUri(uri);
}

/** Every register under `terminalsNode`, with its status text and the accounts allowed to run it. */
export async function listRegisters(session, identity, terminalsNode, statusKey) {
  const logs = await session.request("eth_getLogs", [{
    fromBlock: "0x0",
    toBlock: "latest",
    address: identity,
    topics: [topicOf(SUBNAME_REGISTERED_SIGNATURE), terminalsNode],
  }]);
  const registers = [];
  for (const entry of (logs ?? []).map(decodeSubnameRegisteredLog).filter(Boolean)) {
    const status = decodeString(await session.call({ to: identity, data: encodeCall("text(bytes32,string)", [entry.node, statusKey]) }));
    const resource = textResource(entry.node, statusKey);
    const granted = await session.request("eth_getLogs", [{ fromBlock: "0x0", toBlock: "latest", address: identity, topics: [topicOf(ROLES_GRANTED_SIGNATURE), resource] }]);
    const revoked = await session.request("eth_getLogs", [{ fromBlock: "0x0", toBlock: "latest", address: identity, topics: [topicOf(ROLES_REVOKED_SIGNATURE), resource] }]);
    const operators = foldRoleEvents([
      ...(granted ?? []).map((l) => ({ ...l, kind: "granted" })),
      ...(revoked ?? []).map((l) => ({ ...l, kind: "revoked" })),
    ]);
    registers.push({ node: entry.node, label: entry.label, status: status || "", operators });
  }
  return registers;
}

/** The status word a person reads for a register's text value. */
export function registerStatusText(status) {
  const s = String(status ?? "").toLowerCase();
  if (s === "active") return "Active";
  if (s === "revoked") return "Revoked";
  if (s === "") return "Not switched on yet";
  return `Status: ${s}`;
}

// ---- DOM wiring; never runs under node --test -----------------------------------------------------

/** The business this page is showing, once joined or read back. Null until then. */
let currentBusiness = null;

if (typeof document !== "undefined" && document.getElementById("join")) {
  main().catch((e) => say("join-status", `Something went wrong on this page: ${e.message}`));
}

async function main() {
  let res;
  try {
    res = await fetch("./../local/config.json");
  } catch {
    return; // no companion server: the page stays the static document it already is
  }
  if (!res.ok) return;
  const config = await res.json();

  const onboarding = config.merchantOnboarding ?? null;
  const identity = config.identity ?? null;
  const parentName = config.parentName ?? "unica.eth";
  set("join-network", networkName(config.chainId));
  if (!isPracticeNetwork(config.chainId)) {
    // This site has no mainnet and this page has no mainnet path; say so rather than proceed.
    say("join-status", "This page only runs on a practice network. Nothing was sent.");
    return;
  }

  const state = {
    onboardingPresent: Boolean(onboarding && identity),
    connected: false,
    alreadyJoined: false,
    labelValid: false,
    labelChecked: false,
    labelTaken: false,
    payoutValid: true,
    registerValid: true,
  };
  if (!state.onboardingPresent) {
    say("join-status", joinReadiness(state).sentence);
    say("wallet", "The local practice setup has no onboarding contract yet, so there is nothing to connect to. Run the local deployment again once it includes one.");
    return;
  }

  let session = null;
  let statusKey = "com.unica.terminal-status";
  let badgeAddress = config.identityToken ?? null;

  const connectBtn = document.getElementById("connect");
  const joinBtn = document.getElementById("join-submit");
  const nameInput = document.getElementById("business-name");
  const payoutInput = document.getElementById("payout-address");
  const payoutOther = document.getElementById("payout-other");
  const registerInput = document.getElementById("register-name");
  if (connectBtn) connectBtn.disabled = false;
  say("wallet", "No wallet is connected yet.");

  const refresh = () => {
    const verdict = joinReadiness(state);
    if (joinBtn) joinBtn.disabled = !verdict.ready;
    say("join-why", verdict.sentence);
  };

  const readSlug = () => slugify(registerInput?.value ?? "Register 1");
  const updateRegisterHint = () => {
    const slug = readSlug();
    state.registerValid = isValidLabelLocal(slug);
    say("register-hint", state.registerValid ? `Saved as ${slug}.` : LABEL_RULE_SENTENCE);
    refresh();
  };

  const updatePayout = () => {
    const other = Boolean(payoutOther?.checked);
    if (payoutInput) payoutInput.disabled = !other;
    state.payoutValid = !other || isAddress(payoutInput?.value);
    refresh();
  };

  let labelSeq = 0;
  const updateLabel = async () => {
    const label = String(nameInput?.value ?? "").trim().toLowerCase();
    const seq = ++labelSeq;
    state.labelValid = isValidLabelLocal(label);
    state.labelChecked = false;
    state.labelTaken = false;
    if (!state.labelValid) {
      say("name-check", label ? LABEL_RULE_SENTENCE : "Type the name customers will pay. Lowercase letters, numbers and hyphens.");
      refresh();
      return;
    }
    say("name-check", `Your pay name will be ${payNameFor(label, parentName)}. Checking whether it is free...`);
    refresh();
    if (!session) {
      say("name-check", `Your pay name will be ${payNameFor(label, parentName)}. Connect a wallet to check whether it is free.`);
      return;
    }
    try {
      const result = await readLabelStatus(session, onboarding, label);
      if (seq !== labelSeq) return; // a newer keystroke superseded this check
      state.labelChecked = true;
      if (!result.valid) {
        state.labelValid = false;
        say("name-check", `The network refused that name. ${LABEL_RULE_SENTENCE}`);
      } else if (result.taken) {
        state.labelTaken = true;
        say("name-check", `${payNameFor(label, parentName)} is already taken. Try another name.`);
      } else {
        say("name-check", `Your pay name will be ${payNameFor(label, parentName)}. It is free.`);
      }
    } catch (e) {
      if (seq !== labelSeq) return;
      say("name-check", `Could not check that name right now: ${e.message}`);
    }
    refresh();
  };

  nameInput?.addEventListener("input", updateLabel);
  registerInput?.addEventListener("input", updateRegisterHint);
  payoutOther?.addEventListener("change", updatePayout);
  payoutInput?.addEventListener("input", updatePayout);
  updateRegisterHint();
  updatePayout();
  refresh();

  const showSuccess = async (joined) => {
    show("success");
    hide("form");
    set("done-business", joined.label);
    set("done-payname", payNameFor(joined.label, parentName));
    set("done-register", `${joined.firstRegisterLabel ?? "first register"}: Active`);
    set("done-network", networkName(config.chainId));
    set("done-id", shortId(joined.merchantNode));
    const copyBtn = document.getElementById("copy-id");
    if (copyBtn) copyBtn.onclick = () => navigator.clipboard?.writeText(joined.merchantNode).then(() => say("copy-said", "Copied."), () => say("copy-said", "Could not copy. Select the id and copy it by hand."));
    try {
      badgeAddress = await readBadgeAddress(session, onboarding, badgeAddress);
      const badge = await readBadge(session, badgeAddress, joined.badgeTokenId);
      const img = document.getElementById("badge-image");
      if (badge && img) {
        img.src = badge.image;
        img.alt = `Business badge for ${joined.label}`;
        img.hidden = false;
        say("badge-said", "Your business badge. It stays with this wallet and cannot be sold or moved.");
      } else {
        say("badge-said", "The badge could not be read yet. It is minted; reload this page to see it.");
      }
    } catch (e) {
      say("badge-said", `The badge could not be read: ${e.message}`);
    }
    await renderRegisters(joined);
  };

  const renderRegisters = async (joined) => {
    const list = document.getElementById("register-list");
    if (!list) return;
    say("registers-said", "Reading your registers...");
    try {
      const registers = await listRegisters(session, identity, joined.terminalsNode, statusKey);
      list.innerHTML = "";
      for (const r of registers) {
        const li = document.createElement("li");
        const name = document.createElement("strong");
        name.textContent = r.label;
        li.appendChild(name);
        li.appendChild(document.createTextNode(`: ${registerStatusText(r.status)}`));
        if (String(r.status).toLowerCase() === "active") {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "cta cta-quiet";
          btn.textContent = "Revoke";
          btn.setAttribute("aria-label", `Revoke register ${r.label}`);
          btn.onclick = () => revokeRegister(joined, r).catch((e) => say("registers-said", `Could not revoke ${r.label}: ${e.message}`));
          li.appendChild(document.createTextNode(" "));
          li.appendChild(btn);
        }
        list.appendChild(li);
      }
      say("registers-said", registers.length === 0 ? "No registers were found under this business." : `${registers.length} register${registers.length === 1 ? "" : "s"} read from the network.`);
    } catch (e) {
      say("registers-said", `Could not read the registers: ${e.message}`);
    }
  };

  const sendAndWait = async (label, tx) => {
    const hash = await session.send(tx);
    say("registers-said", `${label} Waiting for the network to confirm...`);
    const receipt = await waitForReceipt(session, hash);
    if (!receipt) throw new Error(`${label} was sent but is not confirmed yet. Reload this page in a moment.`);
    if (Number(receipt.status) === 0) throw new Error(`${label} was declined by the network.`);
    return receipt;
  };

  const addRegister = async (joined) => {
    const nameEl = document.getElementById("new-register-name");
    const operatorEl = document.getElementById("new-register-operator");
    const label = slugify(nameEl?.value ?? "");
    if (!isValidLabelLocal(label)) {
      say("registers-said", `Give the register a name. ${LABEL_RULE_SENTENCE}`);
      return;
    }
    const operator = operatorEl?.value?.trim() ? operatorEl.value.trim() : session.address;
    if (!isAddress(operator)) {
      say("registers-said", "The operator must be a full address starting with 0x, or leave it empty to use this wallet.");
      return;
    }
    const node = childNode(joined.terminalsNode, label);
    say("registers-said", `Step 1 of 3: creating the register "${label}". Confirm in your wallet.`);
    await sendAndWait("Step 1 of 3 (creating the register)", { to: identity, data: encodeCall("register(bytes32,string,address)", [joined.terminalsNode, label, session.address]) });
    say("registers-said", `Step 2 of 3: allowing ${shortId(operator)} to run "${label}". Confirm in your wallet.`);
    await sendAndWait("Step 2 of 3 (allowing the operator)", { to: identity, data: encodeCall("authorizeTextRoles(bytes32,string,address,bool)", [node, statusKey, operator, true]) });
    say("registers-said", `Step 3 of 3: switching "${label}" on. Confirm in your wallet.`);
    await sendAndWait("Step 3 of 3 (switching it on)", { to: identity, data: encodeCall("setText(bytes32,string,string)", [node, statusKey, "active"]) });
    if (nameEl) nameEl.value = "";
    await renderRegisters(joined);
  };

  const revokeRegister = async (joined, r) => {
    const steps = r.operators.length + 1;
    let n = 0;
    for (const operator of r.operators) {
      n++;
      say("registers-said", `Step ${n} of ${steps}: removing ${shortId(operator)} from "${r.label}". Confirm in your wallet.`);
      await sendAndWait(`Step ${n} of ${steps} (removing an operator)`, { to: identity, data: encodeCall("authorizeTextRoles(bytes32,string,address,bool)", [r.node, statusKey, operator, false]) });
    }
    n++;
    say("registers-said", `Step ${n} of ${steps}: marking "${r.label}" revoked. Confirm in your wallet.`);
    await sendAndWait(`Step ${n} of ${steps} (marking it revoked)`, { to: identity, data: encodeCall("setText(bytes32,string,string)", [r.node, statusKey, "revoked"]) });
    await renderRegisters(joined);
  };

  document.getElementById("add-register")?.addEventListener("click", () => {
    const joined = currentBusiness;
    if (joined) addRegister(joined).catch((e) => say("registers-said", `${e.message} Earlier steps that confirmed still stand; reload to see the current state.`));
  });

  connectBtn?.addEventListener("click", async () => {
    say("wallet", "Looking for a wallet in this browser...");
    try {
      const providers = await discoverProviders(window);
      const result = await connectWallet({ config, providers });
      if (result.blocked) {
        say("wallet", result.blocked);
        return;
      }
      session = result.session;
      state.connected = true;
      say("wallet", `Connected: ${shortId(session.address)} on ${session.networkName}${result.note ? `. ${result.note}` : "."}`);
      statusKey = await readTerminalStatusKey(session, onboarding, config.terminalStatusKey ?? statusKey);
      const existing = await readMerchantOf(session, onboarding, session.address);
      if (!isZeroBytes32(existing)) {
        state.alreadyJoined = true;
        refresh();
        say("join-status", "This wallet already owns a business. Its details are below.");
        const joined = await readBusinessJoined(session, onboarding, session.address);
        if (joined) {
          currentBusiness = { ...joined, firstRegisterLabel: null };
          await showSuccess(currentBusiness);
        } else {
          say("join-status", "This wallet already owns a business, but its record could not be read from the network.");
        }
        return;
      }
      await updateLabel();
    } catch (e) {
      say("wallet", `Could not connect: ${e.message}`);
    }
    refresh();
  });

  joinBtn?.addEventListener("click", async () => {
    const verdict = joinReadiness(state);
    if (!verdict.ready || !session) return;
    joinBtn.disabled = true;
    const label = String(nameInput?.value ?? "").trim().toLowerCase();
    const payout = payoutOther?.checked && isAddress(payoutInput?.value) ? payoutInput.value.trim() : ZERO_ADDRESS;
    const firstRegister = readSlug();
    try {
      say("join-status", "Confirm one transaction in your wallet. Nothing is created until the network confirms it.");
      const hash = await session.send({ to: onboarding, data: encodeCall("join(string,address,string)", [label, payout, firstRegister]) });
      say("join-status", "Sent. Waiting for the network to confirm...");
      const receipt = await waitForReceipt(session, hash);
      if (!receipt) {
        say("join-status", "Not confirmed yet. Reload this page in a moment; your wallet has the transaction.");
        return;
      }
      if (Number(receipt.status) === 0) {
        say("join-status", "Declined by the network. Nothing was created. Check the name is still free and try again.");
        state.labelChecked = false;
        await updateLabel();
        return;
      }
      const log = (receipt.logs ?? []).map(decodeBusinessJoinedLog).filter(Boolean)[0]
        ?? (await readBusinessJoined(session, onboarding, session.address));
      if (!log) {
        say("join-status", "Confirmed, but the record could not be read back. Reload this page to see your business.");
        return;
      }
      say("join-status", "Done. Your business is set up.");
      currentBusiness = { ...log, firstRegisterLabel: firstRegister };
      state.alreadyJoined = true;
      await showSuccess(currentBusiness);
    } catch (e) {
      say("join-status", `Could not add the business: ${e.message}`);
    } finally {
      refresh();
    }
  });
}

function say(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
function set(id, text) {
  say(id, text);
}
function show(id) {
  const el = document.getElementById(id);
  if (el) el.hidden = false;
}
function hide(id) {
  const el = document.getElementById(id);
  if (el) el.hidden = true;
}
