/**
 * Colour, decided once.
 *
 * UNICA's own brand is neutral: ink on paper, one scarce accent. Colour beyond that means one of two
 * things and nothing else:
 *
 *   1. An integration, in that integration's own colour, only where that integration is the thing
 *      on screen: Uniswap where a payment is converted, The Graph where a receipt is indexed, ENS
 *      where a name is registered or resolved, Chainlink where a price feed is what set the price
 *      the person is reading. Attribution, not decoration; never more than one of them in a view.
 *   2. The business itself. Every business owns a badge whose colours come from its ENS node, so
 *      the business's accent in the app is the HUE of its badge's ground, held at a calm saturation
 *      and a lightness the scheme needs. The badge and the app then agree without either shouting.
 *
 * Text on any accent is COMPUTED, never assumed: the darker or the lighter candidate wins by
 * contrast ratio, and a test walks thousands of nodes in both schemes to prove the floor holds.
 */

export const INTEGRATIONS = Object.freeze({
  uniswap: Object.freeze({ name: "Uniswap", colour: "#FF007A", where: "a payment is converted" }),
  graph: Object.freeze({ name: "The Graph", colour: "#6F4CFF", where: "a receipt is indexed" }),
  ens: Object.freeze({ name: "ENS", colour: "#5298FF", where: "a name is registered or resolved" }),
  chainlink: Object.freeze({ name: "Chainlink", colour: "#375BD2", where: "a price feed set the price on screen" }),
});

const INK = "#111111";
const PAPER = "#FFFFFF";
const HEX6 = /^#?([0-9a-fA-F]{6})$/;
const NODE = /^0x[0-9a-fA-F]{64}$/;

export function hexToRgb(hex) {
  const m = HEX6.exec(String(hex ?? "").trim());
  if (!m) throw new Error(`not a 6-digit hex colour: ${String(hex)}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]) {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** Relative luminance per WCAG 2.x. */
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. */
export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** The text colour that reads best on `background`: the darker or the lighter candidate by measured contrast. */
export function textOn(background, dark = INK, light = PAPER) {
  return contrastRatio(background, dark) >= contrastRatio(background, light) ? dark : light;
}

export function rgbToHsl([r, g, b]) {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === R) h = ((G - B) / d + (G < B ? 6 : 0)) / 6;
  else if (max === G) h = ((B - R) / d + 2) / 6;
  else h = ((R - G) / d + 4) / 6;
  return [h * 360, s, l];
}

export function hslToHex([h, s, l]) {
  const H = (((h % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => {
    let T = t;
    if (T < 0) T += 1;
    if (T > 1) T -= 1;
    if (T < 1 / 6) return p + (q - p) * 6 * T;
    if (T < 1 / 2) return q;
    if (T < 2 / 3) return p + (q - p) * (2 / 3 - T) * 6;
    return p;
  };
  return rgbToHex([channel(H + 1 / 3) * 255, channel(H) * 255, channel(H - 1 / 3) * 255]);
}

/**
 * The badge's own colours, derived exactly as the badge renderer derives them from the ENS node:
 * the ground is bytes 0..2 and the four tile colours are bytes 3..5, 6..8, 9..11 and 12..14.
 */
export function badgeColours(node) {
  if (!NODE.test(String(node ?? ""))) throw new Error("a business node is 32 bytes as 0x-prefixed hex");
  const bytes = String(node).slice(2);
  const at = (i) => "#" + bytes.slice(i * 2, i * 2 + 6).toUpperCase();
  return { background: at(0), palette: [at(3), at(6), at(9), at(12)] };
}

/**
 * The business's accent for the app: the badge ground's hue, at a saturation that stays calm and a
 * lightness chosen for the scheme, with the text colour that reads on it. Returns null for a
 * business with no node yet, so a caller falls back to the neutral brand rather than inventing one.
 */
export function businessAccent(node, scheme = "light") {
  if (!NODE.test(String(node ?? ""))) return null;
  const [hue] = rgbToHsl(hexToRgb(badgeColours(node).background));
  return { hue: Math.round(hue), ...settle(hue, scheme), scheme };
}

/**
 * The accent for one hue in one scheme, with its lightness moved until the better text candidate
 * reads at 4.5:1 or more. A fixed lightness fails on the yellow-green band, where neither black
 * nor white reaches the floor; the population test found that, so the lightness is computed, not
 * picked. Light scheme starts mid-dark and darkens; dark scheme starts light and lightens.
 */
const FLOOR = 4.5;
function settle(hue, scheme) {
  const dark = scheme === "dark";
  let l = dark ? 0.64 : 0.36;
  for (let i = 0; i < 40; i += 1) {
    const hex = hslToHex([hue, 0.42, l]);
    const text = textOn(hex);
    if (contrastRatio(hex, text) >= FLOOR) return { hex, text };
    l += dark ? 0.01 : -0.01;
  }
  const hex = hslToHex([hue, 0.42, dark ? 0.9 : 0.12]);
  return { hex, text: textOn(hex) };
}

/** A hue for a name that has no node yet (a preview while typing): deterministic, never stored. */
export function accentForLabel(label, scheme = "light") {
  let h = 2166136261;
  for (const ch of String(label ?? "").toLowerCase()) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const hue = h % 360;
  return { hue, ...settle(hue, scheme), scheme };
}

/** The CSS custom properties a page sets for one business, as a single style string. */
export function businessStyle(accent) {
  if (!accent) return "";
  return `--business-accent:${accent.hex};--business-accent-text:${accent.text};`;
}
