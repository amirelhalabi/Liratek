/* Cross-platform graphifyy runner.
 * Auto-installs graphifyy via pip if not found, then forwards all args.
 * Usage: node scripts/graphify.cjs [graphifyy args...]
 *   e.g. node scripts/graphify.cjs detect
 */
"use strict";

const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ARGS = process.argv.slice(2);

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { stdio: "inherit", cwd: ROOT, ...opts });
}

function probe(cmd, args) {
  return spawnSync(cmd, args, { stdio: "pipe" });
}

function isInstalled() {
  return probe("graphifyy", ["--version"]).status === 0;
}

function install() {
  console.log("graphifyy not found — installing via pip...");

  // Try pip then pip3
  for (const pip of ["pip", "pip3"]) {
    const r = run(pip, ["install", "graphifyy"]);
    if (r.status === 0) return;
  }

  console.error(
    "\nFailed to install graphifyy automatically.\n" +
      "Please install it manually:\n" +
      "  pip install graphifyy\n",
  );
  process.exit(1);
}

if (!isInstalled()) install();

// After install on Windows, graphifyy may land in a Scripts/ dir not yet on
// PATH for this process. Fall back to `python -m graphifyy` in that case.
let result = run("graphifyy", ARGS);

if (result.error) {
  // Try via the Python that pip used
  for (const py of ["python", "python3"]) {
    result = run(py, ["-m", "graphifyy", ...ARGS]);
    if (!result.error) break;
  }
}

process.exit(result.status ?? 1);
