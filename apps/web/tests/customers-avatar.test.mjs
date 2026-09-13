// The Customers table is filled from The Graph; a named payer is drawn with their ENS avatar the
// same way the receipt draws its payer. Source-text rows plus one control; no DOM, no chain.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const js = readFileSync(new URL("../assets/customers.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../assets/screens/admin.css", import.meta.url), "utf8");

test("a named customer is drawn with their ENS avatar, gradient first, picture over", () => {
  assert.match(js, /import \{ avatarFallback, customerProfile \} from "\.\/ens-profile\.js"/);
  assert.match(js, /function drawCustomer\(cell, profile, payer\)/);
  assert.match(js, /circle\.className = "adm-avatar"/);
  assert.match(js, /avatarFallback\(profile\.name\)/, "the gradient must come from the name, never a typed colour");
  assert.match(js, /img\.addEventListener\("error", \(\) => img\.remove\(\)\)/, "a picture that never loads must leave the named circle behind");
  assert.match(js, /if \(cell\) drawCustomer\(cell, profile, row\.payer\)/);
});

test("the Customers stylesheet carries the avatar circle", () => {
  assert.match(css, /\.adm-avatar \{[^}]*border-radius: 50%/);
  assert.match(css, /\.adm-avatar img \{[^}]*object-fit: cover/);
});

test("control: a customer the chain does not name is left as the short address", () => {
  assert.match(js, /if \(!profile\.name\) return;/);
});
