/*
 * Downloads the Electron-specific prebuild of better-sqlite3.
 *
 * electron-builder install-app-deps silently skips better-sqlite3 v12+ due to
 * its NAPI declaration. This script calls prebuild-install with -r electron so
 * the correct ABI binary is fetched from GitHub releases instead.
 */

const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

const ROOT = process.cwd();

function getElectronVersion() {
  const pkgPath = path.join(ROOT, "node_modules", "electron", "package.json");
  if (!fs.existsSync(pkgPath)) {
    console.warn("[REBUILD] electron not found in node_modules — skipping.");
    return null;
  }
  return JSON.parse(fs.readFileSync(pkgPath, "utf8")).version;
}

function findPrebuildInstall() {
  const local = path.join(ROOT, "node_modules", "prebuild-install", "bin.js");
  if (fs.existsSync(local)) return local;
  return null;
}

function findSqliteDirs() {
  const candidates = [
    path.join(ROOT, "node_modules", "better-sqlite3"),
    path.join(ROOT, "electron-app", "node_modules", "better-sqlite3"),
    path.join(ROOT, "packages", "core", "node_modules", "better-sqlite3"),
    path.join(ROOT, "node_modules", "@liratek", "core", "node_modules", "better-sqlite3"),
  ];
  return candidates.filter((p) => fs.existsSync(path.join(p, "binding.gyp")));
}

function rebuild(sqliteDir, electronVersion, prebuildBin) {
  console.log(`[REBUILD] ${path.relative(ROOT, sqliteDir)} → electron@${electronVersion}`);
  const result = spawnSync(
    process.execPath,
    [
      prebuildBin,
      "-r", "electron",
      "-t", electronVersion,
      "--arch", process.arch,
      "--platform", process.platform,
      "--force",
    ],
    { cwd: sqliteDir, stdio: "inherit" }
  );

  if (result.error) {
    console.error(`[REBUILD] error:`, result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[REBUILD] prebuild-install exited with code ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

function main() {
  const electronVersion = getElectronVersion();
  if (!electronVersion) return;

  const prebuildBin = findPrebuildInstall();
  if (!prebuildBin) {
    console.warn("[REBUILD] prebuild-install not found — skipping.");
    return;
  }

  const dirs = findSqliteDirs();
  if (dirs.length === 0) {
    console.log("[REBUILD] No better-sqlite3 copies found.");
    return;
  }

  for (const dir of dirs) {
    rebuild(dir, electronVersion, prebuildBin);
  }

  console.log("[REBUILD] Done.");
}

main();
