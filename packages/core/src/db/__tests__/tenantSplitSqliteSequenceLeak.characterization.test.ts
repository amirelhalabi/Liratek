/**
 * CHARACTERIZATION — was ADVERSARIAL, reclassified as an ACCEPTED finding
 * (`PRODUCTION_DATABASE_AND_HOSTING_PLAN.md` § 12.6, 2026-09-27). This test
 * still reproduces the real behaviour below; it is documented here as a
 * known, deliberate trade-off, NOT an unfixed bug — read § 12.6 before
 * "fixing" this.
 *
 * `sqlite_sequence` is invisible to `tenantSplit.ts`'s own fencing and is
 * carried, WHOLESALE and UNFILTERED, into every output file (`platform.db`
 * AND every `tenants/<id>.db`), even on a fully clean split that reports
 * `ok: true`.
 *
 * `discoverTenantScopedTables()` and `discoverUnsafeAndUnscopedTables()`
 * (`../tenantSplit.ts`) both query `sqlite_master` with `name NOT LIKE
 * 'sqlite_%'` — which excludes SQLite's own `sqlite_sequence` bookkeeping
 * table (the backing store for every `INTEGER PRIMARY KEY AUTOINCREMENT`
 * column) from BOTH the per-tenant DELETE loop AND the "would this be
 * copied unfiltered?" hard-fail scan. `buildTenantFile`/`buildPlatformFile`
 * never touch it, so `VACUUM INTO`'s full-file copy leaves it byte-identical
 * in the platform file and in EVERY tenant file — each one showing the
 * combined, cross-tenant, all-time row-creation high-water-mark for every
 * autoincrementing table on the ENTIRE platform, not just that file's own
 * tenant.
 *
 * This is not the row-content leak the split tool's own report (mismatches /
 * unexpectedGlobalRows / fileChecks) is built to catch — those are all
 * silent here, and `ok` is `true`. It is a narrower, still-real violation of
 * this feature's own stated design goal (PRODUCTION_DATABASE_AND_HOSTING_
 * PLAN.md § 12.2: "each shop file keeps ONLY that shop's data"): a metadata
 * leak of every OTHER tenant's total lifetime row counts, extractable by
 * anyone with read access to any one shop's own `.db` file (a stolen
 * laptop's desktop mirror, a misconfigured backup, or the file itself in a
 * hosted per-tenant deployment).
 *
 * **Why accepted, not fixed** (§ 12.6 in full): resetting a tenant file's
 * `sqlite_sequence` down to that tenant's own counts risks reissuing an id
 * that was ever used and freed within that file (e.g. a deleted/voided
 * row's id), which risks colliding with a still-live row elsewhere that
 * FK-references the old id — a worse failure mode than the metadata leak it
 * would close. Revisit before the offline-desktop plan
 * (`docs/plans/todo_plans/OFFLINE_DESKTOP_FALLBACK_PLAN.md`) gives shops
 * their own file, since that plan's whole premise is a shop holding only its
 * own data.
 *
 * Reproduced against the REAL schema (`electron-app/create_db.sql` +
 * `runMigrations`), same technique as `tenantSplit.test.ts`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { initDatabase, closeDatabase } from "../connection.js";
import { runMigrations } from "../migrations/index.js";
import { splitTenantDatabase } from "../tenantSplit.js";

const CREATE_DB_SQL_PATH = path.join(
  __dirname,
  "../../../../../electron-app/create_db.sql",
);

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "liratek-sqlite-sequence-leak-"));
}

describe("CHARACTERIZATION (accepted, § 12.6): tenantSplit sqlite_sequence cross-tenant leak", () => {
  let tmpDir: string;
  let sourceDbPath: string;
  let outputDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    sourceDbPath = path.join(tmpDir, "source.db");
    outputDir = path.join(tmpDir, "out");
  });

  afterEach(() => {
    try {
      closeDatabase();
    } catch {
      // not every test path initializes the singleton
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("ACCEPTED (§ 12.6): every tenant's file (and the platform file) ends up with the SAME sqlite_sequence, leaking every other tenant's total row counts", () => {
    const db = new Database(sourceDbPath);
    db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
    initDatabase(db);
    runMigrations(db);
    db.pragma("foreign_keys = ON");

    // Tenant 1 (schema's own seed) does a lot of business — many audit rows.
    for (let i = 0; i < 50; i++) {
      db.prepare(
        `INSERT INTO audit_log (tenant_id, user_id, username, role, action, entity_type, summary) VALUES (1, 1, 'admin', 'admin', 'CREATE', 'client', ?)`,
      ).run(`tenant 1 real business activity #${i}`);
    }

    // Tenant 5 is brand new and has done almost nothing.
    db.prepare(
      `INSERT INTO tenants (id, name, slug, status) VALUES (5, 'Brand New Tiny Shop', 'tiny-shop', 'active')`,
    ).run();
    db.prepare(
      `INSERT INTO tenant_subscriptions (tenant_id, plan, status) VALUES (5, 'standard', 'active')`,
    ).run();
    const tenant5Admin = db
      .prepare(
        `INSERT INTO users (tenant_id, username, password_hash, role, is_active) VALUES (5, 'tiny-admin', '', 'admin', 1)`,
      )
      .run().lastInsertRowid as number;
    db.prepare(
      `INSERT INTO audit_log (tenant_id, user_id, username, role, action, entity_type, summary) VALUES (5, ?, 'tiny-admin', 'admin', 'CREATE', 'client', 'tiny shop first-ever action')`,
    ).run(tenant5Admin);

    db.close();

    const report = splitTenantDatabase({ sourceDbPath, outputDir, write: true });

    // The tool's own report says everything is fine.
    expect(report.ok).toBe(true);
    expect(report.mismatches).toEqual([]);
    expect(report.unexpectedGlobalRows).toEqual([]);
    for (const check of report.fileChecks) {
      expect(check.foreignKeyViolations).toBe(0);
      expect(check.integrityCheck).toBe("ok");
    }

    // Independent verification: tenant 5's file has only ~2 audit_log rows
    // of its OWN, yet its sqlite_sequence entry for audit_log reveals the
    // platform-wide total (51+), leaking tenant 1's real business volume.
    const tenant5File = new Database(report.tenantFiles[5], { readonly: true });
    const platformFile = new Database(report.platformFile, { readonly: true });
    try {
      const tenant5OwnAuditRows = tenant5File
        .prepare(`SELECT COUNT(*) c FROM audit_log`)
        .get() as { c: number };
      // Tiny shop's own file really does contain almost nothing.
      expect(tenant5OwnAuditRows.c).toBeLessThan(5);

      const tenant5Seq = tenant5File
        .prepare(`SELECT seq FROM sqlite_sequence WHERE name = 'audit_log'`)
        .get() as { seq: number } | undefined;
      const platformSeq = platformFile
        .prepare(`SELECT seq FROM sqlite_sequence WHERE name = 'audit_log'`)
        .get() as { seq: number } | undefined;

      // eslint-disable-next-line no-console
      console.log(
        "tenant 5's OWN audit_log row count:",
        tenant5OwnAuditRows.c,
        "— but its file's sqlite_sequence high-water-mark for audit_log is:",
        tenant5Seq?.seq,
        "(platform's is the same:",
        platformSeq?.seq,
        ") — i.e. tenant 5's file, on its own, reveals that ~50 audit rows " +
          "were created platform-wide that are NOT its own.",
      );

      expect(tenant5Seq?.seq).toBeGreaterThanOrEqual(51); // proves the leak
      expect(tenant5Seq?.seq).toBe(platformSeq?.seq); // identical everywhere — not narrowed at all
    } finally {
      tenant5File.close();
      platformFile.close();
    }
  });
});
