/**
 * fold.js — mirror the device posture onto the document, and nothing else.
 *
 * WHAT IT IS FOR. assets/fold.css already answers `@media (device-posture: folded)`, which is the
 * standard and the preferred path. This file exists for the browsers that ship the DevicePosture
 * OBJECT before they ship the media feature: it copies `navigator.devicePosture.type` onto
 * <html data-posture>, and fold.css carries the same rules keyed to that attribute. Either route
 * produces the same frame; neither is required for the product to work.
 *
 * WHAT IT DELIBERATELY IS NOT. It exports nothing, it reads no user-agent string, it names no
 * device, it stores nothing, and it never touches a payment. If `navigator.devicePosture` is
 * absent it does nothing at all and leaves the attribute unset, so the CSS default — the solid,
 * single-pane frame — stands. There is no polyfill and no guess: an unknown posture is not
 * reported as `continuous`, because "the device is open" and "nobody asked the device" are
 * different facts and a frame that shows one as the other is lying quietly.
 *
 * The posture vocabulary is two words, `folded` and `continuous`. There is no hinge ANGLE on the
 * web platform, so what this file drives is a transition between two states, not an animation of a
 * hinge. docs/unica-v4/SCREENS.md says so in prose for the next person who asks.
 */

const doc = globalThis.document;
const posture = globalThis.navigator?.devicePosture;

if (doc?.documentElement && posture) {
  const apply = () => {
    const type = posture.type;
    // Only the two values the specification defines are written. An unrecognised one is dropped
    // rather than passed through: a stylesheet keyed to an attribute should never be steered by a
    // string this file has not seen before.
    if (type === "folded" || type === "continuous") {
      doc.documentElement.setAttribute("data-posture", type);
    } else {
      doc.documentElement.removeAttribute("data-posture");
    }
  };

  apply();
  posture.addEventListener?.("change", apply);
}

/**
 * An empty export list, and it is load-bearing rather than tidy. Without a single piece of module
 * syntax this file has none — Node parses a `.js` under a package.json with no `"type"` as
 * CommonJS, which gave it a phantom `default` export and a require cache that ignored the
 * cache-busting query, so the second test in a run silently re-read the first one's module instead
 * of evaluating this one again. `export {}` makes the file unambiguously an ES module in every
 * loader, and still exports nothing.
 */
export {};
