/**
 * Web "Download backup" (Settings › Backup) — `ShopBackupService`.
 *
 * Written failing-first (rule 17): the service, repository and the shared
 * copy builder did not exist when this file was first run.
 *
 * SHARED mode (one file, two shops — local dev and tests): the downloaded
 * file must hold ONLY the caller's shop. Also covered: the per-tenant shape
 * (the source is already a single-shop file, as `/data/tenants/<id>.db` is),
 * sign-in material cleared, no offline-copy marker (a restored backup must
 * not look like an offline working copy to the desktop), and the file name.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { closeDatabase, initDatabase } from "../../db/connection.js";
import { runMigrations } from "../../db/migrations/index.js";
import { runWithTenant } from "../../db/tenantContext.js";
import { narrowToTenant } from "../../db/tenantSplit.js";
import { ShopBackupRepository } from "../../repositories/ShopBackupRepository.js";
import { ShopBackupService } from "../ShopBackupService.js";
import { shopBackupQuerySchema } from "../../validators/backup.js";

const CREATE_DB_SQL_PATH = path.join(__dirname, "../../../../../electron-app/create_db.sql");

const count = (db: Database.Database, sql: string, ...p: unknown[]): number =>
  (db.prepare(sql).get(...p) as { c: number }).c;

function seed(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
  initDatabase(db);
  runMigrations(db);
  db.pragma("foreign_keys = ON");
  db.prepare(`INSERT INTO tenants (id, name, slug, status) VALUES (5, 'Five', 'five-shop', 'active')`).run();
  const u5 = db
    .prepare(`INSERT INTO users (tenant_id, username, password_hash, role) VALUES (5, 'owner5', 'scrypt$five', 'admin')`)
    .run().lastInsertRowid as number;
  const u1 = db
    .prepare(`INSERT INTO users (tenant_id, username, password_hash, role) VALUES (1, 'owner1', 'scrypt$one', 'admin')`)
    .run().lastInsertRowid as number;
  db.prepare(`INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (5, 'Five client', '500')`).run();
  for (let i = 0; i < 3; i++) {
    db.prepare(`INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, ?, ?)`).run(`One ${i}`, `10${i}`);
  }
  for (const [t, u] of [
    [5, u5],
    [1, u1],
    [1, u1],
  ] as const) {
    db.prepare(
      `INSERT INTO transactions (tenant_id, type, source_table, source_id, user_id, amount_usd) VALUES (?, 'SALE', 'sales', 1, ?, 10)`,
    ).run(t, u);
  }
  for (const [t, u, tok] of [
    [5, u5, "tok-5"],
    [1, u1, "tok-1"],
  ] as const) {
    db.prepare(`INSERT INTO sessions (tenant_id, user_id, token, expires_at) VALUES (?, ?, ?, datetime('now', '+1 day'))`).run(
      t,
      u,
      tok,
    );
  }
  db.prepare(`INSERT INTO password_reset_tokens (tenant_id, user_id, token_hash, expires_at) VALUES (5, ?, 'reset-5', datetime('now'))`).run(u5);
  db.prepare(
    `INSERT INTO idempotency_keys (tenant_id, user_id, route, idem_key, response_json, created_at, updated_at) VALUES (5, ?, '/x', 'k5', '{}', datetime('now'), datetime('now'))`,
  ).run(u5);
  return db;
}

describe("ShopBackupService (web Download backup)", () => {
  let tmp: string;
  let workRoot: string;
  let source: Database.Database;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "liratek-backup-test-"));
    workRoot = path.join(tmp, "work");
    fs.mkdirSync(workRoot);
    source = seed(path.join(tmp, "source.db"));
  });
  afterEach(() => {
    source.close();
    closeDatabase();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function service(db: Database.Database = source): ShopBackupService {
    return new ShopBackupService(new ShopBackupRepository(db), { tmpRoot: workRoot });
  }

  it("SHARED mode: the file holds only the caller's shop, and no sign-in material", () => {
    const backup = runWithTenant(5, () => service().createBackup({ stamp: "2026-11-10-1430" }));
    try {
      const copy = new Database(backup.filePath, { readonly: true });
      try {
        expect(copy.pragma("integrity_check", { simple: true })).toBe("ok");
        expect(count(copy, `SELECT COUNT(*) AS c FROM clients`)).toBe(1);
        expect(count(copy, `SELECT COUNT(*) AS c FROM clients WHERE tenant_id != 5`)).toBe(0);
        expect(count(copy, `SELECT COUNT(*) AS c FROM transactions`)).toBe(1);
        expect(count(copy, `SELECT COUNT(*) AS c FROM users WHERE tenant_id IS NULL OR tenant_id != 5`)).toBe(0);
        expect(copy.prepare(`SELECT id FROM tenants`).all()).toEqual([{ id: 5 }]);
        // cleared
        expect(count(copy, `SELECT COUNT(*) AS c FROM sessions`)).toBe(0);
        expect(count(copy, `SELECT COUNT(*) AS c FROM password_reset_tokens`)).toBe(0);
        expect(count(copy, `SELECT COUNT(*) AS c FROM idempotency_keys`)).toBe(0);
        // a restored backup must not look like an offline working copy
        expect(count(copy, `SELECT COUNT(*) AS c FROM offline_copy_meta`)).toBe(0);
        // kept: the shop's users with their password hashes (needed to sign in after a restore)
        expect(copy.prepare(`SELECT username, password_hash FROM users`).all()).toEqual([
          { username: "owner5", password_hash: "scrypt$five" },
        ]);
      } finally {
        copy.close();
      }
      expect(backup.fileName).toBe("liratek-five-shop-2026-11-10-1430.db");
      expect(backup.sizeBytes).toBe(fs.statSync(backup.filePath).size);
    } finally {
      backup.dispose();
    }
    // nothing left behind
    expect(fs.readdirSync(workRoot)).toEqual([]);
    // the source was not changed
    expect(count(source, `SELECT COUNT(*) AS c FROM sessions`)).toBe(2);
    expect(count(source, `SELECT COUNT(*) AS c FROM clients`)).toBe(4);
  });

  it("PER-TENANT shape: a source that already is the shop's own file still builds", () => {
    const own = path.join(tmp, "tenant5.db");
    source.prepare("VACUUM INTO ?").run(own);
    const ownDb = new Database(own);
    narrowToTenant(ownDb, 5, { sourceDb: source, keepOwnSubscriptionRow: true, label: "test" });
    try {
      const backup = runWithTenant(5, () => service(ownDb).createBackup({ stamp: "2026-11-10-0905" }));
      try {
        const copy = new Database(backup.filePath, { readonly: true });
        try {
          expect(count(copy, `SELECT COUNT(*) AS c FROM clients`)).toBe(1);
          expect(count(copy, `SELECT COUNT(*) AS c FROM sessions`)).toBe(0);
        } finally {
          copy.close();
        }
      } finally {
        backup.dispose();
      }
    } finally {
      ownDb.close();
    }
  });

  it("dispose() is safe to call twice", () => {
    const backup = runWithTenant(5, () => service().createBackup({}));
    backup.dispose();
    expect(() => backup.dispose()).not.toThrow();
    expect(fs.readdirSync(workRoot)).toEqual([]);
  });

  it("names the file from the client's stamp; refuses a malformed stamp", () => {
    expect(shopBackupQuerySchema.safeParse({ stamp: "2026-11-10-1430" }).success).toBe(true);
    expect(shopBackupQuerySchema.safeParse({}).success).toBe(true);
    for (const bad of ["2026-11-10", "../../etc", "2026-11-10-1430.db", "2026-11-10 14:30"]) {
      expect(shopBackupQuerySchema.safeParse({ stamp: bad }).success).toBe(false);
    }
  });
});
