/* Cross-platform native dependency rebuild for Electron.
 * Ensures better-sqlite3 (and other native deps) are rebuilt for:
 *   - current platform
 *   - current arch
 *   - the Electron version specified in package.json
 */

const path = require("path");
const { spawnSync } = require("child_process");

function getElectronBuilderBin() {
  // Yarn PnP still exposes binaries via node_modules/.bin in this repo.
  const binName =
    process.platform === "win32" ? "electron-builder.cmd" : "electron-builder";
  return path.join(process.cwd(), "node_modules", ".bin", binName);
}

function main() {
  const electronBuilderBin = getElectronBuilderBin();

  const args = [
    "install-app-deps",
    "--platform",
    process.platform,
    "--arch",
    process.arch,
  ];

  const result = spawnSync(electronBuilderBin, args, {
    stdio: "inherit",
    shell: false,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

main();
