/**
 * ============================================================================
 * TEMPORARY SCAFFOLDING -- delete this file once the backend is properly hosted.
 * ============================================================================
 *
 * Re-snapshots the live desktop SQLite file into the copy the web backend reads.
 *
 * Throwaway in this form: it copies one local file to another. A real deployment has ONE server database, so there is nothing to copy -- though the idea may return later as a proper staging-seed tool.
 *
 * It exists only because the Express backend currently runs on a developer PC
 * and is exposed through a free Cloudflare quick tunnel. The day the backend
 * runs on a real always-on host with its own database, none of this applies:
 * the frontend simply points at that host, and this file should be removed
 * along with its package.json script. See docs/DEPLOYMENT.md
 * (section: Temporary scaffolding) for the full keep/delete list.
 */
/**
 * Refreshes the web backend's database from the live desktop database.
 *
 *   yarn web:db:refresh
 *
 * The web backend deliberately runs against a COPY, because a Cloudflare tunnel
 * makes it reachable from a public URL and the live file is a real shop's books.
 * This re-snapshots it so the web app shows current data.
 *
 * Uses SQLite's backup API rather than a file copy: the live database runs in
 * WAL mode, so `cp` can capture a torn state (the .db without its -wal).
 *
 * Prefers Python's stdlib sqlite3, which has ZERO coupling to better-sqlite3's
 * native ABI. That matters here: better-sqlite3 must be rebuilt per runtime
 * (Electron ABI for the desktop app, Node ABI for this backend), so a script
 * that imports it breaks depending on which rebuild ran last. Python always
 * works. better-sqlite3 is only the fallback.
 */

import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const LIVE = process.env.LIVE_DB_PATH || join(homedir(), "Documents", "LiraTek", "liratek.db");
const WEB = process.env.WEB_DB_PATH || join(homedir(), "Documents", "LiraTek", "liratek-web-dev.db");

if (!existsSync(LIVE)) {
  console.error(
    `[web-db] live database not found:\n  ${LIVE}\n` +
      `  Override with LIVE_DB_PATH=/path/to/liratek.db`,
  );
  process.exit(1);
}

console.log(`[web-db] source: ${LIVE}`);
console.log(`[web-db] target: ${WEB}`);

const py = `
import sqlite3, sys
src_path, dst_path = sys.argv[1], sys.argv[2]
src = sqlite3.connect('file:' + src_path.replace('\\\\','/') + '?mode=ro', uri=True)
dst = sqlite3.connect(dst_path)
src.backup(dst)
dst.close(); src.close()
c = sqlite3.connect(dst_path)
def one(q):
    try: return c.execute(q).fetchone()[0]
    except Exception: return '?'
print('tenants=%s users=%s transactions=%s' % (
    one('select count(*) from tenants'),
    one('select count(*) from users'),
    one('select count(*) from transactions')))
`;

let done = false;
for (const exe of ["python", "python3", "py"]) {
  const r = spawnSync(exe, ["-c", py, LIVE, WEB], { encoding: "utf8" });
  if (r.error || r.status !== 0) continue;
  console.log(`[web-db] ${r.stdout.trim()}`);
  done = true;
  break;
}

if (!done) {
  // Fallback: better-sqlite3's own backup(). Fails loudly if the native binding
  // is built for the other runtime -- run `yarn rebuild:node` in that case.
  console.log(`[web-db] python unavailable, falling back to better-sqlite3`);
  try {
    const { default: Database } = await import("better-sqlite3");
    const src = new Database(LIVE, { readonly: true });
    await src.backup(WEB);
    src.close();
    console.log(`[web-db] copied`);
  } catch (e) {
    console.error(
      `[web-db] failed: ${e.message}\n` +
        `  If this mentions NODE_MODULE_VERSION, the native binding is built for\n` +
        `  the other runtime. Run: yarn rebuild:node`,
    );
    process.exit(1);
  }
}

console.log(`[web-db] done — ${(statSync(WEB).size / 1048576).toFixed(2)} MB`);
console.log(`[web-db] restart the backend to pick it up (it holds an open handle).`);
