/* Cross-platform helper to prepare dist-electron assets for dev/build.
 * - ensures dist-electron/db exists
 * - copies electron/db/create_db.sql -> dist-electron/db/create_db.sql
 * - copies electron/package.json -> dist-electron/package.json
 */

const fs = require("fs");
const path = require("path");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function main() {
  const root = process.cwd();
  const distElectronDir = path.join(root, "dist-electron");

  ensureDir(path.join(distElectronDir, "db"));

  copyFile(
    path.join(root, "electron", "db", "create_db.sql"),
    path.join(distElectronDir, "db", "create_db.sql"),
  );

  copyFile(
    path.join(root, "electron", "package.json"),
    path.join(distElectronDir, "package.json"),
  );
}

try {
  main();
} catch (err) {
  console.error("[prepare-electron-dist] Failed:", err);
  process.exitCode = 1;
}
