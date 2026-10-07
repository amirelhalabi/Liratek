/**
 * `splitTenantDatabase()` — the Phase D split tool (`PRODUCTION_DATABASE_AND_HOSTING_PLAN.md`
 * § 12.2/§ 12.3 W3). Brand-new module (rule 17: no "before" version exists,
 * so nothing here is proven failing-first on unfixed code — each test's
 * assertion is instead the specification, and the first run WAS its first
 * real execution against this code).
 *
 * Built against the REAL production schema (`electron-app/create_db.sql` +
 * `runMigrations`), not a hand-rolled mini schema — the split tool's whole
 * job is `PRAGMA table_info` discovery across every real table, so proving
 * it against a stand-in schema would prove nothing about the ~70-table real
 * one. Two tenants (ids 1 — the schema's own default seed — and 5, matching
 * production's actual shop ids per the ticket header, though nothing here
 * depends on that): asymmetric row counts per table so a swapped-tenant bug
 * would show up as a wrong number, not a missing row (same technique as
 * `ProfitRepository.tenantIsolation.test.ts`). A super-admin user/session/
 * audit row (`tenant_id NULL`) proves the platform file keeps exactly the
 * global rows and none of the shop rows.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { initDatabase, closeDatabase } from "../connection.js";
import { runMigrations } from "../migrations/index.js";
import { splitTenantDatabase, discoverTenantScopedTables } from "../tenantSplit.js";

// packages/core/src/db/__tests__ -> repo root is 5 levels up.
const CREATE_DB_SQL_PATH = path.join(
  __dirname,
  "../../../../../electron-app/create_db.sql",
);

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "liratek-tenant-split-"));
}

/** Builds a real production-schema source DB, seeds a SECOND tenant (id 5)
 * with asymmetric data alongside the schema's own default tenant (id 1) and
 * a platform-only super admin. Returns the open connection AND its path —
 * caller must close it. */
function buildSourceDb(sourceDbPath: string): Database.Database {
  const db = new Database(sourceDbPath);
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
  initDatabase(db);
  runMigrations(db);
  db.pragma("foreign_keys = ON");

  // ---- Tenant 5 (asymmetric vs. tenant 1's schema-seeded data) -----------
  db.prepare(
    `INSERT INTO tenants (id, name, slug, status) VALUES (5, 'Test', 'test', 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO tenant_subscriptions (tenant_id, plan, status) VALUES (5, 'standard', 'active')`,
  ).run();

  // Tenant 1 already has users.id=1 ('admin') from the schema's own seed.
  const tenant1User2 = db
    .prepare(
      `INSERT INTO users (tenant_id, username, password_hash, role, is_active) VALUES (1, 'staff-one', '', 'staff', 1)`,
    )
    .run().lastInsertRowid as number;
  const tenant5Admin = db
    .prepare(
      `INSERT INTO users (tenant_id, username, password_hash, role, is_active) VALUES (5, 'admin-five', '', 'admin', 1)`,
    )
    .run().lastInsertRowid as number;
  const superAdmin = db
    .prepare(
      `INSERT INTO users (tenant_id, username, password_hash, role, is_active) VALUES (NULL, 'super-admin', '', 'super_admin', 1)`,
    )
    .run().lastInsertRowid as number;

  db.prepare(
    `INSERT INTO sessions (tenant_id, user_id, token, expires_at) VALUES (1, 1, 'tok-t1-admin', datetime('now', '+1 day'))`,
  ).run();
  db.prepare(
    `INSERT INTO sessions (tenant_id, user_id, token, expires_at) VALUES (1, ?, 'tok-t1-staff', datetime('now', '+1 day'))`,
  ).run(tenant1User2);
  db.prepare(
    `INSERT INTO sessions (tenant_id, user_id, token, expires_at) VALUES (5, ?, 'tok-t5-admin', datetime('now', '+1 day'))`,
  ).run(tenant5Admin);
  db.prepare(
    `INSERT INTO sessions (tenant_id, user_id, token, expires_at) VALUES (NULL, ?, 'tok-super', datetime('now', '+1 day'))`,
  ).run(superAdmin);

  // impersonator_id left NULL throughout in this shared seed — the legacy
  // (pre-B-D3) shape that DOES set it is exercised by dedicated tests below
  // ("rewrites a legacy pre-B-D3 impersonation audit row..." /
  // "does NOT rewrite... regular tenant user"), which build their own rows
  // on top of this fixture rather than perturbing these shared counts.
  db.prepare(
    `INSERT INTO audit_log (tenant_id, user_id, username, role, action, entity_type, summary) VALUES (1, 1, 'admin', 'admin', 'CREATE', 'client', 'tenant 1 audit row A')`,
  ).run();
  db.prepare(
    `INSERT INTO audit_log (tenant_id, user_id, username, role, action, entity_type, summary) VALUES (1, 1, 'admin', 'admin', 'UPDATE', 'client', 'tenant 1 audit row B')`,
  ).run();
  db.prepare(
    `INSERT INTO audit_log (tenant_id, user_id, username, role, action, entity_type, summary) VALUES (5, ?, 'admin-five', 'admin', 'CREATE', 'client', 'tenant 5 audit row')`,
  ).run(tenant5Admin);
  db.prepare(
    `INSERT INTO audit_log (tenant_id, user_id, username, role, action, entity_type, summary) VALUES (NULL, ?, 'super-admin', 'super_admin', 'IMPERSONATE', 'tenant', 'platform audit row')`,
  ).run(superAdmin);

  for (let i = 0; i < 3; i++) {
    db.prepare(
      `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, ?, ?)`,
    ).run(`Tenant1 Client ${i}`, `100000${i}`);
  }
  db.prepare(`INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (5, 'Tenant5 Client', '5000000')`).run();

  for (let i = 0; i < 4; i++) {
    db.prepare(
      `INSERT INTO transactions (tenant_id, type, source_table, source_id, user_id) VALUES (1, 'TEST_TXN', 'test', ?, 1)`,
    ).run(i);
  }
  for (let i = 0; i < 2; i++) {
    db.prepare(
      `INSERT INTO transactions (tenant_id, type, source_table, source_id, user_id) VALUES (5, 'TEST_TXN', 'test', ?, ?)`,
    ).run(i, tenant5Admin);
  }

  return db;
}

describe("splitTenantDatabase", () => {
  let tmpDir: string;
  let sourceDbPath: string;
  let sourceDb: Database.Database | null = null;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    sourceDbPath = path.join(tmpDir, "source.db");
    sourceDb = buildSourceDb(sourceDbPath);
  });

  afterEach(() => {
    sourceDb?.close();
    sourceDb = null;
    closeDatabase();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("dry run reports the plan without writing anything", () => {
    const outputDir = path.join(tmpDir, "out-dry");
    const report = splitTenantDatabase({ sourceDbPath, outputDir, write: false });

    expect(report.dryRun).toBe(true);
    expect(report.tenantIds).toEqual([1, 5]);
    expect(report.unexpectedGlobalRows).toEqual([]);
    expect(report.ok).toBe(true);
    expect(fs.existsSync(outputDir)).toBe(false);
  });

  it("refuses to write into a non-empty output directory", () => {
    const outputDir = path.join(tmpDir, "out-occupied");
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, "junk.txt"), "not empty");

    expect(() =>
      splitTenantDatabase({ sourceDbPath, outputDir, write: true }),
    ).toThrow(/non-empty output directory/);
  });

  it("splits into platform.db + tenants/<id>.db with correct row counts, no cross-tenant leakage, clean FK/integrity, and reuses discoverTenantScopedTables consistently", () => {
    const outputDir = path.join(tmpDir, "out-write");
    const report = splitTenantDatabase({ sourceDbPath, outputDir, write: true });

    expect(report.ok).toBe(true);
    expect(report.mismatches).toEqual([]);
    expect(report.unexpectedGlobalRows).toEqual([]);
    expect(report.tenantIds).toEqual([1, 5]);
    expect(fs.existsSync(report.platformFile)).toBe(true);
    expect(fs.existsSync(report.tenantFiles[1])).toBe(true);
    expect(fs.existsSync(report.tenantFiles[5])).toBe(true);

    // Every file check passed.
    for (const check of report.fileChecks) {
      expect(check.foreignKeyViolations).toBe(0);
      expect(check.integrityCheck).toBe("ok");
    }

    // discoverTenantScopedTables against the source is the same list the
    // report says it verified against (sanity: the tool didn't silently
    // skip tables).
    const rediscovered = discoverTenantScopedTables(sourceDb!);
    expect(new Set(report.tenantScopedTables)).toEqual(new Set(rediscovered));
    expect(report.tenantScopedTables.length).toBeGreaterThan(20); // the real schema, not a stub

    // ---- Tenant 1 file: only tenant 1's rows, right counts -----------
    const t1 = new Database(report.tenantFiles[1], { readonly: true });
    try {
      expect((t1.prepare("SELECT COUNT(*) c FROM tenants").get() as { c: number }).c).toBe(1);
      expect((t1.prepare("SELECT id FROM tenants").get() as { id: number }).id).toBe(1);
      expect((t1.prepare("SELECT COUNT(*) c FROM users").get() as { c: number }).c).toBe(2); // admin + staff-one
      expect(
        (t1.prepare("SELECT COUNT(*) c FROM users WHERE username = 'admin-five'").get() as { c: number }).c,
      ).toBe(0);
      expect(
        (t1.prepare("SELECT COUNT(*) c FROM users WHERE username = 'super-admin'").get() as { c: number }).c,
      ).toBe(0);
      expect((t1.prepare("SELECT COUNT(*) c FROM sessions").get() as { c: number }).c).toBe(2);
      expect((t1.prepare("SELECT COUNT(*) c FROM audit_log").get() as { c: number }).c).toBe(2);
      expect((t1.prepare("SELECT COUNT(*) c FROM clients").get() as { c: number }).c).toBe(3);
      expect((t1.prepare("SELECT COUNT(*) c FROM transactions").get() as { c: number }).c).toBe(4);
      expect(
        (t1.prepare("SELECT COUNT(*) c FROM tenant_subscriptions").get() as { c: number }).c,
      ).toBe(0);
    } finally {
      t1.close();
    }

    // ---- Tenant 5 file: only tenant 5's rows, right counts -----------
    const t5 = new Database(report.tenantFiles[5], { readonly: true });
    try {
      expect((t5.prepare("SELECT COUNT(*) c FROM tenants").get() as { c: number }).c).toBe(1);
      expect((t5.prepare("SELECT id FROM tenants").get() as { id: number }).id).toBe(5);
      expect((t5.prepare("SELECT COUNT(*) c FROM users").get() as { c: number }).c).toBe(1); // admin-five only
      expect((t5.prepare("SELECT COUNT(*) c FROM sessions").get() as { c: number }).c).toBe(1);
      expect((t5.prepare("SELECT COUNT(*) c FROM audit_log").get() as { c: number }).c).toBe(1);
      expect((t5.prepare("SELECT COUNT(*) c FROM clients").get() as { c: number }).c).toBe(1);
      expect((t5.prepare("SELECT COUNT(*) c FROM transactions").get() as { c: number }).c).toBe(2);
      expect(
        (t5.prepare("SELECT COUNT(*) c FROM tenant_subscriptions").get() as { c: number }).c,
      ).toBe(0);
    } finally {
      t5.close();
    }

    // ---- Platform file: only NULL-tenant rows + full tenants/tenant_subscriptions ----
    const platform = new Database(report.platformFile, { readonly: true });
    try {
      expect((platform.prepare("SELECT COUNT(*) c FROM tenants").get() as { c: number }).c).toBe(2);
      expect(
        (platform.prepare("SELECT COUNT(*) c FROM tenant_subscriptions").get() as { c: number }).c,
      ).toBe(2);
      expect(
        (platform.prepare("SELECT COUNT(*) c FROM users WHERE tenant_id IS NULL").get() as { c: number }).c,
      ).toBe(1);
      expect((platform.prepare("SELECT COUNT(*) c FROM users").get() as { c: number }).c).toBe(1); // only the super admin
      expect((platform.prepare("SELECT COUNT(*) c FROM sessions").get() as { c: number }).c).toBe(1);
      expect((platform.prepare("SELECT COUNT(*) c FROM audit_log").get() as { c: number }).c).toBe(1);
      // Shop-only tables carry no platform rows at all.
      expect((platform.prepare("SELECT COUNT(*) c FROM clients").get() as { c: number }).c).toBe(0);
      expect((platform.prepare("SELECT COUNT(*) c FROM transactions").get() as { c: number }).c).toBe(0);
    } finally {
      platform.close();
    }

    // ---- The split shop file actually serves its own data through the
    // real Phase A resolver path (a plain connection + runWithTenant-style
    // access — the file just needs to be a normal readable SQLite db that
    // matches the fixed tenant it claims to be). ----
    const t5Direct = new Database(report.tenantFiles[5]);
    try {
      const row = t5Direct
        .prepare("SELECT full_name FROM clients WHERE tenant_id = 5")
        .get() as { full_name: string } | undefined;
      expect(row?.full_name).toBe("Tenant5 Client");
    } finally {
      t5Direct.close();
    }
  });

  it("keeps the platform-only email tables (LIRA-267) whole in platform.db and empty in every tenant file", () => {
    // One sent invite email + its invitation, used to create tenant 5 — the
    // exact shape that would otherwise be copied by VACUUM INTO into every
    // shop's file (an invitee's email address leaking into other shops).
    const outboxId = sourceDb!
      .prepare(
        `INSERT INTO email_outbox (idempotency_key, template, to_email, data_json, status, next_attempt_at, give_up_at)
         VALUES ('signup-invite:1', 'signup-invite', 'five@example.com', '{}', 'accepted', '2026-10-07T00:00:00.000Z', '2026-10-10T00:00:00.000Z')`,
      )
      .run().lastInsertRowid as number;
    sourceDb!
      .prepare(
        `INSERT INTO signup_invitations (email, token_hash, source, expires_at, used_at, used_by_tenant_id, email_outbox_id)
         VALUES ('five@example.com', 'hash-five', 'admin', '2026-10-10T00:00:00.000Z', '2026-10-07T01:00:00.000Z', 5, ?)`,
      )
      .run(outboxId);
    sourceDb!
      .prepare(
        `INSERT INTO signup_invitations (email, token_hash, source, expires_at)
         VALUES ('pending@example.com', 'hash-pending', 'self', '2026-10-10T00:00:00.000Z')`,
      )
      .run();

    const outputDir = path.join(tmpDir, "out-email-tables");
    const report = splitTenantDatabase({ sourceDbPath, outputDir, write: true });

    expect(report.unexpectedTablesWithoutTenantId).toEqual([]);
    expect(report.mismatches).toEqual([]);
    expect(report.ok).toBe(true);

    const count = (db: Database.Database, table: string): number =>
      (db.prepare(`SELECT COUNT(*) c FROM ${table}`).get() as { c: number }).c;

    for (const id of [1, 5]) {
      const tenantFile = new Database(report.tenantFiles[id], { readonly: true });
      try {
        expect(count(tenantFile, "signup_invitations")).toBe(0);
        expect(count(tenantFile, "email_outbox")).toBe(0);
      } finally {
        tenantFile.close();
      }
    }
    const platform = new Database(report.platformFile, { readonly: true });
    try {
      expect(count(platform, "signup_invitations")).toBe(2);
      expect(count(platform, "email_outbox")).toBe(1);
    } finally {
      platform.close();
    }

    // Both tables are part of the verify step, not merely deleted.
    const verifiedTables = new Set(report.verifiedCounts.map((f) => f.table));
    expect(verifiedTables.has("signup_invitations")).toBe(true);
    expect(verifiedTables.has("email_outbox")).toBe(true);
  });

  it("splits the v196 account tables: tenant-scoped ones to their shop (even when linked to an outbox row), the sign-in hand-off kept in platform.db", () => {
    const admin5 = (
      sourceDb!
        .prepare(`SELECT id FROM users WHERE username = 'admin-five'`)
        .get() as { id: number }
    ).id;
    const outboxId = sourceDb!
      .prepare(
        `INSERT INTO email_outbox (idempotency_key, template, to_email, data_json, status, next_attempt_at, give_up_at)
         VALUES ('user-invite:1', 'user-invite', 'staff@example.com', '{}', 'accepted', '2026-10-07T00:00:00.000Z', '2026-10-10T00:00:00.000Z')`,
      )
      .run().lastInsertRowid as number;
    // An invite LINKED to its (platform-only) outbox row: had
    // email_outbox_id been a FK, tenant 5's file would fail its
    // foreign_key_check once the outbox is deleted from it.
    sourceDb!
      .prepare(
        `INSERT INTO user_invitations (tenant_id, email, role, token_hash, invited_by_user_id, expires_at, email_outbox_id)
         VALUES (5, 'staff@example.com', 'staff', 'inv-hash', ?, '2026-10-10T00:00:00.000Z', ?)`,
      )
      .run(admin5, outboxId);
    sourceDb!
      .prepare(
        `INSERT INTO password_reset_tokens (tenant_id, user_id, token_hash, expires_at, email_outbox_id)
         VALUES (5, ?, 'reset-hash', '2026-10-07T01:00:00.000Z', ?)`,
      )
      .run(admin5, outboxId);
    sourceDb!
      .prepare(
        `INSERT INTO user_identities (user_id, tenant_id, provider, subject, email)
         VALUES (?, 5, 'google', 'sub-five', 'five@example.com')`,
      )
      .run(admin5);
    sourceDb!
      .prepare(
        `INSERT INTO sso_handoff_tokens (token_hash, user_id, target_tenant_id, expires_at)
         VALUES ('sso-hash', ?, 5, '2026-10-07T00:01:00.000Z')`,
      )
      .run(admin5);

    const outputDir = path.join(tmpDir, "out-v196");
    const report = splitTenantDatabase({ sourceDbPath, outputDir, write: true });

    expect(report.unexpectedTablesWithoutTenantId).toEqual([]);
    expect(report.mismatches).toEqual([]);
    expect(report.ok).toBe(true);

    const count = (db: Database.Database, table: string): number =>
      (db.prepare(`SELECT COUNT(*) c FROM ${table}`).get() as { c: number }).c;

    const five = new Database(report.tenantFiles[5], { readonly: true });
    const one = new Database(report.tenantFiles[1], { readonly: true });
    const platform = new Database(report.platformFile, { readonly: true });
    try {
      for (const table of [
        "user_invitations",
        "password_reset_tokens",
        "user_identities",
      ]) {
        expect(count(five, table)).toBe(1);
        expect(count(one, table)).toBe(0);
        expect(count(platform, table)).toBe(0);
      }
      expect(count(five, "sso_handoff_tokens")).toBe(0);
      expect(count(one, "sso_handoff_tokens")).toBe(0);
      expect(count(platform, "sso_handoff_tokens")).toBe(1);
    } finally {
      five.close();
      one.close();
      platform.close();
    }
  });

  it("reports an unexpected global row on any OTHER table holding tenant_id IS NULL rows", () => {
    // Sabotage: a stray global row on a table that is neither
    // users/sessions/audit_log — this is exactly the finding the tool must
    // surface, never silently drop or silently keep.
    sourceDb!.prepare(
      `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (NULL, 'Orphan Global Client', '9999999')`,
    ).run();

    const outputDir = path.join(tmpDir, "out-sabotaged");
    const report = splitTenantDatabase({ sourceDbPath, outputDir, write: false });

    expect(report.ok).toBe(false);
    expect(report.unexpectedGlobalRows).toEqual([
      { table: "clients", nullRowCount: 1 },
    ]);
  });

  // ---------------------------------------------------------------------
  // Split hardening (plan § 12.3 W5, ticket item 3a/3b). Guard tests written
  // FIRST against the pre-hardening tool and seen failing (rule 17): today
  // `discoverTenantScopedTables` only ever reports tables it recognizes as
  // tenant-scoped, and both a table with no `tenant_id` column at all and a
  // table whose name fails `isSimpleIdentifier` are silently left OUT of
  // that list. Neither is then touched by `buildTenantFile`'s per-table
  // DELETE loop, so `VACUUM INTO` carries every one of its rows, unfiltered,
  // into EVERY tenant's file AND the platform file — a real cross-shop leak
  // that today's report still calls `ok: true`.
  // ---------------------------------------------------------------------

  it("fails (ok:false, refuses to write) when a table has no tenant_id column and is not on the known-global allowlist", () => {
    // A table nobody remembered to add tenant_id to. Today this is copied
    // wholesale into every output file by VACUUM INTO and never filtered,
    // because it never appears in discoverTenantScopedTables()'s list.
    sourceDb!.exec(`
      CREATE TABLE rogue_global_table (
        id INTEGER PRIMARY KEY,
        secret TEXT NOT NULL
      )
    `);
    sourceDb!
      .prepare(`INSERT INTO rogue_global_table (secret) VALUES ('tenant1-secret')`)
      .run();
    sourceDb!
      .prepare(`INSERT INTO rogue_global_table (secret) VALUES ('tenant5-secret')`)
      .run();

    const outputDir = path.join(tmpDir, "out-rogue-table");
    const report = splitTenantDatabase({ sourceDbPath, outputDir, write: true });

    expect(report.ok).toBe(false);
    expect(report.unexpectedTablesWithoutTenantId).toEqual([
      "rogue_global_table",
    ]);
    // Refuses to produce any file at all rather than write a leaking one.
    expect(fs.existsSync(outputDir)).toBe(false);
  });

  it("fails (ok:false, refuses to write) instead of silently skipping a table whose name is not a simple SQL identifier", () => {
    // Same leak, triggered by naming instead of a missing column: this table
    // DOES have tenant_id, but today's isSimpleIdentifier filter drops it
    // from discoverTenantScopedTables()'s list before the tenant_id check
    // ever runs, so it is never narrowed per tenant either.
    sourceDb!.exec(`
      CREATE TABLE "weird table" (
        id INTEGER PRIMARY KEY,
        tenant_id INTEGER,
        secret TEXT NOT NULL
      )
    `);
    sourceDb!
      .prepare(`INSERT INTO "weird table" (tenant_id, secret) VALUES (1, 'tenant1-secret')`)
      .run();
    sourceDb!
      .prepare(`INSERT INTO "weird table" (tenant_id, secret) VALUES (5, 'tenant5-secret')`)
      .run();

    const outputDir = path.join(tmpDir, "out-weird-name");
    const report = splitTenantDatabase({ sourceDbPath, outputDir, write: true });

    expect(report.ok).toBe(false);
    expect(report.unsafeTableNames).toEqual(["weird table"]);
    expect(fs.existsSync(outputDir)).toBe(false);
  });

  // ---------------------------------------------------------------------
  // Phase D rehearsal follow-up item 1: the report must NAME the violating
  // rows, not just count them. Guard written first against the pre-fix
  // `checkFileIntegrity` (which returned only `{ foreignKeyViolations:
  // number }`) and seen to fail with `Received: undefined` — proven against
  // a throwaway byte-for-byte copy of the pre-fix module rather than by
  // reverting the real (already-fixed) `tenantSplit.ts`, per rule 17.
  // ---------------------------------------------------------------------

  it("names the violating rows (table + rowid + parent) when a tenant file ends up with a dangling cross-tenant FK reference", () => {
    // Cross-tenant FK: a tenant-5 transaction referencing a tenant-1-only
    // client. `transactions.client_id REFERENCES clients(id)` is a real
    // constraint (create_db.sql); once the tenant-5 file's clients table is
    // narrowed to tenant 5 only, that client id no longer exists there, so
    // the tenant-5 file's own `PRAGMA foreign_key_check` reports it.
    const tenant1ClientId = (
      sourceDb!.prepare(`SELECT id FROM clients WHERE tenant_id = 1 LIMIT 1`).get() as {
        id: number;
      }
    ).id;
    const tenant5AdminId = (
      sourceDb!.prepare(`SELECT id FROM users WHERE username = 'admin-five'`).get() as {
        id: number;
      }
    ).id;
    sourceDb!
      .prepare(
        `INSERT INTO transactions (tenant_id, type, source_table, source_id, user_id, client_id) VALUES (5, 'TEST_TXN', 'test', 999, ?, ?)`,
      )
      .run(tenant5AdminId, tenant1ClientId);

    const outputDir = path.join(tmpDir, "out-fk-violation");
    const report = splitTenantDatabase({ sourceDbPath, outputDir, write: true });

    expect(report.ok).toBe(false);

    const tenant5FileCheck = report.fileChecks.find((c) => c.file === report.tenantFiles[5]);
    expect(tenant5FileCheck).toBeDefined();
    expect(tenant5FileCheck!.foreignKeyViolations).toBeGreaterThan(0);
    expect(tenant5FileCheck!.foreignKeyViolationRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: "transactions", parent: "clients" }),
      ]),
    );
    // The count and the listed-rows length agree when under the cap.
    expect(tenant5FileCheck!.foreignKeyViolationRows.length).toBe(
      tenant5FileCheck!.foreignKeyViolations,
    );

    // Every OTHER file stays clean — the finding is scoped to tenant 5 only.
    for (const check of report.fileChecks) {
      if (check.file === report.tenantFiles[5]) continue;
      expect(check.foreignKeyViolations).toBe(0);
      expect(check.foreignKeyViolationRows).toEqual([]);
    }
  });

  // ---------------------------------------------------------------------
  // Litestream artifact finding (dry run against a real production
  // snapshot, 2026-09-28): Litestream creates its OWN bookkeeping tables
  // inside every database it replicates — verified against Litestream's own
  // source (`db.go`): `_litestream_seq (id INTEGER PRIMARY KEY, seq INTEGER)`
  // "to force writes to the WAL when empty" and `_litestream_lock (id
  // INTEGER)` "to force write locks during sync". Neither carries a
  // `tenant_id`, and today's hard-fail scan (`discoverUnsafeAndUnscopedTables`)
  // does not know they are special, so a real snapshot came back `ok: false`
  // with `unexpectedTablesWithoutTenantId: ["_litestream_seq",
  // "_litestream_lock"]` — a false-positive refusal, not a real leak: these
  // are Litestream's own plumbing, not shop data, and Litestream recreates
  // them on its own the moment it starts replicating a file. Guard written
  // FIRST against the pre-fix code and seen failing (rule 17).
  // ---------------------------------------------------------------------

  it("excludes Litestream's own replication-bookkeeping tables from the unknown-table refusal, and drops them from every output file", () => {
    sourceDb!.exec(`CREATE TABLE _litestream_seq (id INTEGER PRIMARY KEY, seq INTEGER)`);
    sourceDb!.prepare(`INSERT INTO _litestream_seq (id, seq) VALUES (1, 42)`).run();
    sourceDb!.exec(`CREATE TABLE _litestream_lock (id INTEGER)`);

    const outputDir = path.join(tmpDir, "out-litestream");
    const report = splitTenantDatabase({ sourceDbPath, outputDir, write: true });

    expect(report.ok).toBe(true);
    expect(report.unexpectedTablesWithoutTenantId).toEqual([]);
    expect(report.unsafeTableNames).toEqual([]);
    expect(new Set(report.droppedReplicationTables)).toEqual(
      new Set(["_litestream_seq", "_litestream_lock"]),
    );

    const allFiles = [report.platformFile, ...Object.values(report.tenantFiles)];
    expect(allFiles.length).toBeGreaterThan(0);
    for (const filePath of allFiles) {
      const file = new Database(filePath, { readonly: true });
      try {
        const remaining = file
          .prepare(
            `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '\\_litestream\\_%' ESCAPE '\\'`,
          )
          .all() as { name: string }[];
        expect(remaining).toEqual([]);
      } finally {
        file.close();
      }
    }
  });

  // ---------------------------------------------------------------------
  // Production-snapshot finding (real dry run, 2026-09-28): shop 5's
  // audit_log row 158, IMPERSONATION_START, tenant_id 5, impersonator_id =
  // 4 — user 4 is a super_admin (tenant_id NULL), a platform-only user. This
  // is the pre-B-D3 shape: before 2026-09-27, the impersonation-start
  // shop-note row put the PLATFORM user's id directly in the tenant-scoped
  // `audit_log.impersonator_id REFERENCES users(id)` FK column. Current code
  // (`backend/src/api/admin.ts`, `AuditService.ts`) always writes
  // `impersonator_id: null` and keeps the impersonator's identity in
  // `metadata` (`impersonatedBy`, `impersonatorUserId`) instead — so once
  // split, the platform user referenced by a legacy row does not exist in
  // the shop's own `users` table (narrowed to that shop's tenant_id only)
  // and `PRAGMA foreign_key_check` reports it. Guard written FIRST against
  // the pre-fix `tenantSplit.ts` (rule 17) — no rewrite exists yet, so this
  // must fail with exactly that dangling reference.
  // ---------------------------------------------------------------------

  it("rewrites a legacy pre-B-D3 impersonation audit row (impersonator_id pointing at a platform user) instead of failing the split", () => {
    const superAdminId = (
      sourceDb!.prepare(`SELECT id FROM users WHERE username = 'super-admin'`).get() as {
        id: number;
      }
    ).id;
    const tenant5AdminId = (
      sourceDb!.prepare(`SELECT id FROM users WHERE username = 'admin-five'`).get() as {
        id: number;
      }
    ).id;

    const legacyRowId = sourceDb!
      .prepare(
        `INSERT INTO audit_log
           (tenant_id, user_id, username, role, action, entity_type, entity_id, summary, metadata, impersonator_id)
         VALUES (5, ?, 'admin-five', 'admin', 'IMPERSONATION_START', 'session', '999', 'legacy impersonation row', ?, ?)`,
      )
      .run(tenant5AdminId, JSON.stringify({ preExisting: "keep-me" }), superAdminId)
      .lastInsertRowid as number;

    const outputDir = path.join(tmpDir, "out-legacy-impersonator");
    const report = splitTenantDatabase({ sourceDbPath, outputDir, write: true });

    expect(report.ok).toBe(true);
    expect(report.rewrittenLegacyImpersonatorRows).toEqual([
      {
        file: report.tenantFiles[5],
        table: "audit_log",
        rowid: legacyRowId,
        impersonatorUserId: superAdminId,
      },
    ]);

    const t5 = new Database(report.tenantFiles[5], { readonly: true });
    try {
      const row = t5
        .prepare(
          `SELECT impersonator_id, metadata FROM audit_log WHERE action = 'IMPERSONATION_START'`,
        )
        .get() as { impersonator_id: number | null; metadata: string | null };
      expect(row.impersonator_id).toBeNull();
      const metadata = JSON.parse(row.metadata!) as Record<string, unknown>;
      expect(metadata.impersonatedBy).toBe("super-admin");
      expect(metadata.impersonatorUserId).toBe(superAdminId);
      expect(metadata.preExisting).toBe("keep-me"); // pre-existing metadata is preserved, not clobbered
    } finally {
      t5.close();
    }

    const t5FileCheck = report.fileChecks.find((c) => c.file === report.tenantFiles[5]);
    expect(t5FileCheck!.foreignKeyViolations).toBe(0);
  });

  it("does NOT rewrite, and still fails the split on, an audit row whose impersonator_id points at a regular (non-platform) tenant user", () => {
    const tenant1UserId = (
      sourceDb!.prepare(`SELECT id FROM users WHERE username = 'staff-one'`).get() as {
        id: number;
      }
    ).id;
    const tenant5AdminId = (
      sourceDb!.prepare(`SELECT id FROM users WHERE username = 'admin-five'`).get() as {
        id: number;
      }
    ).id;

    sourceDb!
      .prepare(
        `INSERT INTO audit_log
           (tenant_id, user_id, username, role, action, entity_type, entity_id, summary, impersonator_id)
         VALUES (5, ?, 'admin-five', 'admin', 'IMPERSONATION_START', 'session', '998', 'bogus cross-tenant impersonator', ?)`,
      )
      .run(tenant5AdminId, tenant1UserId);

    const outputDir = path.join(tmpDir, "out-bogus-impersonator");
    const report = splitTenantDatabase({ sourceDbPath, outputDir, write: true });

    expect(report.ok).toBe(false);
    expect(report.rewrittenLegacyImpersonatorRows).toEqual([]);

    const t5FileCheck = report.fileChecks.find((c) => c.file === report.tenantFiles[5]);
    expect(t5FileCheck!.foreignKeyViolations).toBeGreaterThan(0);
    expect(t5FileCheck!.foreignKeyViolationRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: "audit_log", parent: "users" }),
      ]),
    );
  });
});
