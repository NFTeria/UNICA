// Which deployment the workflow is talking to — chosen explicitly, never defaulted.
//
// THE REASON THIS FILE EXISTS. The challenge repository ships two disagreeing address sets at the
// pinned commit. The README names the official contracts; `config.staging.json` in the example
// workflow names different ones. A participant who runs the example unchanged protects a position
// on a deployment the organisers are not scoring, and nothing in the example says so.
//
// So there is no default. Selecting a profile is an argument, mixing addresses across profiles is
// refused, and the mismatch is recorded here as an unresolved fact rather than quietly settled by
// picking the one that looked more official.

export const PROFILE_STATUS = {
  UNRESOLVED_MISMATCH: "UNRESOLVED_MISMATCH",
};

/// Both sets, transcribed at the pinned commit, each carrying where it came from.
export const PROFILES = {
  README_PROFILE: {
    name: "README_PROFILE",
    source: "README.md, 'Challenge official smart contracts'",
    sourceCommit: "58b24604795cd4c8a32ccd30e4d11f4962e3b3ac",
    chainId: 11155111,
    chainName: "Ethereum Sepolia",
    lending: "0x9792b3cc50e1A3e538d8C4655025304F39d8CAb9",
    vETH: "0x5dED1a40c3D56dA42E7f932f781c0432556c9814",
    vUSD: "0x6Fe92Ead5299040f50F095860b5A0A7A2D4041A2",
    decimals: 2,
    authoritative: "claimed by the README, which also instructs participants to use it",
  },
  STAGING_CONFIG_PROFILE: {
    name: "STAGING_CONFIG_PROFILE",
    source: "automated-liquidation-protection-workflow/config.staging.json",
    sourceCommit: "58b24604795cd4c8a32ccd30e4d11f4962e3b3ac",
    chainId: 11155111,
    chainName: "Ethereum Sepolia",
    lending: "0x63b918368a2c3c08f3b3eCEdc8eA6c49E674c4B7",
    vETH: "0x89F0DF6D4629D494D599E03505C323537C24667a",
    vUSD: "0xC96c007023Ae2a23D097D5D95d4b91D6a501Da0b",
    decimals: 2,
    authoritative: "what the shipped example actually runs against",
  },
};

/// The mismatch, stated once so no other file has to decide about it.
export const ADDRESS_MISMATCH = {
  status: PROFILE_STATUS.UNRESOLVED_MISMATCH,
  observedAt: "58b24604795cd4c8a32ccd30e4d11f4962e3b3ac",
  differing: ["lending", "vETH", "vUSD"],
  consequence:
    "a workflow run against the wrong profile protects a position the organisers are not scoring",
  publicDeployment: "BLOCKED until the organisers say which set is authoritative",
};

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export const SELECT_STATUS = {
  SELECTED: "SELECTED",
  NO_PROFILE_NAMED: "NO_PROFILE_NAMED",
  UNKNOWN_PROFILE: "UNKNOWN_PROFILE",
  WRONG_CHAIN: "WRONG_CHAIN",
  MIXED_PROFILES: "MIXED_PROFILES",
  MALFORMED_ADDRESS: "MALFORMED_ADDRESS",
};

const lower = (s) => String(s ?? "").toLowerCase();

/// Pick a profile. `name` is required; there is deliberately no fallback.
///
/// @param overrides addresses a caller believes it is using. Every one must come from the SAME
///        profile — an override that matches the other profile is the exact mistake this refuses.
export function selectProfile(name, {expectedChainId, overrides = {}} = {}) {
  if (!name) return {ok: false, status: SELECT_STATUS.NO_PROFILE_NAMED};
  const profile = PROFILES[name];
  if (!profile) return {ok: false, status: SELECT_STATUS.UNKNOWN_PROFILE, detail: name};

  if (expectedChainId !== undefined && Number(expectedChainId) !== profile.chainId) {
    return {ok: false, status: SELECT_STATUS.WRONG_CHAIN,
            detail: `profile is chain ${profile.chainId}, caller expected ${expectedChainId}`};
  }

  for (const [field, value] of Object.entries(overrides)) {
    if (value === undefined || value === null) continue;
    if (!ADDRESS.test(value)) {
      return {ok: false, status: SELECT_STATUS.MALFORMED_ADDRESS, detail: `${field}=${value}`};
    }
    if (lower(value) === lower(profile[field])) continue;
    // Does it belong to the OTHER profile? That is address mixing, and it is refused by name
    // rather than by a generic mismatch, because the two are different mistakes.
    const other = Object.values(PROFILES).find((p) => p.name !== profile.name && lower(p[field]) === lower(value));
    return {
      ok: false,
      status: SELECT_STATUS.MIXED_PROFILES,
      detail: other
        ? `${field} belongs to ${other.name}, not ${profile.name}`
        : `${field} is in neither profile`,
    };
  }

  return {ok: true, status: SELECT_STATUS.SELECTED, profile, mismatch: ADDRESS_MISMATCH};
}

/// The read-only checks a caller MAY run against a chain before trusting a profile. Returned as a
/// plan rather than executed, because this module never opens a socket: the adapter is testable
/// offline precisely because nothing in it needs a network.
export function validationPlan(profile) {
  return [
    {check: "chain id", method: "eth_chainId", expect: profile.chainId},
    {check: "lending contract has code", method: "eth_getCode", address: profile.lending},
    {check: "vETH has code", method: "eth_getCode", address: profile.vETH},
    {check: "vUSD has code", method: "eth_getCode", address: profile.vUSD},
    {check: "vETH decimals", method: "eth_call", address: profile.vETH, expect: profile.decimals},
    {check: "vUSD decimals", method: "eth_call", address: profile.vUSD, expect: profile.decimals},
    {check: "lending names these tokens", method: "eth_call", address: profile.lending,
     note: "only if the contract exposes its token addresses"},
  ];
}
