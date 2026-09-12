// api/local.mjs — the UNICA companion behind a public host.
//
// This is the SECOND place script/anvil/companion.mjs runs. On the owner's laptop
// script/anvil/serve.sh binds a socket and the same module serves both the built screens and the
// /local/ endpoints. Here the host's own edge serves the built screens out of apps/web/out, and
// this function answers only what vercel.json rewrites to it: every /local/* path, and the two
// repository files the browser assets import by their real relative paths.
//
// WHAT THIS FILE IS FOR, AND ALL IT IS FOR. It reads the environment — which the module never does
// — turns it into the parameters `createCompanion` takes, and restores the path the visitor
// actually asked for. Every rule about what the endpoints answer lives in the module, so the public
// deployment and the laptop cannot drift apart.
//
// THE NODE URL NEVER LEAVES THIS PROCESS. UNICA_RPC_URL is a Vercel environment variable, typed by
// the owner into Vercel, never written into a file in this repository. The screens are handed
// "/local/rpc" — the same-origin pipe — and every upstream message is redacted before it can be
// printed. A public host is exactly where that matters: the URL usually carries a key.
//
// WHY THE PATH ARRIVES IN A QUERY PARAMETER. A rewrite hands the function the DESTINATION path, so
// `req.url` would read /api/local for every one of the eight endpoints. vercel.json therefore puts
// the original path in `__companionPath`, and this file puts it back on the request before the
// module sees it. The module is never told it is behind a rewrite.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { createCompanion } from "../script/anvil/companion.mjs";

// The repository, as laid out inside the function bundle: this file sits at api/, so its parent is
// the root that deployments/, tools/, web/ and script/ were included relative to. Derived from this
// module's own location rather than from the working directory, which a host is free to change.
const BUNDLE_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

const MANIFEST_PATH = process.env.UNICA_MANIFEST_PATH || "deployments/unica-v4/11155111.json";
const RPC_URL = process.env.UNICA_RPC_URL || "";
const SUBGRAPH_URL = process.env.UNICA_SUBGRAPH_URL || null;

// One root, chosen once, by asking whether the manifest is actually there. The bundle layout is the
// answer everywhere it holds; the working directory is the fallback for a host that lays a function
// out differently. If neither has the manifest this refuses to answer at all, naming the path it
// looked for — a companion that served a config.json for a manifest it could not read would be
// describing a deployment that does not exist.
const ROOT = existsSync(resolve(BUNDLE_ROOT, MANIFEST_PATH))
  ? BUNDLE_ROOT
  : existsSync(resolve(process.cwd(), MANIFEST_PATH))
    ? process.cwd()
    : null;

// Built once per warm instance, so the projection memo and the token labels are worth having.
const companion =
  ROOT && RPC_URL
    ? createCompanion({
        root: ROOT,
        outDir: null, // the host serves apps/web/out itself; this function serves no static file
        manifestPath: MANIFEST_PATH,
        recordPath: null, // a public network has no practice-run record, and null is what /local/record says
        rpcUrl: RPC_URL,
        subgraphUrl: SUBGRAPH_URL,
      })
    : null;

function refuse(res, why) {
  res.statusCode = 500;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify({ error: why }, null, 2));
}

export default function handler(req, res) {
  if (!RPC_URL) return refuse(res, "this deployment has no UNICA_RPC_URL set; the companion cannot reach a node");
  if (!ROOT) return refuse(res, `this deployment has no manifest at ${MANIFEST_PATH}`);

  // Put the visitor's own path back. Everything the rewrite added is dropped; everything the
  // visitor asked for — ?id=, ?wallet=, ?order=, ?seller= — is kept, exactly as it arrived.
  const asked = new URL(req.url ?? "/", "http://companion.invalid");
  const original = asked.searchParams.get("__companionPath");
  if (original) {
    asked.searchParams.delete("__companionPath");
    const query = asked.searchParams.toString();
    req.url = original + (query ? `?${query}` : "");
  }

  return companion.handler(req, res);
}

export { handler };
