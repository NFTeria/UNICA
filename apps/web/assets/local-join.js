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
import { connectWallet, discoverProviders, isPracticeNetwork, networkName, waitForReceipt } from "./wallet.js";
import { loadConfig } from "./local.js";
import { ASSET_STATUS, assetMenu, validateEnvironment } from "./product.js";
import {
  wordFromAddress,
  wordFromUint,
  wordFromBytes32,
  wordFromBool,
  paddedUtf8Hex,
  abiEncode,
  selectorOf,
  topicOf,
  typesOf,
  encodeCall,
  wordsOf,
  decodeBool,
  decodeBytes32,
  decodeUint,
  decodeAddress,
  decodeStringAt,
  decodeString,
  isZeroBytes32,
  BUSINESS_JOINED_SIGNATURE,
  SUBNAME_REGISTERED_SIGNATURE,
  ROLES_GRANTED_SIGNATURE,
  ROLES_REVOKED_SIGNATURE,
  decodeBusinessJoinedLog,
  decodeSubnameRegisteredLog,
  foldRoleEvents,
  childNode,
  textResource,
} from "./abi.js";
// Re-exported so this file stays the one place the join screen is imported from, and so
// apps/web/tests/local-join.test.mjs keeps exercising these through the screen that uses them.
export {
  wordFromAddress,
  wordFromUint,
  wordFromBytes32,
  wordFromBool,
  paddedUtf8Hex,
  abiEncode,
  selectorOf,
  topicOf,
  typesOf,
  encodeCall,
  wordsOf,
  decodeBool,
  decodeBytes32,
  decodeUint,
  decodeAddress,
  decodeStringAt,
  decodeString,
  isZeroBytes32,
  BUSINESS_JOINED_SIGNATURE,
  SUBNAME_REGISTERED_SIGNATURE,
  ROLES_GRANTED_SIGNATURE,
  ROLES_REVOKED_SIGNATURE,
  decodeBusinessJoinedLog,
  decodeSubnameRegisteredLog,
  foldRoleEvents,
  childNode,
  textResource,
};


// ---- label rules, mirrored for instant feedback; the contract's isValidLabel is the truth ------

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

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
  if (!state.payoutValid) return { ready: false, sentence: "The payout wallet must be a full address starting with 0x." };
  if (state.payoutAssetChosen === false) return { ready: false, sentence: "Choose the asset you want to receive." };
  if (state.acceptedCount === 0) return { ready: false, sentence: "Choose at least one asset your customers may pay with." };
  if (!state.registerValid) return { ready: false, sentence: `Give the first register a name. ${LABEL_RULE_SENTENCE}` };
  if (state.limitValid === false) return { ready: false, sentence: "A transaction limit must be digits, for example 250. Leave it empty for no limit." };
  return { ready: true, sentence: "Ready. Your wallet will ask you to confirm one transaction." };
}

/**
 * An optional transaction limit, as typed. Empty means no limit, which is a real answer rather
 * than a missing one; anything that is not a plain number is refused instead of silently ignored,
 * because a limit a business believes it set and this page dropped is worse than no limit at all.
 */
export function readLimit(text) {
  const value = String(text ?? "").trim();
  if (value === "") return { valid: true, limit: null, sentence: "No limit. Any amount may be charged." };
  if (!/^\d+(\.\d+)?$/.test(value)) return { valid: false, limit: null, sentence: "A transaction limit must be digits, for example 250. Leave it empty for no limit." };
  return { valid: true, limit: value, sentence: `No single payment above ${value}.` };
}

/**
 * The lines shown under "Confirm", so a person reads back exactly what they are about to create.
 * It is a pure function of the answers, which is why the confirmation cannot drift away from the
 * form: there is nowhere else for these sentences to come from.
 */
export function summariseJoin(answers = {}) {
  const label = String(answers.label ?? "").trim();
  return {
    name: label || "Not chosen yet",
    payName: label ? payNameFor(label, answers.parentName) : "Not chosen yet",
    payout: answers.payout && answers.payout !== ZERO_ADDRESS ? answers.payout : "The wallet you connected",
    asset: answers.payoutAssetSymbol ?? "Not chosen yet",
    accepts: Array.isArray(answers.accepted) && answers.accepted.length ? answers.accepted.join(", ") : "Nothing chosen yet",
    register: answers.register ? answers.register : "Not named yet",
    limit: answers.limit ? `No single payment above ${answers.limit}` : "No limit",
  };
}

export function isAddress(value) {
  return /^0x[0-9a-fA-F]{40}$/.test(String(value ?? ""));
}

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

/**
 * Revoke one register, on chain, in the order that leaves nothing half-done if a step is declined:
 * every operator loses the right to run it FIRST, and only then is it marked revoked. Doing it the
 * other way round would leave a register marked revoked that an operator could still be authorized
 * on, which is the difference between a switched-off till and one that only looks switched off.
 *
 * `onStep(n, total, sentence)` is called before each wallet confirmation so a screen can say which
 * step a person is being asked to approve. Both screens that revoke use this function; neither has
 * its own copy of the order of operations.
 */
export async function revokeRegisterOnChain({ session, identity, statusKey, register, onStep = () => {}, waitFor = waitForReceipt }) {
  const operators = register?.operators ?? [];
  const total = operators.length + 1;
  let n = 0;
  const send = async (label, tx) => {
    const hash = await session.send(tx);
    const receipt = await waitFor(session, hash);
    if (!receipt) throw new Error(`${label} was sent but is not confirmed yet. Reload this page in a moment.`);
    if (Number(receipt.status) === 0) throw new Error(`${label} was declined by the network.`);
    return receipt;
  };
  for (const operator of operators) {
    n++;
    onStep(n, total, `Step ${n} of ${total}: removing ${shortId(operator)} from "${register.label}". Confirm in your wallet.`);
    await send(`Step ${n} of ${total} (removing an operator)`, {
      to: identity,
      data: encodeCall("authorizeTextRoles(bytes32,string,address,bool)", [register.node, statusKey, operator, false]),
    });
  }
  n++;
  onStep(n, total, `Step ${n} of ${total}: marking "${register.label}" revoked. Confirm in your wallet.`);
  await send(`Step ${n} of ${total} (marking it revoked)`, {
    to: identity,
    data: encodeCall("setText(bytes32,string,string)", [register.node, statusKey, "revoked"]),
  });
  return { steps: total };
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
  const config = await loadConfig();
  // No companion server: the page stays the static document it already is, which still describes
  // every step honestly.
  if (!config) return;

  const environment = validateEnvironment(config.manifest ?? config);
  const banner = document.getElementById("env-banner");
  if (banner) {
    banner.textContent = environment.banner
      ? `${environment.banner} — ${environment.networkName}. ${environment.reason}`
      : `${environment.networkName}. ${environment.reason}`;
  }

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
    payoutAssetChosen: false,
    acceptedCount: 0,
    registerValid: true,
    limitValid: true,
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

  // What the owner has answered so far. The payout asset, the accepted assets and any limit are
  // register settings this browser keeps: the frozen onboarding call takes a name, a payout wallet
  // and a first register, and nothing else, so claiming these were written to the network would be
  // a claim this product cannot back up. The page says so, under the button.
  const answers = { label: "", parentName, payout: ZERO_ADDRESS, payoutAssetSymbol: null, accepted: [], register: "", limit: null };

  const refresh = () => {
    const verdict = joinReadiness(state);
    if (joinBtn) joinBtn.disabled = !verdict.ready;
    say("join-why", verdict.sentence);
    const summary = summariseJoin(answers);
    say("confirm-name", summary.name);
    say("confirm-payname", summary.payName);
    say("confirm-payout", summary.payout);
    say("confirm-asset", summary.asset);
    say("confirm-accepts", summary.accepts);
    say("confirm-register", summary.register);
    say("confirm-limit", summary.limit);
  };

  // The assets this setup can actually handle, offered as answers 4 and 5.
  const menu = assetMenu(config);
  const payoutSelect = document.getElementById("payout-asset");
  if (payoutSelect) {
    payoutSelect.innerHTML = "";
    for (const asset of menu.filter((a) => a.labelled)) {
      const option = document.createElement("option");
      option.value = asset.address;
      option.textContent = asset.symbol;
      payoutSelect.appendChild(option);
    }
    const preferred = menu.find((a) => a.role === "payout" && a.labelled) ?? menu.find((a) => a.labelled) ?? null;
    if (preferred) payoutSelect.value = preferred.address;
    state.payoutAssetChosen = Boolean(preferred);
    answers.payoutAssetSymbol = preferred?.symbol ?? null;
    payoutSelect.addEventListener("change", () => {
      const chosen = menu.find((a) => a.address === payoutSelect.value) ?? null;
      state.payoutAssetChosen = Boolean(chosen);
      answers.payoutAssetSymbol = chosen?.symbol ?? null;
      refresh();
    });
  }

  const acceptList = document.getElementById("accept-list");
  if (acceptList) {
    acceptList.innerHTML = "";
    for (const asset of menu) {
      const li = document.createElement("li");
      const label = document.createElement("label");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.value = asset.symbol ?? asset.address;
      box.checked = asset.status !== ASSET_STATUS.UNAVAILABLE;
      box.disabled = asset.status === ASSET_STATUS.UNAVAILABLE;
      label.append(box, document.createTextNode(` ${asset.symbol ?? asset.address}`));
      const badge = document.createElement("span");
      badge.className = "availability";
      badge.dataset.status = asset.status;
      badge.textContent = asset.text;
      const why = document.createElement("span");
      why.className = "why";
      why.textContent = asset.why;
      li.append(label, badge, why);
      acceptList.appendChild(li);
      box.addEventListener("change", () => {
        answers.accepted = [...acceptList.querySelectorAll("input:checked")].map((i) => i.value);
        state.acceptedCount = answers.accepted.length;
        refresh();
      });
    }
    answers.accepted = [...acceptList.querySelectorAll("input:checked")].map((i) => i.value);
    state.acceptedCount = answers.accepted.length;
    const offered = menu.filter((a) => a.status !== ASSET_STATUS.UNAVAILABLE).length;
    say("accept-said", `${menu.length} payment asset${menu.length === 1 ? "" : "s"} read, ${offered} can be accepted right now.`);
  }

  const limitInput = document.getElementById("tx-limit");
  limitInput?.addEventListener("input", () => {
    const verdict = readLimit(limitInput.value);
    state.limitValid = verdict.valid;
    answers.limit = verdict.limit;
    say("limit-hint", verdict.sentence);
    refresh();
  });

  const readSlug = () => slugify(registerInput?.value ?? "Register 1");
  const updateRegisterHint = () => {
    const slug = readSlug();
    answers.register = slug;
    state.registerValid = isValidLabelLocal(slug);
    say("register-hint", state.registerValid ? `Saved as ${slug}.` : LABEL_RULE_SENTENCE);
    refresh();
  };

  const updatePayout = () => {
    const other = Boolean(payoutOther?.checked);
    if (payoutInput) payoutInput.disabled = !other;
    state.payoutValid = !other || isAddress(payoutInput?.value);
    answers.payout = other && isAddress(payoutInput?.value) ? payoutInput.value.trim() : ZERO_ADDRESS;
    refresh();
  };

  let labelSeq = 0;
  const updateLabel = async () => {
    const label = String(nameInput?.value ?? "").trim().toLowerCase();
    answers.label = label;
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
    await revokeRegisterOnChain({
      session,
      identity,
      statusKey,
      register: r,
      onStep: (_n, _total, sentence) => say("registers-said", sentence),
    });
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
