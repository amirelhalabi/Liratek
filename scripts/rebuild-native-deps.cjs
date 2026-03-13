/* Cross-platform native dependency rebuild for Electron.
 *
 * better-sqlite3 must be compiled against the correct ABI:
 *   - Electron ABI (NODE_MODULE_VERSION 125) for `yarn dev` (Electron mode)
 *   - Node.js  ABI (NODE_MODULE_VERSION 115) for `yarn dev:web` / tests
 *
 * Since both runtimes share a single binary path, this script maintains a
 * per-ABI cache under node_modules/.native-cache/{electron,node}/ so that
 * switching modes is a fast file-copy instead of a full recompile.
 *
 * Usage:
 *   node scripts/rebuild-native-deps.cjs              # rebuild for Electron
 *   node scripts/rebuild-native-deps.cjs --target node # rebuild for Node.js
 *   node scripts/rebuild-native-deps.cjs --force       # bypass cache
 */

const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const NATIVE_BINARY = path.join(
  ROOT,
  "node_modules",
  "better-sqlite3",
  "build",
  "Release",
  "better_sqlite3.node",
);
const CACHE_DIR = path.join(ROOT, "node_modules", ".native-cache");
const MARKER_FILE = path.join(ROOT, "node_modules", ".rebuild-marker");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyBinary(src, dst) {
  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);
}

function getCachePath(target) {
  return path.join(CACHE_DIR, target, "better_sqlite3.node");
}

/** Return "electron" or "node" based on the marker written after the last rebuild. */
function currentTarget() {
  try {
    return fs.readFileSync(MARKER_FILE, "utf8").trim();
  } catch {
    return null;
  }
}

function getElectronVersion() {
  try {
    const pkg = path.join(ROOT, "node_modules", "electron", "package.json");
    return JSON.parse(fs.readFileSync(pkg, "utf8")).version;
  } catch {
    return undefined;
  }
}

function rebuildForElectron() {
  const electronVersion = getElectronVersion();
  console.log(
    `[REBUILD] Rebuilding native deps for Electron ${electronVersion || "(unknown)"} on ${process.platform}-${process.arch}...`,
  );

  const rebuildBin = path.join(
    ROOT,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "electron-rebuild.cmd" : "electron-rebuild",
  );
  const args = ["--force"];
  if (electronVersion) args.push("--version", electronVersion);

  const result = spawnSync(rebuildBin, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    cwd: ROOT,
  });

  if (result.error) {
    console.error("[REBUILD] Failed to spawn:", result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[REBUILD] exited with code ${result.status ?? 1}`);
    process.exit(result.status ?? 1);
  }
}

function rebuildForNode() {
  console.log(
    `[REBUILD] Rebuilding native deps for Node.js ${process.version} on ${process.platform}-${process.arch}...`,
  );

  const result = spawnSync("npm", ["rebuild", "better-sqlite3"], {
    stdio: "inherit",
    cwd: ROOT,
    shell: process.platform === "win32",
  });

  if (result.error) {
    console.error("[REBUILD] Failed to spawn:", result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[REBUILD] exited with code ${result.status ?? 1}`);
    process.exit(result.status ?? 1);
  }
}

function main() {
  const force = process.argv.includes("--force");
  const target = process.argv.includes("--target")
    ? process.argv[process.argv.indexOf("--target") + 1]
    : "electron";

  if (target !== "electron" && target !== "node") {
    console.error(
      `[REBUILD] Unknown target "${target}". Use "electron" or "node".`,
    );
    process.exit(1);
  }

  // Fast path: already the right target and binary hasn't been touched
  if (!force && currentTarget() === target) {
    console.log(
      `[REBUILD] Native binary already built for ${target} — skipping (use --force to override).`,
    );
    return;
  }

  // Check if we have the target cached
  const cached = getCachePath(target);
  if (!force && fs.existsSync(cached)) {
    console.log(`[REBUILD] Restoring cached ${target} binary...`);
    // Save the current binary for the *other* target before overwriting
    const prev = currentTarget();
    if (prev && prev !== target && fs.existsSync(NATIVE_BINARY)) {
      copyBinary(NATIVE_BINARY, getCachePath(prev));
    }
    copyBinary(cached, NATIVE_BINARY);
    fs.writeFileSync(MARKER_FILE, target, "utf8");
    console.log(`[REBUILD] Restored ${target} binary from cache.`);
    return;
  }

  // Save current binary for the other target before rebuilding
  const prev = currentTarget();
  if (prev && prev !== target && fs.existsSync(NATIVE_BINARY)) {
    console.log(`[REBUILD] Caching current ${prev} binary...`);
    copyBinary(NATIVE_BINARY, getCachePath(prev));
  }

  // Full rebuild
  if (target === "electron") {
    rebuildForElectron();
  } else {
    rebuildForNode();
  }

  // Cache the freshly built binary
  if (fs.existsSync(NATIVE_BINARY)) {
    copyBinary(NATIVE_BINARY, getCachePath(target));
  }

  fs.writeFileSync(MARKER_FILE, target, "utf8");
  console.log(`[REBUILD] Successfully rebuilt native deps for ${target}.`);
}

main();
