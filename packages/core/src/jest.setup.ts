// Multi-tenant retrofit (WP1b/WP2b): BaseRepository's generic CRUD methods
// (findById/findAll/create/update/delete/count/...) now resolve tenant_id
// via getCurrentTenantId(), which throws TenantContextError fail-closed if
// no tenant context is set. Core's jest fixtures predate multi-tenancy and
// don't wrap their calls in runWithTenant(), so fix a single fallback
// tenant (1) for the whole test process — mirrors Electron's single-tenant
// desktop mode (see electron-app/main.ts's initFixedTenantContext(1) call).
//
// Imported by direct relative path (NOT the package's own "index.ts"
// barrel) so this setup file only evaluates the tiny, dependency-free
// tenantContext module rather than eagerly loading every repository/service
// in the package before each test file's own jest.mock() calls take effect.
import { initFixedTenantContext } from "./db/tenantContext";

initFixedTenantContext(1);

// LIRA-168 — fail fast if SQLite's 'localtime' and Node's Date getters
// disagree on the current UTC offset, instead of letting individual
// date-boundary assertions fail (or silently pass-by-luck) depending on
// whatever instant a test's fixture happens to use. See
// `scripts/runTests.cjs`'s doc comment for the full mechanism: on Windows,
// pinning TZ to an IANA name (e.g. TZ=Asia/Beirut) makes better-sqlite3's
// 'localtime' silently fall back to a wrong offset while Node's Date
// getters stay correct — and no single TZ value fixes both runtimes at
// once on that platform, so `runTests.cjs` now leaves TZ unset on win32
// (trusting the OS's own configured zone, which both runtimes resolve
// correctly and therefore agree on) while keeping it pinned on Linux/CI.
// This probe is the safety net for either platform: it is NOT itself a fix
// for a disagreement, only loud, immediate proof that one exists.
//
// Uses a throwaway in-memory connection (require() directly — importing
// `better-sqlite3` at module scope here would run before
// `initFixedTenantContext` above on some module-resolution orders).
(function assertSqlJsTimezoneOffsetsAgree(): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require("better-sqlite3") as typeof import("better-sqlite3");
  const probe = new Database(":memory:");
  const { sqlOffsetSeconds } = probe
    .prepare(
      `SELECT strftime('%s','now','localtime') - strftime('%s','now') AS sqlOffsetSeconds`,
    )
    .get() as { sqlOffsetSeconds: number };
  probe.close();
  const jsOffsetSeconds = -new Date().getTimezoneOffset() * 60;
  const diffSeconds = Math.abs(sqlOffsetSeconds - jsOffsetSeconds);
  // >60s tolerance only for sub-minute timing jitter between the two reads
  // (both calls happen within the same tick in practice).
  if (diffSeconds > 60) {
    throw new Error(
      "LIRA-168: SQLite 'localtime' and Node's Date getters disagree on " +
        `the current UTC offset (SQL=${(sqlOffsetSeconds / 3600).toFixed(2)}h, ` +
        `JS=${(jsOffsetSeconds / 3600).toFixed(2)}h). Any test comparing a ` +
        "SQL-computed local day/time against a JS-computed one (localDay(), " +
        "dateRange(), 'localtime') is unreliable while this holds. On " +
        "Windows this almost always means something pinned TZ to an IANA " +
        "zone name (e.g. TZ=Asia/Beirut) ahead of this run — " +
        "packages/core's own `test` script (scripts/runTests.cjs) " +
        "deliberately leaves TZ unset on win32 for exactly this reason; " +
        "check nothing re-introduced an explicit TZ env var, or that the " +
        "machine's own OS timezone is actually set (non-UTC).",
    );
  }
})();
