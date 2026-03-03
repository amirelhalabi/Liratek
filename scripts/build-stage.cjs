/**
 * build-stage.cjs
 *
 * Prepares the project root for electron-builder packaging:
 *   1. Copies frontend/dist     -> dist/          (renderer files)
 *   2. Copies electron-app/dist -> dist-electron/  (main process files)
 *   3. Copies create_db.sql     -> dist-electron/  (DB schema for first launch)
 *   4. Replaces the @liratek/core symlink in node_modules with a real
 *      copy so electron-builder can pack it into the asar archive.
 */

const fs = require("fs");
const path = require("path");

// 1. Stage frontend build output
fs.cpSync("frontend/dist", "dist", { recursive: true });
console.log("  Staged frontend/dist -> dist/");

// 2. Stage electron-app build output
fs.cpSync("electron-app/dist", "dist-electron", { recursive: true });
console.log("  Staged electron-app/dist -> dist-electron/");

// 3. Copy create_db.sql into dist-electron/ so it's available in packaged app
fs.cpSync(
  path.join("electron-app", "create_db.sql"),
  path.join("dist-electron", "create_db.sql"),
);
console.log("  Staged electron-app/create_db.sql -> dist-electron/");

// 4. Replace @liratek/core workspace symlink with real copy
const coreLinkPath = path.join("node_modules", "@liratek", "core");
const coreSourcePath = path.join("packages", "core");

try {
  const stat = fs.lstatSync(coreLinkPath);
  if (stat.isSymbolicLink()) {
    fs.rmSync(coreLinkPath, { recursive: true });
    console.log("  Removed @liratek/core symlink");
  }
} catch {
  // doesn't exist yet, that's fine
}

// Copy the entire package (package.json + dist/) — skip src/node_modules
fs.mkdirSync(coreLinkPath, { recursive: true });
fs.cpSync(
  path.join(coreSourcePath, "package.json"),
  path.join(coreLinkPath, "package.json"),
);
fs.cpSync(path.join(coreSourcePath, "dist"), path.join(coreLinkPath, "dist"), {
  recursive: true,
});
console.log("  Copied packages/core -> node_modules/@liratek/core");

console.log("Build staging complete.");
