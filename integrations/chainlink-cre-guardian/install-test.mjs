// The collector installer — the suite.
//
// Run: node integrations/chainlink-cre-guardian/install-test.mjs   (offline; no CLI, key or RPC)
//
// THE REAL SCRIPT, NOT A DESCRIPTION OF IT. install-collector.sh is copied, with the one module it
// reads (cre-lib.mjs, Node built-ins only), into a throwaway directory and run there with a
// throwaway HOME and a stub `launchctl` that only records its arguments. Nothing in the repository,
// in the real ~/Library/LaunchAgents, or in launchd is touched.
//
// HERMETIC PATH, SO NO ROW CAN QUIETLY SKIP. The PATH each run sees holds only: the stub launchctl,
// symlinks to the four utilities the installer calls (dirname, id, mkdir, cat), and -- per scenario
// -- a private directory with a symlink to this node and a directory with a stub `cre`. The machine's
// own /usr/bin is never on it, so a node or cre installed there cannot make a "missing" row pass or
// skip for the wrong reason.
//
// EVERY SHELL AVAILABLE. Each scenario runs under /bin/sh, which must exist, and under dash and
// `bash --posix` when they are installed, once per distinct binary: macOS's /bin/sh is bash, the
// Linux CI's is dash, and the bypasses below differ between them.
//
// WHY IT EXISTS. The installer resolved the cre directory as `dirname "$(command -v cre)"`. With no
// `cre` on PATH that is `dirname ""`, which prints ".", so its empty-check guard could never fire and
// it loaded a launchd job with "." on its PATH while promising to abort "without touching anything".
// A non-empty answer is not enough either: a shell function named cre (bash), a relative PATH entry
// (dash), and a non-executable file (dash) each produce a relative or dead entry. The binary refusal
// rows fail on the versions of the installer that predate the absolute-executable check; the label
// row fails on one whose label step ends the run under `set -e` before its own guard can speak.

import {
  chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync,
  symlinkSync, writeFileSync,
} from "node:fs";
import {spawnSync} from "node:child_process";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LABEL = "click.nfteria.unica.cre-collector";
const TIMEOUT_MS = 30_000;

let pass = 0, fail = 0;
function check(name, ok, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  if (ok) pass++; else { fail++; if (detail !== undefined) console.log(`        ${detail}`); }
}

// The utilities the installer runs besides node, cre and launchctl, resolved once from this
// process's own environment and exposed to the installer as symlinks, never as a system PATH.
function which(bin) {
  const r = spawnSync("/bin/sh", ["-c", `command -v ${bin}`], {encoding: "utf8"});
  const p = r.stdout.trim();
  if (r.status !== 0 || !p.startsWith("/")) throw new Error(`the test itself needs ${bin} on PATH`);
  return p;
}
const TOOLS = Object.fromEntries(["dirname", "id", "mkdir", "cat"].map((b) => [b, which(b)]));

// Distinct POSIX shells to run the installer under. `bash --posix` is how macOS's /bin/sh behaves.
const SHELLS = [];
{
  const seen = new Set();
  for (const [path, args, name] of [["/bin/sh", [], "sh"], ["/bin/dash", [], "dash"], ["/bin/bash", ["--posix"], "bash --posix"]]) {
    if (!existsSync(path)) continue;
    const real = realpathSync(path) + args.join(" ");
    if (seen.has(real)) continue;
    seen.add(real);
    SHELLS.push({path, args, name});
  }
}

// One isolated world: a copy of the installer, a HOME, stubs, and exactly the binaries asked for.
function makeWorld(root, {node = true, cre = "binary", relativeDot = false, lib = true}) {
  const app = join(root, "app"), home = join(root, "home"), stubs = join(root, "stubs");
  const tools = join(root, "tools"), nodeDir = join(root, "node-bin"), creDir = join(root, "cre-bin");
  for (const d of [app, stubs, tools, nodeDir, creDir, join(home, "Library", "LaunchAgents")]) mkdirSync(d, {recursive: true});
  copyFileSync(join(HERE, "install-collector.sh"), join(app, "install-collector.sh"));
  if (lib) copyFileSync(join(HERE, "cre-lib.mjs"), join(app, "cre-lib.mjs"));
  const calls = join(root, "launchctl.calls");
  writeFileSync(join(stubs, "launchctl"), `#!/bin/sh\necho "$*" >> '${calls}'\n`);
  chmodSync(join(stubs, "launchctl"), 0o755);
  for (const [b, p] of Object.entries(TOOLS)) symlinkSync(p, join(tools, b));
  symlinkSync(process.execPath, join(nodeDir, "node"));
  let cwd = root;
  const path = [stubs, tools];
  if (node) path.push(nodeDir);
  const env = {HOME: home};
  if (cre === "binary" || cre === "not-executable") {
    writeFileSync(join(creDir, "cre"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(creDir, "cre"), cre === "binary" ? 0o755 : 0o644);
    path.push(creDir);
  } else if (cre === "directory") {
    mkdirSync(join(creDir, "cre"));
    path.push(creDir);
  } else if (cre === "function") {
    env["BASH_FUNC_cre%%"] = "() {  :\n}"; // bash imports this as a function named cre; dash ignores it
  }
  if (relativeDot) {
    // "." on PATH with an executable cre in the working directory and no absolute cre anywhere.
    cwd = join(root, "cwd");
    mkdirSync(cwd);
    writeFileSync(join(cwd, "cre"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(cwd, "cre"), 0o755);
    path.push(".");
  }
  env.PATH = path.join(":");
  return {app, home, calls, creDir, nodeDir, env, cwd};
}

function install(shell, w) {
  return spawnSync(shell.path, [...shell.args, join(w.app, "install-collector.sh")],
    {env: w.env, cwd: w.cwd, encoding: "utf8", timeout: TIMEOUT_MS});
}

const plistPath = (w) => join(w.home, "Library", "LaunchAgents", `${LABEL}.plist`);
const field = (plist, key) => (plist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`)) || [])[1];

function scenario(shell, opts, body) {
  const root = mkdtempSync(join(tmpdir(), "unica-install-"));
  try { body(makeWorld(root, opts)); }
  catch (e) { check(`${shell.name}: the scenario ran`, false, `threw: ${e.message}`); }
  finally { rmSync(root, {recursive: true, force: true}); }
}

function refusesUntouched(label, shell, w) {
  const r = install(shell, w);
  const n = `${shell.name}, ${label}`;
  check(`${n}: exits non-zero`, r.status !== 0 && r.status !== null, `status ${r.status} signal ${r.signal}`);
  check(`${n}: says it aborted without touching anything`,
    /aborting without touching anything/.test(r.stderr), `stderr: ${r.stderr.trim()}`);
  check(`${n}: writes no plist`, !existsSync(plistPath(w)));
  check(`${n}: never calls launchctl`, !existsSync(w.calls));
  check(`${n}: creates no log directory`, !existsSync(join(w.app, "local")));
}

for (const shell of SHELLS) {
  console.log(`— ${shell.name}: node and cre present: the job is written with absolute entries only —`);
  scenario(shell, {}, (w) => {
    const r = install(shell, w);
    check(`${shell.name}: exits 0`, r.status === 0, `status ${r.status}\n        ${r.stderr.trim()}`);
    const plist = existsSync(plistPath(w)) ? readFileSync(plistPath(w), "utf8") : "";
    check(`${shell.name}: writes the plist`, plist !== "");
    const args = [...plist.matchAll(/<array>\s*<string>([^<]*)<\/string>\s*<string>([^<]*)<\/string>/g)][0] || [];
    check(`${shell.name}: runs this node on the viewer`,
      args[1] === join(w.nodeDir, "node") && args[2] === join(w.app, "execution-viewer.mjs"), `ProgramArguments: ${args.slice(1)}`);
    check(`${shell.name}: works in the installer's own directory`, field(plist, "WorkingDirectory") === w.app);
    const entries = (field(plist, "PATH") || "").split(":");
    check(`${shell.name}: puts the cre directory on the job's PATH`, entries.includes(w.creDir), `PATH: ${entries.join(":")}`);
    check(`${shell.name}: every PATH entry is absolute`,
      entries.length > 1 && entries.every((e) => e.startsWith("/")), `PATH: ${entries.join(":")}`);
    const calls = existsSync(w.calls) ? readFileSync(w.calls, "utf8") : "";
    check(`${shell.name}: boots the job out and back in`, /^bootout /m.test(calls) && /^bootstrap /m.test(calls), calls.trim());
  });

  console.log(`— ${shell.name}: anything short of an absolute executable is refused, untouched —`);
  scenario(shell, {cre: "none"}, (w) => refusesUntouched("cre missing", shell, w));
  scenario(shell, {node: false}, (w) => refusesUntouched("node missing", shell, w));
  scenario(shell, {cre: "function"}, (w) => refusesUntouched("cre only a shell function", shell, w));
  scenario(shell, {cre: "not-executable"}, (w) => refusesUntouched("cre not executable", shell, w));
  scenario(shell, {cre: "directory"}, (w) => refusesUntouched("cre a directory", shell, w));
  scenario(shell, {lib: false}, (w) => refusesUntouched("launchd label unreadable", shell, w));

  console.log(`— ${shell.name}: a relative PATH entry never reaches the job —`);
  scenario(shell, {cre: "none", relativeDot: true}, (w) => {
    const r = install(shell, w);
    const plist = existsSync(plistPath(w)) ? readFileSync(plistPath(w), "utf8") : "";
    const entries = (field(plist, "PATH") || "").split(":").filter(Boolean);
    // Some shells answer `command -v` with "./cre" (refused); others with an absolute path, which
    // is a real binary and may be installed. What must never happen is a relative entry in the job.
    const refused = r.status !== 0 && plist === "" && !existsSync(w.calls);
    const absolute = r.status === 0 && entries.length > 0 && entries.every((e) => e.startsWith("/"));
    check(`${shell.name}, "." on PATH: refused, or installed with absolute entries only`, refused || absolute,
      `status ${r.status}, PATH: ${entries.join(":")}, stderr: ${r.stderr.trim()}`);
  });
}

check("/bin/sh, the shell the installer names, was among the shells run", SHELLS.some((s) => s.path === "/bin/sh"));
console.log(`\nshells: ${SHELLS.map((s) => s.name).join(", ")}`);
console.log(`rows run: ${pass + fail}, passed: ${pass}, failed: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
