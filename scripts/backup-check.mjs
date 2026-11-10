#!/usr/bin/env node
/**
 * yarn api:backup-check — restore every production database from R2 on the
 * Fly machine and compare each copy with the live file.
 *
 * Why it exists: on 2026-11-10 the platform file's Litestream replication
 * stalled minutes after boot (stale local state after the per-tenant split)
 * while `yarn api:verify` stayed green, because the verifier only sees the
 * "litestream replicating" boot line. A backup is only proven by restoring
 * it, so this restores the platform file (by path) and every shop file (by
 * replica URL — a path under the `dir:` entry is "not found in config"),
 * then checks integrity and how far the copy lags the live file.
 *
 * Nothing on the volume is touched: copies go to /tmp on the machine and
 * are deleted afterwards. Exit code 1 on any failure.
 */
import { flyCapture } from "./fly.mjs";

// A replica this far behind the live file's newest audit row is stale, not
// merely a second or two of sync lag.
const MAX_LAG_SECONDS = 300;

const remote = String.raw`
set -u
# The entrypoint exports this for the app; an ssh shell does not have it.
export TENANT_DATABASES_DIR=/data/tenants
export AWS_ACCESS_KEY_ID="$LITESTREAM_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$LITESTREAM_SECRET_ACCESS_KEY"
cd /app/backend
W=/tmp/backup-check; rm -rf $W; mkdir -p $W
litestream restore -o $W/platform.db "$DATABASE_PATH" >/dev/null 2>&1
for id in $(node dist/scripts/listTenantIds.js "$DATABASE_PATH" 2>/dev/null); do
  litestream restore -o $W/$id.db "s3://$LITESTREAM_BUCKET/tenants/$id.db?endpoint=$LITESTREAM_ENDPOINT&region=auto" >/dev/null 2>&1
  echo $id >> $W/ids
done
node -e '
const D = require("/app/node_modules/better-sqlite3");
const fs = require("fs");
const W = "/tmp/backup-check";
const ids = fs.existsSync(W + "/ids") ? fs.readFileSync(W + "/ids", "utf8").split("\n").filter(Boolean) : [];
const pairs = [["platform", process.env.DATABASE_PATH, W + "/platform.db"]]
  .concat(ids.map((id) => ["tenant " + id, process.env.TENANT_DATABASES_DIR + "/" + id + ".db", W + "/" + id + ".db"]));
const newest = (db) => db.prepare("SELECT MAX(created_at) t, COUNT(*) c FROM audit_log").get();
const out = pairs.map(([name, live, copy]) => {
  if (!fs.existsSync(copy)) return { name, error: "restore produced no file" };
  try {
    const l = new D(live, { readonly: true }), r = new D(copy, { readonly: true });
    return { name, integrity: r.pragma("integrity_check")[0].integrity_check, live: newest(l), restored: newest(r) };
  } catch (e) { return { name, error: e.message }; }
});
console.log("BACKUP_CHECK " + JSON.stringify(out));
'
rm -rf $W
`;

const b64 = Buffer.from(remote).toString("base64");
const output = flyCapture([
  "ssh",
  "console",
  "-C",
  `sh -c 'echo ${b64} | base64 -d > /tmp/backup-check.sh && sh /tmp/backup-check.sh; rm -f /tmp/backup-check.sh'`,
]);

const line = output.split("\n").find((l) => l.startsWith("BACKUP_CHECK "));
if (!line) {
  console.error("No result from the machine. Raw output:\n" + output);
  process.exit(1);
}

const toSeconds = (t) => (t ? Date.parse(t.replace(" ", "T") + "Z") / 1000 : 0);
let failed = false;
for (const r of JSON.parse(line.slice("BACKUP_CHECK ".length))) {
  if (r.error) {
    failed = true;
    console.log(`  ✗ ${r.name}: ${r.error}`);
    continue;
  }
  const lag = toSeconds(r.live.t) - toSeconds(r.restored.t);
  const problems = [];
  if (r.integrity !== "ok") problems.push(`integrity ${r.integrity}`);
  if (lag > MAX_LAG_SECONDS) problems.push(`copy is ${lag}s behind the live file`);
  if (problems.length) failed = true;
  console.log(
    `  ${problems.length ? "✗" : "✓"} ${r.name}: ${problems.join(", ") || "restored, integrity ok"} ` +
      `(audit rows live ${r.live.c} / restored ${r.restored.c}, newest ${r.restored.t ?? "none"})`,
  );
}
console.log(failed ? "\nBackup check FAILED." : "\nAll backups restore.");
process.exit(failed ? 1 : 0);
