/**
 * A QR code for a payment link or a business page, drawn as inline SVG.
 *
 * The encoder is a declared dependency (qrcode-generator, MIT), copied by the build into
 * assets/vendor/ and loaded here on demand; nothing about it is retyped into this repository.
 * The wrapper exists so every screen draws a code the same way and so a test can hand in the
 * module directly instead of loading it from a built tree.
 */
let loaded = null;

/** The encoder module's factory, loaded once from the built vendor folder (or handed in). */
export async function loadQr({ impl = null } = {}) {
  if (impl) return impl;
  if (!loaded) {
    loaded = import(new URL("./vendor/qrcode-generator/qrcode.mjs", import.meta.url)).then((m) => m.default ?? m);
  }
  return loaded;
}

/**
 * Inline SVG for `text`, error-correction level M, sized by the caller through CSS (the SVG is
 * scalable). Returns { svg, modules } so a screen can also say how dense the code is.
 */
export function qrSvg(qrcode, text, { cell = 4, margin = 2, level = "M" } = {}) {
  if (typeof qrcode !== "function") throw new Error("qrSvg needs the encoder module");
  const value = String(text ?? "");
  if (!value) throw new Error("nothing to encode");
  const qr = qrcode(0, level);
  qr.addData(value);
  qr.make();
  const svg = qr.createSvgTag({ cellSize: cell, margin, scalable: true });
  return { svg, modules: qr.getModuleCount() };
}
