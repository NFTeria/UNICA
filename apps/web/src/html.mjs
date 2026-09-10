/**
 * Escaping and small HTML helpers.
 *
 * `h` is a tagged template that escapes EVERY interpolation. That direction matters: escaping by
 * default and opting out explicitly means a forgotten call is safe, whereas escaping on demand
 * means a forgotten call is a hole. Anything genuinely pre-rendered is wrapped in `raw()`, which is
 * greppable — `git grep 'raw('` is the complete list of places trust was extended.
 */

const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ENTITIES[c]);
}

/** Marks a string as already-safe HTML. Every use is a deliberate, reviewable decision. */
export function raw(html) {
  return { __raw: String(html) };
}

const render = (v) => {
  if (v === null || v === undefined || v === false) return "";
  if (Array.isArray(v)) return v.map(render).join("");
  if (typeof v === "object" && "__raw" in v) return v.__raw;
  return esc(v);
};

export function h(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return out;
}

/** A long hex string that must wrap rather than force the page to scroll sideways. */
export function hex(value, label) {
  return raw(
    h`<span class="hex" ${label ? raw(`aria-label="${esc(label)}"`) : ""} translate="no">${value}</span>`,
  );
}

/**
 * An evidence badge. Text AND shape carry the meaning, never colour alone: `mock` and `simulated`
 * both read as provisional to someone who cannot distinguish the two hues.
 */
export function evidenceBadge(cls) {
  const label = cls === "confirmed" ? "Testnet settled" : cls === "simulated" ? "Simulation" : "Mock";
  const mark = cls === "confirmed" ? "✓" : cls === "simulated" ? "◐" : "○";
  return raw(
    h`<span class="badge badge-${cls}" data-evidence="${cls}"><span aria-hidden="true">${mark}</span> ${label}</span>`,
  );
}
