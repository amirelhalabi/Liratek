/**
 * LIRA-306 T111/T112 — `narrowToTenant()` extraction from the Phase D split.
 *
 * Two halves, deliberately:
 *
 *  1. "pins today's split output" — a CHARACTERIZATION of
 *     `splitTenantDatabase()` written and run green against the
 *     PRE-refactor `tenantSplit.ts` (T111), so the T112 extraction can be
 *     shown to change nothing. It compares every table of every shop file
 *     ROW FOR ROW against an independent reading of the source (not against
 *     a stored golden file: the seed's timestamps differ per run, the rule
 *     does not). Passing before the refactor is the point here, not a defect.
 *  2. "narrowToTenant" — the extracted function itself, used directly the
 *     way the offline snapshot uses it. These failed first (the export did
 *     not exist) and pass once T112 lands.
 *
 * Real schema (`electron-app/create_db.sql` + `runMigrations`), shops 1 and 5
 * with asymmetric rows, plus a platform super-admin (`tenant_id NULL`).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { initDatabase, closeDatabase } from "../connection.js";
import { runMigrations } from "../migrations/index.js";
import * as tenantSplit from "../tenantSplit.js";

const { splitTenantDatabase } = tenantSplit;

const CREATE_DB_SQL_PATH = path.join(__dirname, "../../../../../electron-app/create_db.sql");

type Row = Record<string, unknown>;

function seedSource(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
  initDatabase(db);
  runMigrations(db);
  db.pragma("foreign_keys = ON");

  db.prepare(`INSERT INTO tenants (id, name, slug, status) VALUES (5, 'Five', 'five', 'active')`).run();
  // Shop 1's subscription row comes from create_db.sql's own seed.
  db.prepare(`UPDATE tenant_subscriptions SET license_key = 'LIC-ONE' WHERE tenant_id = 1`).run();
  db.prepare(
    `INSERT INTO tenant_subscriptions (tenant_id, plan, status, license_key) VALUES (5, 'standard', 'active', 'LIC-FIVE')`,
  ).run();
  const u5 = db
    .prepare(
      `INSERT INTO users (tenant_id, username, password_hash, role, is_active) VALUES (5, 'admin-five', 'hash-five', 'admin', 1)`,
    )
    .run().lastInsertRowid as number;
  const superAdmin = db
    .prepare(
      `INSERT INTO users (tenant_id, username, password_hash, role, is_active) VALUES (NULL, 'super', 'hash-super', 'super_admin', 1)`,
    )
    .run().lastInsertRowid as number;
  db.prepare(
    `INSERT INTO sessions (tenant_id, user_id, token, expires_at) VALUES (5, ?, 'tok-5', datetime('now', '+1 day'))`,
  ).run(u5);
  db.prepare(
    `INSERT INTO sessions (tenant_id, user_id, token, expires_at) VALUES (NULL, ?, 'tok-super', datetime('now', '+1 day'))`,
  ).run(superAdmin);
  db.prepare(
    `INSERT INTO sessions (tenant_id, user_id, token, expires_at) VALUES (1, 1, 'tok-1', datetime('now', '+1 day'))`,
  ).run();
  for (let i = 0; i < 3; i++) {
    db.prepare(`INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, ?, ?)`).run(`One ${i}`, `10${i}`);
  }
  db.prepare(`INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (5, 'Five client', '500')`).run();
  for (let i = 0; i < 2; i++) {
    db.prepare(
      `INSERT INTO transactions (tenant_id, type, source_table, source_id, user_id) VALUES (5, 'TEST_TXN', 'test', ?, ?)`,
    ).run(i, u5);
  }
  db.prepare(
    `INSERT INTO audit_log (tenant_id, user_id, username, role, action, entity_type, summary) VALUES (NULL, ?, 'super', 'super_admin', 'IMPERSONATE', 'tenant', 'platform row')`,
  ).run(superAdmin);
  db.prepare(
    `INSERT INTO audit_log (tenant_id, user_id, username, role, action, entity_type, summary) VALUES (5, ?, 'admin-five', 'admin', 'CREATE', 'client', 'shop 5 row')`,
  ).run(u5);
  // Platform-only (no tenant_id) — must vanish from shop files.
  db.prepare(
    `INSERT INTO email_outbox (idempotency_key, template, to_email, data_json, next_attempt_at, give_up_at)
     VALUES ('k1', 't', 'x@example.com', '{}', datetime('now'), datetime('now', '+1 day'))`,
  ).run();
  // Known global without tenant_id — today the split copies it WHOLE into
  // every shop file (pinned below; the snapshot empties it separately).
  db.prepare(`INSERT INTO sync_queue (table_name, record_id, action_type, payload_json) VALUES ('clients', 1, 'INSERT', '{}')`).run();
  return db;
}

function tableNames(db: Database.Database): string[] {
  return (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
      .all() as { name: string }[]
  ).map((r) => r.name);
}

function hasTenantId(db: Database.Database, table: string): boolean {
  return (db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).some((c) => c.name === "tenant_id");
}

function rowsOf(db: Database.Database, table: string, where = "", params: unknown[] = []): Row[] {
  return db.prepare(`SELECT * FROM "${table}" ${where} ORDER BY rowid`).all(...params) as Row[];
}

const PLATFORM_ONLY = ["signup_invitations", "email_outbox", "sso_handoff_tokens", "signin_codes", "signin_directory"];

/**
 * Today's rule, written independently of tenantSplit.ts: what a shop file
 * must hold for `table`, read from the SOURCE.
 */
function expectedShopRows(source: Database.Database, table: string, tenantId: number): Row[] {
  if (table === "tenants") return rowsOf(source, table, "WHERE id = ?", [tenantId]);
  if (table === "tenant_subscriptions") return [];
  if (PLATFORM_ONLY.includes(table)) return [];
  if (hasTenantId(source, table)) return rowsOf(source, table, "WHERE tenant_id = ?", [tenantId]);
  return rowsOf(source, table); // known globals (sync_queue, sync_errors, schema_migrations)
}

function expectShopFileMatchesRule(file: Database.Database, source: Database.Database, tenantId: number): void {
  expect(tableNames(file)).toEqual(tableNames(source));
  for (const table of tableNames(source)) {
    expect({ table, rows: rowsOf(file, table) }).toEqual({ table, rows: expectedShopRows(source, table, tenantId) });
  }
}

describe("tenantSplit — narrowToTenant extraction (LIRA-306 T111/T112)", () => {
  let tmpDir: string;
  let source: Database.Database;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "liratek-narrow-"));
    source = seedSource(path.join(tmpDir, "source.db"));
  });

  afterEach(() => {
    source.close();
    closeDatabase();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("pins today's split output: every shop file equals the source rule row for row; sqlite_sequence copied as-is", () => {
    const report = splitTenantDatabase({
      sourceDbPath: path.join(tmpDir, "source.db"),
      outputDir: path.join(tmpDir, "out"),
      write: true,
    });
    expect(report.ok).toBe(true);
    expect(report.tenantIds).toEqual([1, 5]);
    expect(report.rewrittenLegacyImpersonatorRows).toEqual([]);
    expect(report.droppedReplicationTables).toEqual([]);

    for (const id of [1, 5]) {
      const file = new Database(report.tenantFiles[id], { readonly: true });
      try {
        expectShopFileMatchesRule(file, source, id);
        // The accepted § 12.6 leak: platform-wide counters ride along.
        expect(rowsOf(file, "sqlite_sequence")).toEqual(rowsOf(source, "sqlite_sequence"));
        expect(rowsOf(file, "sync_queue")).toHaveLength(1);
      } finally {
        file.close();
      }
    }
  });

  describe("narrowToTenant", () => {
    function copyOfSource(name: string): Database.Database {
      const dest = path.join(tmpDir, name);
      source.prepare("VACUUM INTO ?").run(dest);
      return new Database(dest);
    }

    it("is exported and narrows a copy exactly like the split narrows a shop file", () => {
      expect(typeof tenantSplit.narrowToTenant).toBe("function");
      const copy = copyOfSource("narrow-5.db");
      try {
        const result = tenantSplit.narrowToTenant(copy, 5, { sourceDb: source });
        expect(result.rewrittenLegacyImpersonatorRows).toEqual([]);
        expectShopFileMatchesRule(copy, source, 5);
      } finally {
        copy.close();
      }
    });

    it("keepOwnSubscriptionRow keeps ONLY the shop's own tenant_subscriptions row", () => {
      const copy = copyOfSource("narrow-5-sub.db");
      try {
        tenantSplit.narrowToTenant(copy, 5, { sourceDb: source, keepOwnSubscriptionRow: true });
        expect(rowsOf(copy, "tenant_subscriptions")).toEqual(
          rowsOf(source, "tenant_subscriptions", "WHERE tenant_id = 5"),
        );
        expect(rowsOf(copy, "tenant_subscriptions")).toHaveLength(1);
      } finally {
        copy.close();
      }
    });

    it("refuses (throws, nothing narrowed) when the schema has an unscoped table the split would also refuse", () => {
      source.exec(`CREATE TABLE leaky_global (id INTEGER PRIMARY KEY, secret TEXT)`);
      const copy = copyOfSource("narrow-refuse.db");
      try {
        expect(() => tenantSplit.narrowToTenant(copy, 5, { sourceDb: source })).toThrow(/leaky_global/);
        // Nothing was deleted: shop 1's clients are still there.
        expect(rowsOf(copy, "clients", "WHERE tenant_id = 1")).toHaveLength(3);
      } finally {
        copy.close();
      }
    });
  });
});
