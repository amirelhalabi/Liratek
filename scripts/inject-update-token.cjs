// Inject UPDATE_TOKEN into updater-config.ts before TypeScript compilation.
// Called by CI: node scripts/inject-update-token.cjs
const fs = require("fs");
const f = "electron-app/updater-config.ts";
const token = process.env.UPDATE_TOKEN || "";
if (!token) {
  console.log(
    "WARNING: UPDATE_TOKEN is empty, updater will fall back to GH_TOKEN env var",
  );
}
const src = fs.readFileSync(f, "utf8");
const out = src.replace("__UPDATE_TOKEN__", token);
fs.writeFileSync(f, out, "utf8");
console.log("Injected UPDATE_TOKEN into", f, token ? "(token set)" : "(empty)");
