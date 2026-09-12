// Colour is decided once and proven over the population, not over the three examples in front of us.
import assert from "node:assert/strict";
import { test } from "node:test";
import { INTEGRATIONS, accentForLabel, badgeColours, businessAccent, businessStyle, contrastRatio, hexToRgb, hslToHex, luminance, rgbToHsl, textOn } from "../assets/brand.js";

test("the WCAG arithmetic agrees with the published anchors", () => {
  assert.equal(luminance("#FFFFFF"), 1);
  assert.equal(luminance("#000000"), 0);
  assert.equal(Math.round(contrastRatio("#000000", "#FFFFFF")), 21);
  assert.equal(textOn("#FFFFFF"), "#111111");
  assert.equal(textOn("#000000"), "#FFFFFF");
  assert.deepEqual(hexToRgb("#FF007A"), [255, 0, 122]);
  assert.equal(hslToHex(rgbToHsl([255, 0, 122])), "#FF007A");
});

test("every integration colour carries readable text, and each is named with the one place it may appear", () => {
  for (const [key, it] of Object.entries(INTEGRATIONS)) {
    assert.ok(contrastRatio(it.colour, textOn(it.colour)) >= 4.5, `${key}: ${it.colour} text contrast`);
    assert.ok(it.where.length > 10, `${key} says where it may appear`);
  }
  assert.equal(Object.keys(INTEGRATIONS).join(","), "uniswap,graph,ens,chainlink");
});

test("the badge colours are read from the node exactly where the renderer reads them", () => {
  const node = "0x" + "aabbcc" + "112233" + "445566" + "778899" + "0a0b0c" + "00".repeat(17);
  assert.deepEqual(badgeColours(node), { background: "#AABBCC", palette: ["#112233", "#445566", "#778899", "#0A0B0C"] });
  assert.throws(() => badgeColours("0x1234"));
});

test("a business accent keeps the badge's hue, is deterministic, and reads in both schemes across thousands of nodes", () => {
  let seed = 0x9e3779b9;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const worst = { light: 21, dark: 21 };
  for (let i = 0; i < 3000; i += 1) {
    let hex = "";
    while (hex.length < 64) hex += next().toString(16).padStart(8, "0");
    const node = "0x" + hex.slice(0, 64);
    for (const scheme of ["light", "dark"]) {
      const a = businessAccent(node, scheme);
      const again = businessAccent(node, scheme);
      assert.deepEqual(a, again, "deterministic");
      const [hue] = rgbToHsl(hexToRgb(badgeColours(node).background));
      assert.ok(Math.abs(((a.hue - hue + 540) % 360) - 180) <= 1.5, `hue kept for ${node}`);
      const ratio = contrastRatio(a.hex, a.text);
      worst[scheme] = Math.min(worst[scheme], ratio);
    }
  }
  assert.ok(worst.light >= 4.5, `light: worst contrast ${worst.light.toFixed(2)}`);
  assert.ok(worst.dark >= 4.5, `dark: worst contrast ${worst.dark.toFixed(2)}`);
  assert.equal(businessAccent(null), null, "no node, no invented colour");
  assert.equal(businessStyle(null), "");
  assert.match(businessStyle(businessAccent("0x" + "ab".repeat(32))), /^--business-accent:#[0-9A-F]{6};--business-accent-text:#[0-9A-F]{6};$/);
});

test("a label without a node gets a deterministic preview hue with readable text", () => {
  const a = accentForLabel("freshcuts");
  assert.deepEqual(a, accentForLabel("FreshCuts"));
  const hues = new Set(Array.from({ length: 500 }, (_, i) => accentForLabel(`business-${i}`).hue));
  assert.ok(hues.size >= 150, `500 labels spread over ${hues.size} hues`); // any two may collide; the population may not collapse
  for (const name of ["a", "fresh-cuts", "zz", "coffee", "1", ""]) for (const scheme of ["light", "dark"]) {
    const x = accentForLabel(name, scheme);
    assert.ok(contrastRatio(x.hex, x.text) >= 4.5, `${name}/${scheme}`);
  }
});
