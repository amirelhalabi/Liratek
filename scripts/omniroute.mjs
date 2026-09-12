#!/usr/bin/env node
/**
 * OmniRoute launcher — dev tooling only, NOT part of the shipped app.
 *
 * OmniRoute (https://github.com/diegosouzapw/OmniRoute) is a local AI gateway
 * used to route coding agents (Claude Code, Cursor, ...) through alternative
 * LLM providers while developing LiraTek. It is installed GLOBALLY
 * (`npm install -g omniroute`) and is deliberately NOT a dependency of this
 * repo: nothing here imports it, and no product code calls it.
 *
 * ── Why this wrapper exists instead of a plain `omniroute` script entry ──
 *
 * 1. NODE VERSION. OmniRoute enforces a *security* floor at runtime —
 *    Node >=22.22.2 (22.x line) or >=24.0.0 — and its dashboard hard-blocks
 *    below it. Note its declared `engines` is the far looser
 *    `>=22.0.0 <23 || >=24.0.0 <27`, so npm does NOT warn; the CLI starts and
 *    even reports "running" while the dashboard refuses to load. This repo is
 *    pinned to an older Node (see .nvmrc) and MUST NOT be upgraded for
 *    OmniRoute's sake — changing the project's Node invalidates the compiled
 *    better-sqlite3 binding and breaks desktop e2e. So we locate a
 *    policy-satisfying Node installed via fnm and use it for OmniRoute ONLY,
 *    leaving the repo's own Node untouched.
 *
 * 2. PATH INHERITANCE. OmniRoute spawns its real HTTP server as a child
 *    process invoked as bare `node ... server-ws.mjs`, which resolves through
 *    PATH. Setting the parent's interpreter is therefore NOT enough — the
 *    child would silently fall back to the system Node. We must PREPEND the
 *    chosen Node's directory to PATH so the child inherits it too.
 *
 * 3. THE FAILURE IT PREVENTS. If the child runs on a Node whose ABI does not
 *    match OmniRoute's compiled better-sqlite3, the native load fails and
 *    OmniRoute falls back to a bundled sql.js WASM driver that loads the whole
 *    database into WASM memory and dies with "out of memory" — while the
 *    launcher still prints "OmniRoute is running!". Every HTTP route then
 *    returns 500. The symptom points at the database; the cause is the Node
 *    used to spawn the child.
 *
 * ⚠ Two of OmniRoute's own repair commands report success without doing
 *   anything: `omniroute runtime repair` printed "better-sqlite3 repaired OK"
 *   while leaving the binary byte-identical, and `npm rebuild better-sqlite3`
 *   printed "rebuilt dependencies successfully" while npm 11 silently blocked
 *   the install script. Verify by file size/mtime, never by their output.
 *
 * ⚠ NEVER run `npm rebuild better-sqlite3` from the repo root to fix
 *   OmniRoute. That is this repo's own `rebuild:node` script and it retargets
 *   LiraTek's binding to the Node ABI, after which every desktop e2e spec
 *   fails at `waitForEvent("window")`. OmniRoute's copy lives in its own
 *   global install directory; `npm run omniroute:doctor` prints the path.
 *
 * Usage:
 *   npm run omniroute            # start the gateway (foreground, Ctrl+C stops)
 *   npm run omniroute:status     # is it up? which Node is serving it?
 *   npm run omniroute:stop       # kill any running OmniRoute processes
 *   npm run omniroute:doctor     # resolved paths + versions, no side effects
 *
 * Extra arguments are passed straight through, e.g.
 *   npm run omniroute -- runtime repair
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

/** OmniRoute's documented secure-runtime policy. */
const NODE_POLICY = [
  { major: 22, minMinor: 22, minPatch: 2 },
  { major: 24 },
  { major: 25 },
  { major: 26 },
];

/** Default gateway port (OmniRoute's own default). */
const PORT = Number(process.env.OMNIROUTE_PORT ?? 20128);

/** Roots fnm uses for its managed Node installs, most likely first. */
const FNM_ROOTS = [
  process.env.FNM_DIR,
  path.join(os.homedir(), "AppData", "Roaming", "fnm", "node-versions"),
  path.join(os.homedir(), "AppData", "Local", "fnm", "node-versions"),
  path.join(os.homedir(), ".fnm", "node-versions"),
].filter(Boolean);

const IS_WINDOWS = process.platform === "win32";
const NODE_EXE = IS_WINDOWS ? "node.exe" : "node";

function parseVersion(raw) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(raw ?? "");
  if (!m) return null;
  return {
    major: +m[1],
    minor: +m[2],
    patch: +m[3],
    raw: `v${m[1]}.${m[2]}.${m[3]}`,
  };
}

function satisfiesPolicy(v) {
  if (!v) return false;
  return NODE_POLICY.some((rule) => {
    if (v.major !== rule.major) return false;
    if (rule.minMinor !== undefined && v.minor < rule.minMinor) return false;
    if (
      rule.minPatch !== undefined &&
      v.minor === rule.minMinor &&
      v.patch < rule.minPatch
    ) {
      return false;
    }
    return true;
  });
}

function compareVersions(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/**
 * Find the newest fnm-managed Node that satisfies OmniRoute's policy.
 * Returns the directory containing the node binary, or null.
 */
function resolveNodeDir() {
  const override = process.env.OMNIROUTE_NODE_DIR;
  if (override) {
    if (!existsSync(path.join(override, NODE_EXE))) {
      fail(
        `OMNIROUTE_NODE_DIR is set to "${override}" but contains no ${NODE_EXE}.`,
      );
    }
    return override;
  }

  const candidates = [];
  for (const root of FNM_ROOTS) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root)) {
      const version = parseVersion(entry);
      if (!satisfiesPolicy(version)) continue;
      // fnm layout: <root>/<version>/installation/node.exe
      for (const dir of [
        path.join(root, entry, "installation"),
        path.join(root, entry, "bin"),
      ]) {
        if (existsSync(path.join(dir, NODE_EXE))) {
          candidates.push({ version, dir });
          break;
        }
      }
    }
  }

  if (candidates.length === 0) {
    // The Node already running this script may itself qualify.
    const self = parseVersion(process.version);
    if (satisfiesPolicy(self)) return path.dirname(process.execPath);
    return null;
  }

  candidates.sort((a, b) => compareVersions(b.version, a.version));
  return candidates[0].dir;
}

/** Locate the globally installed OmniRoute entry point. */
function resolveOmniroute() {
  const override = process.env.OMNIROUTE_ENTRY;
  if (override) {
    if (!existsSync(override))
      fail(`OMNIROUTE_ENTRY is set to "${override}" but does not exist.`);
    return override;
  }

  const roots = [];
  const probe = spawnSync("npm", ["root", "-g"], {
    encoding: "utf8",
    shell: IS_WINDOWS,
  });
  if (probe.status === 0 && probe.stdout.trim())
    roots.push(probe.stdout.trim());
  roots.push(
    path.join(os.homedir(), "AppData", "Roaming", "npm", "node_modules"),
  );

  for (const root of roots) {
    const entry = path.join(root, "omniroute", "bin", "omniroute.mjs");
    if (existsSync(entry)) return entry;
  }
  return null;
}

function fail(message) {
  console.error(`\n  ✖ ${message}\n`);
  process.exit(1);
}

function requireEnvironment() {
  const nodeDir = resolveNodeDir();
  if (!nodeDir) {
    fail(
      [
        "No Node.js satisfying OmniRoute's secure-runtime policy was found.",
        "  Needs Node >=22.22.2 (22.x) or >=24.0.0. Install one WITHOUT touching",
        "  this repo's Node:",
        "",
        "    winget install Schniz.fnm     (then open a NEW terminal)",
        "    fnm install 24",
        "",
        "  Then re-run. Override detection with OMNIROUTE_NODE_DIR=<dir>.",
      ].join("\n"),
    );
  }

  const entry = resolveOmniroute();
  if (!entry) {
    fail(
      [
        "OmniRoute is not installed globally.",
        "",
        "    npm install -g omniroute      (large package; allow ~30 min)",
        "",
        "  Override detection with OMNIROUTE_ENTRY=<path to bin/omniroute.mjs>.",
      ].join("\n"),
    );
  }

  return { nodeDir, entry };
}

/** PATH with the chosen Node FIRST, so spawned children inherit it (see #2). */
function envWithNodeFirst(nodeDir) {
  const key =
    Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  return {
    ...process.env,
    [key]: `${nodeDir}${path.delimiter}${process.env[key] ?? ""}`,
  };
}

function start(args) {
  const { nodeDir, entry } = requireEnvironment();
  const version = spawnSync(path.join(nodeDir, NODE_EXE), ["-v"], {
    encoding: "utf8",
  });
  console.log(
    `  OmniRoute via Node ${version.stdout?.trim() ?? "?"} (${nodeDir})`,
  );
  console.log(`  entry: ${entry}\n`);

  const child = spawn(path.join(nodeDir, NODE_EXE), [entry, ...args], {
    stdio: "inherit",
    env: envWithNodeFirst(nodeDir),
    // Start outside the repo so OmniRoute never writes state into it.
    cwd: os.homedir(),
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}

async function status() {
  const url = `http://127.0.0.1:${PORT}/v1/models`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const body = await res.text();
    if (res.ok) {
      let count = "?";
      try {
        count = JSON.parse(body).data?.length ?? "?";
      } catch {
        /* non-JSON body; the status code is what matters */
      }
      console.log(`  ✔ OmniRoute is UP on ${PORT} — ${count} models listed`);
      console.log(`    Dashboard: http://localhost:${PORT}`);
      return;
    }
    // A 500 here is the sql.js/ABI fallback described in #3 above.
    console.log(`  ✖ Responding on ${PORT} but unhealthy: HTTP ${res.status}`);
    console.log(`    ${body.slice(0, 200)}`);
    if (res.status >= 500) {
      console.log(
        "    A 500 usually means the server child ran on the wrong Node and fell",
      );
      console.log(
        "    back to the sql.js WASM driver. Stop it and start via this script.",
      );
    }
    process.exitCode = 1;
  } catch {
    console.log(`  ✖ OmniRoute is not responding on ${PORT}`);
    process.exitCode = 1;
  }
}

function stop() {
  if (!IS_WINDOWS) {
    // Anchored on the global install dir, so this wrapper (scripts/omniroute.mjs)
    // is never itself a match — a bare -f omniroute makes `stop` kill itself.
    const r = spawnSync("pkill", ["-f", "node_modules/omniroute/"], {
      stdio: "inherit",
    });
    console.log(r.status === 0 ? "  ✔ stopped" : "  nothing running");
    return;
  }
  // Match on the command line so we only ever kill OmniRoute's own processes,
  // never an unrelated node (a dev server, a test run).
  //
  // Two exclusions are load-bearing. THIS script's own command line contains
  // "omniroute" (`node scripts/omniroute.mjs stop`), so without them `stop`
  // kills itself mid-run and exits 127 before reporting anything — observed,
  // not hypothetical. We drop our own pid, our parent's, and any process
  // running this wrapper.
  const ps = [
    `$self = @(${process.pid}, ${process.ppid});`,
    "$p = Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" |",
    "  Where-Object { $_.CommandLine -like '*omniroute*' -and",
    "                 $_.CommandLine -notlike '*scripts?omniroute.mjs*' -and",
    "                 $self -notcontains $_.ProcessId };",
    'if ($p) { $p | ForEach-Object { Write-Output "stopped PID $($_.ProcessId)";',
    "  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }",
    "else { Write-Output 'nothing running' }",
  ].join(" ");
  spawnSync("powershell", ["-NoProfile", "-Command", ps], { stdio: "inherit" });
}

function doctor() {
  console.log(`  repo Node:      ${process.version} (unchanged by OmniRoute)`);
  const nodeDir = resolveNodeDir();
  if (nodeDir) {
    const v = spawnSync(path.join(nodeDir, NODE_EXE), ["-v"], {
      encoding: "utf8",
    });
    console.log(`  OmniRoute Node: ${v.stdout?.trim() ?? "?"}  ${nodeDir}`);
  } else {
    console.log(
      "  OmniRoute Node: NOT FOUND (see npm run omniroute for install steps)",
    );
  }
  const entry = resolveOmniroute();
  console.log(
    `  entry:          ${entry ?? "NOT FOUND (npm install -g omniroute)"}`,
  );
  if (entry) {
    const pkgRoot = path.resolve(path.dirname(entry), "..");
    console.log(
      `  its sqlite:     ${path.join(pkgRoot, "dist", "node_modules", "better-sqlite3")}`,
    );
    console.log("                  (rebuild THERE, never from this repo root)");
  }
  console.log(`  port:           ${PORT}`);
}

const [command, ...rest] = process.argv.slice(2);
switch (command) {
  case "status":
    await status();
    break;
  case "stop":
    stop();
    break;
  case "doctor":
    doctor();
    break;
  default:
    start(command ? [command, ...rest] : []);
}
