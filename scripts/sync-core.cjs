/**
 * Copy packages/core/dist into node_modules/@liratek/core/dist.
 *
 * Yarn sometimes links @liratek/core (a symlink, nothing to do) and sometimes
 * materialises it as a REAL directory copy. When it is a copy, building
 * packages/core updates nothing the Electron main process or the backend
 * actually loads: both resolve @liratek/core through node_modules. The result
 * is silent and expensive — on 2026-09-07 a stale copy from 02:34 meant a new
 * migration never ran and a new service method read as "not a function", while
 * every source file and every freshly built dist looked correct.
 *
 * Idempotent: detects the symlink case and exits without copying.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const src = path.join(root, "packages", "core", "dist");
const destPkg = path.join(root, "node_modules", "@liratek", "core");
const dest = path.join(destPkg, "dist");

if (!fs.existsSync(src)) {
  console.error("[sync-core] packages/core/dist missing — build core first");
  process.exit(1);
}
if (!fs.existsSync(destPkg)) {
  console.log(
    "[sync-core] node_modules/@liratek/core absent — nothing to sync",
  );
  process.exit(0);
}
if (fs.lstatSync(destPkg).isSymbolicLink()) {
  console.log(
    "[sync-core] node_modules/@liratek/core is a symlink — no sync needed",
  );
  process.exit(0);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log(
  "[sync-core] copied packages/core/dist -> node_modules/@liratek/core/dist",
);
