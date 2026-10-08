/**
 * Migration v200 (LIRA-288) — `signin_directory`, the PLATFORM-level index
 * www reads to answer "which shops can this email / Google account open?"
 * without scanning any shop's own records.
 *
 * Guards: the table shape (no `tenant_id` column, a CHECK on `kind`,
 * UNIQUE(kind, value, target_tenant_id), the (target_tenant_id,
 * target_user_id) index, FK cascade on target_tenant_id), the one-time
 * back-fill in a shared database (confirmed emails + Google links of active,
 * non-super-admin users only), the back-fill being skipped when `users` is
 * absent and inserting nothing on a per-tenant platform file (super admins
 * only), `down()`, and create_db.sql declaring it with its seed row.
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "../index.js";

const V200 = MIGRATIONS.find((m) => m.version === 200);

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../../electron-app/create_db.sql"),
  "utf8",
);

const AT = "2026-09-01T08:00:00.000Z";

/** create_db.sql already contains v200; drop the table so `up()` is what
 * creates it, exactly as on a database that was at v199. */
function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(CREATE_DB_SQL);
  db.exec(`DROP TABLE IF EXISTS signin_directory`);
  db.exec(`
    INSERT INTO tenants (id, name, slug, status) VALUES
      (2, 'Corner Tech', 'cornertech', 'active'),
      (3, 'Rami Phones', 'ramiphones', 'suspended');
    INSERT INTO users (id, tenant_id, username, password_hash, role, is_active, email, email_verified_at) VALUES
      (20, 2, 'boss', 'x', 'admin', 1, 'owner@gmail.com', '${AT}'),
      (21, 2, 'rami', 'x', 'staff', 1, 'rami@gmail.com', '${AT}'),
      (22, 2, 'unconfirmed', 'x', 'staff', 1, 'u@gmail.com', NULL),
      (23, 2, 'gone', 'x', 'staff', 0, 'gone@gmail.com', '${AT}'),
      (24, 2, 'nomail', 'x', 'staff', 1, NULL, NULL),
      (30, 3, 'Rami', 'x', 'admin', 1, 'rami@gmail.com', '${AT}'),
      (90, NULL, 'root', 'x', 'super_admin', 1, 'root@liratek.shop', '${AT}');
    INSERT INTO user_identities (user_id, tenant_id, provider, subject, email, created_at, updated_at) VALUES
      (21, 2, 'google', 'sub-rami', 'rami@gmail.com', '${AT}', '${AT}'),
      (23, 2, 'google', 'sub-gone', 'gone@gmail.com', '${AT}', '${AT}'),
      (24, 2, 'google', 'sub-nomail', NULL, '${AT}', '${AT}'),
      (30, 3, 'google', 'sub-rami', 'rami@gmail.com', '${AT}', '${AT}');
  `);
  return db;
}

interface Row {
  kind: string;
  value: string;
  target_tenant_id: number;
  target_user_id: number;
  username: string;
  display_email: string | null;
}

function rows(db: Database.Database): Row[] {
  return db
    .prepare(
      `SELECT kind, value, target_tenant_id, target_user_id, username, display_email
         FROM signin_directory
        ORDER BY kind, target_tenant_id, target_user_id`,
    )
    .all() as Row[];
}

function columns(db: Database.Database): string[] {
  return (
    db.prepare(`SELECT name FROM pragma_table_info('signin_directory')`).all() as {
      name: string;
    }[]
  ).map((c) => c.name);
}

describe("v200 — signin_directory (platform level)", () => {
  it("is registered", () => {
    expect(V200?.name).toBe("signin_directory");
  });

  it("creates the table with no tenant_id column", () => {
    const db = makeDb();
    V200!.up(db);
    expect(columns(db)).toEqual([
      "id",
      "kind",
      "value",
      "target_tenant_id",
      "target_user_id",
      "username",
      "display_email",
      "created_at",
      "updated_at",
    ]);
  });

  it("back-fills confirmed emails and Google links of active, non-super-admin users — in every shop", () => {
    const db = makeDb();
    V200!.up(db);
    expect(rows(db)).toEqual([
      { kind: "email", value: "owner@gmail.com", target_tenant_id: 2, target_user_id: 20, username: "boss", display_email: null },
      { kind: "email", value: "rami@gmail.com", target_tenant_id: 2, target_user_id: 21, username: "rami", display_email: null },
      // A suspended shop's rows are KEPT: shop status is applied at read time.
      { kind: "email", value: "rami@gmail.com", target_tenant_id: 3, target_user_id: 30, username: "Rami", display_email: null },
      { kind: "google", value: "sub-rami", target_tenant_id: 2, target_user_id: 21, username: "rami", display_email: "rami@gmail.com" },
      { kind: "google", value: "sub-nomail", target_tenant_id: 2, target_user_id: 24, username: "nomail", display_email: null },
      { kind: "google", value: "sub-rami", target_tenant_id: 3, target_user_id: 30, username: "Rami", display_email: "rami@gmail.com" },
    ]);
  });

  it("refuses a kind outside email/google and a second row for the same value in one shop", () => {
    const db = makeDb();
    V200!.up(db);
    const insert = db.prepare(
      `INSERT INTO signin_directory (kind, value, target_tenant_id, target_user_id, username, display_email, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, '${AT}', '${AT}')`,
    );
    expect(() => insert.run("phone", "1", 2, 20, "boss")).toThrow(/CHECK/);
    expect(() => insert.run("email", "owner@gmail.com", 2, 22, "unconfirmed")).toThrow(
      /UNIQUE/,
    );
    // The same value in ANOTHER shop is fine.
    expect(() => insert.run("email", "owner@gmail.com", 3, 30, "Rami")).not.toThrow();
  });

  it("indexes (target_tenant_id, target_user_id) and cascades a deleted shop", () => {
    const db = makeDb();
    V200!.up(db);
    const index = db
      .prepare(
        `SELECT name FROM pragma_index_list('signin_directory') WHERE name = 'idx_signin_directory_target'`,
      )
      .get();
    expect(index).toBeDefined();
    const cols = (
      db.prepare(`SELECT name FROM pragma_index_info('idx_signin_directory_target')`).all() as {
        name: string;
      }[]
    ).map((c) => c.name);
    expect(cols).toEqual(["target_tenant_id", "target_user_id"]);

    db.prepare(`DELETE FROM user_identities WHERE tenant_id = 3`).run();
    db.prepare(`DELETE FROM users WHERE tenant_id = 3`).run();
    db.prepare(`DELETE FROM tenant_subscriptions WHERE tenant_id = 3`).run();
    db.prepare(`DELETE FROM system_settings WHERE tenant_id = 3`).run();
    db.prepare(`DELETE FROM tenants WHERE id = 3`).run();
    expect(rows(db).some((r) => r.target_tenant_id === 3)).toBe(false);
  });

  it("is idempotent", () => {
    const db = makeDb();
    V200!.up(db);
    V200!.up(db);
    expect(rows(db)).toHaveLength(6);
  });

  it("skips the back-fill when users is absent", () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE tenants (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, status TEXT)`);
    V200!.up(db);
    expect(columns(db)).toContain("kind");
    expect(rows(db)).toEqual([]);
  });

  it("inserts nothing on a per-tenant platform file (only super admins left in users)", () => {
    const db = makeDb();
    db.exec(`DELETE FROM user_identities; DELETE FROM users WHERE tenant_id IS NOT NULL;`);
    V200!.up(db);
    expect(rows(db)).toEqual([]);
  });

  it("down() drops the table", () => {
    const db = makeDb();
    V200!.up(db);
    V200!.down!(db);
    expect(columns(db)).toEqual([]);
  });

  it("create_db.sql already declares it and seeds the version", () => {
    const db = new Database(":memory:");
    db.exec(CREATE_DB_SQL);
    expect(columns(db)).toContain("target_tenant_id");
    const seeded = db
      .prepare(`SELECT name FROM schema_migrations WHERE version = 200`)
      .get() as { name: string } | undefined;
    expect(seeded?.name).toBe("signin_directory");
  });
});
