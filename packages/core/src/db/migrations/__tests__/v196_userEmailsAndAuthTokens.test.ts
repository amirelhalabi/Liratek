/**
 * Migration v196 — user emails + auth token tables (LIRA-279/281/275/280
 * foundation, docs/plans/todo_plans/SELF_SERVE_SIGNUP_AND_GOOGLE_PLAN.md).
 *
 * Guards:
 *   1. `users.email` / `users.email_verified_at`, unique per shop (partial,
 *      so every user with no email is unaffected).
 *   2. The backfill: each shop's FIRST ADMIN (lowest-id active `admin`) gets
 *      the shop's `contact_email`, verified — and nobody else, and never
 *      overwriting an email already set.
 *   3. The five new tables with their constraints, including the two
 *      cross-database decisions: no FK from a tenant-scoped row to
 *      `email_outbox`, and `sso_handoff_tokens` carrying `target_tenant_id`
 *      rather than a `tenant_id` the split tool would treat as shop data.
 *   4. down() removes all of it, including against a `users` table built
 *      from the real create_db.sql text (the DROP COLUMN rewrite trap).
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS, runMigrations } from "../index.js";

const V196 = MIGRATIONS.find((m) => m.version === 196);

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../../electron-app/create_db.sql"),
  "utf8",
);

/** A pre-v196 shape: tenants (with v195's contact_email), users, outbox. */
function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, contact_email TEXT DEFAULT NULL
    );
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER REFERENCES tenants(id),
      username TEXT,
      password_hash TEXT,
      role TEXT DEFAULT 'staff',
      is_active BOOLEAN DEFAULT 1
    );
    CREATE TABLE email_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      idempotency_key TEXT NOT NULL UNIQUE
    );
  `);
  return db;
}

function columns(db: Database.Database, table: string): string[] {
  return (
    db.prepare(`SELECT name FROM pragma_table_info(?)`).all(table) as {
      name: string;
    }[]
  ).map((c) => c.name);
}

function objectExists(
  db: Database.Database,
  type: "table" | "index",
  name: string,
): boolean {
  return (
    db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?`)
      .get(type, name) !== undefined
  );
}

function foreignKeys(
  db: Database.Database,
  table: string,
): { from: string; table: string; on_delete: string }[] {
  return db
    .prepare(
      `SELECT "from", "table", on_delete FROM pragma_foreign_key_list(?)`,
    )
    .all(table) as { from: string; table: string; on_delete: string }[];
}

function userEmail(
  db: Database.Database,
  id: number,
): { email: string | null; email_verified_at: string | null } {
  return db
    .prepare(`SELECT email, email_verified_at FROM users WHERE id = ?`)
    .get(id) as { email: string | null; email_verified_at: string | null };
}

const NEW_TABLES = [
  "user_invitations",
  "password_reset_tokens",
  "email_verification_tokens",
  "user_identities",
  "sso_handoff_tokens",
];

describe("migration v196 — user emails and auth tokens", () => {
  it("is registered as v196 user_emails_and_auth_tokens", () => {
    expect(V196).toBeDefined();
    expect(V196!.name).toBe("user_emails_and_auth_tokens");
  });

  it("adds users.email + email_verified_at, unique per shop only when set", () => {
    const db = makeDb();
    db.exec(`
      INSERT INTO tenants (id, name, slug) VALUES (1, 'A', 'a'), (2, 'B', 'b');
      INSERT INTO users (id, tenant_id, username, role) VALUES
        (1, 1, 'a1', 'admin'), (2, 1, 'a2', 'staff'), (3, 2, 'b1', 'admin');
    `);
    V196!.up(db);
    expect(columns(db, "users")).toEqual(
      expect.arrayContaining(["email", "email_verified_at"]),
    );
    const set = db.prepare(`UPDATE users SET email = ? WHERE id = ?`);
    set.run("same@example.com", 1);
    // Same address in ANOTHER shop is fine (one person, several shops).
    set.run("same@example.com", 3);
    // Same address twice in ONE shop is not.
    expect(() => set.run("same@example.com", 2)).toThrow(
      /UNIQUE constraint failed: users\.tenant_id, users\.email/,
    );
    // Many users with no email in one shop is fine.
    db.prepare(
      `INSERT INTO users (tenant_id, username, role) VALUES (1, 'a3', 'staff')`,
    ).run();
    db.close();
  });

  it("backfills the first active admin of each shop from contact_email, verified", () => {
    const db = makeDb();
    db.exec(`
      INSERT INTO tenants (id, name, slug, contact_email) VALUES
        (1, 'NoEmail', 'noemail', NULL),
        (2, 'Two', 'two', 'owner2@example.com'),
        (3, 'Three', 'three', 'owner3@example.com'),
        (4, 'Four', 'four', 'owner4@example.com'),
        (5, 'Five', 'five', 'owner5@example.com');
      INSERT INTO users (id, tenant_id, username, role, is_active) VALUES
        (10, 1, 'admin', 'admin', 1),
        -- shop 2: an inactive admin first, then staff, then the real first admin
        (20, 2, 'old', 'admin', 0),
        (21, 2, 'cashier', 'staff', 1),
        (22, 2, 'boss', 'admin', 1),
        (23, 2, 'boss2', 'admin', 1),
        -- shop 3: the first admin already has an email of their own
        (30, 3, 'three', 'admin', 1),
        -- shop 4: another user already holds the contact address
        (40, 4, 'four', 'admin', 1),
        (41, 4, 'helper', 'staff', 1),
        -- shop 5: no active admin at all
        (50, 5, 'staffonly', 'staff', 1);
    `);
    // Pre-existing emails need the column, which up() adds — so seed the
    // "already set" cases through a pre-step that mimics a partial state:
    // add the columns first, then up() must still be safe (guarded).
    db.exec(`ALTER TABLE users ADD COLUMN email TEXT DEFAULT NULL`);
    db.exec(`ALTER TABLE users ADD COLUMN email_verified_at TEXT DEFAULT NULL`);
    db.exec(`UPDATE users SET email = 'mine@example.com' WHERE id = 30`);
    db.exec(`UPDATE users SET email = 'owner4@example.com' WHERE id = 41`);

    V196!.up(db);

    expect(userEmail(db, 10).email).toBeNull();
    expect(userEmail(db, 20).email).toBeNull();
    expect(userEmail(db, 21).email).toBeNull();
    const boss = userEmail(db, 22);
    expect(boss.email).toBe("owner2@example.com");
    expect(boss.email_verified_at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(userEmail(db, 23).email).toBeNull();
    // Never overwritten.
    expect(userEmail(db, 30)).toEqual({
      email: "mine@example.com",
      email_verified_at: null,
    });
    // Not given to the admin when another user in the shop already has it.
    expect(userEmail(db, 40).email).toBeNull();
    expect(userEmail(db, 41).email).toBe("owner4@example.com");
    expect(userEmail(db, 50).email).toBeNull();
    db.close();
  });

  it("lowercases the backfilled address", () => {
    const db = makeDb();
    db.exec(`
      INSERT INTO tenants (id, name, slug, contact_email) VALUES (2, 'Two', 'two', '  Owner@Example.COM ');
      INSERT INTO users (id, tenant_id, username, role) VALUES (5, 2, 'boss', 'admin');
    `);
    V196!.up(db);
    expect(userEmail(db, 5).email).toBe("owner@example.com");
    db.close();
  });

  it("creates the five tables with their columns", () => {
    const db = makeDb();
    V196!.up(db);
    expect(columns(db, "user_invitations").sort()).toEqual(
      [
        "id",
        "tenant_id",
        "email",
        "role",
        "token_hash",
        "invited_by_user_id",
        "expires_at",
        "claimed_at",
        "used_at",
        "used_by_user_id",
        "revoked_at",
        "email_outbox_id",
        "created_at",
        "updated_at",
      ].sort(),
    );
    expect(columns(db, "password_reset_tokens").sort()).toEqual(
      [
        "id",
        "tenant_id",
        "user_id",
        "token_hash",
        "expires_at",
        "used_at",
        "requested_ip_hash",
        "email_outbox_id",
        "created_at",
        "updated_at",
      ].sort(),
    );
    expect(columns(db, "email_verification_tokens").sort()).toEqual(
      [
        "id",
        "tenant_id",
        "user_id",
        "email",
        "token_hash",
        "expires_at",
        "used_at",
        "email_outbox_id",
        "created_at",
        "updated_at",
      ].sort(),
    );
    expect(columns(db, "user_identities").sort()).toEqual(
      [
        "id",
        "user_id",
        "tenant_id",
        "provider",
        "subject",
        "email",
        "created_at",
        "updated_at",
      ].sort(),
    );
    expect(columns(db, "sso_handoff_tokens").sort()).toEqual(
      [
        "id",
        "token_hash",
        "user_id",
        "target_tenant_id",
        "expires_at",
        "used_at",
        "created_at",
        "updated_at",
      ].sort(),
    );
    for (const idx of [
      "idx_users_tenant_email",
      "idx_user_invitations_tenant_email",
      "idx_user_invitations_tenant_created",
      "idx_password_reset_tokens_user_created",
      "idx_email_verification_tokens_user_created",
      "idx_user_identities_user_provider",
    ]) {
      expect(objectExists(db, "index", idx)).toBe(true);
    }
    db.close();
  });

  it("never points a tenant-scoped row at email_outbox, and keeps tenant_id off sso_handoff_tokens", () => {
    const db = makeDb();
    V196!.up(db);
    for (const table of [
      "user_invitations",
      "password_reset_tokens",
      "email_verification_tokens",
    ]) {
      expect(columns(db, table)).toContain("tenant_id");
      expect(foreignKeys(db, table).map((f) => f.table)).not.toContain(
        "email_outbox",
      );
    }
    // Platform-level: a `tenant_id` column would make the split tool and the
    // platform-split guard treat these rows as shop data.
    expect(columns(db, "sso_handoff_tokens")).not.toContain("tenant_id");
    expect(
      foreignKeys(db, "sso_handoff_tokens").map((f) => f.table),
    ).not.toContain("users");
    // Cascades that make deleting a user or a shop leave nothing behind.
    expect(foreignKeys(db, "user_identities")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "user_id",
          table: "users",
          on_delete: "CASCADE",
        }),
      ]),
    );
    expect(foreignKeys(db, "password_reset_tokens")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "user_id",
          table: "users",
          on_delete: "CASCADE",
        }),
      ]),
    );
    expect(foreignKeys(db, "user_invitations")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "tenant_id",
          table: "tenants",
          on_delete: "CASCADE",
        }),
        expect.objectContaining({
          from: "used_by_user_id",
          table: "users",
          on_delete: "SET NULL",
        }),
      ]),
    );
    db.close();
  });

  it("enforces the token and identity constraints", () => {
    const db = makeDb();
    db.exec(`
      INSERT INTO tenants (id, name, slug) VALUES (1, 'A', 'a'), (2, 'B', 'b');
      INSERT INTO users (id, tenant_id, username, role) VALUES
        (1, 1, 'a1', 'admin'), (2, 1, 'a2', 'staff'), (3, 2, 'b1', 'admin');
    `);
    V196!.up(db);
    const invite = db.prepare(
      `INSERT INTO user_invitations (tenant_id, email, role, token_hash, expires_at)
       VALUES (?, ?, ?, ?, '2026-10-10T00:00:00.000Z')`,
    );
    invite.run(1, "x@example.com", "staff", "h1");
    expect(() => invite.run(1, "y@example.com", "staff", "h1")).toThrow(
      /UNIQUE constraint failed: user_invitations\.token_hash/,
    );
    expect(() => invite.run(1, "y@example.com", "super_admin", "h2")).toThrow(
      /CHECK constraint failed/,
    );

    const identity = db.prepare(
      `INSERT INTO user_identities (user_id, tenant_id, provider, subject, email)
       VALUES (?, ?, ?, ?, ?)`,
    );
    identity.run(1, 1, "google", "sub-1", "p@example.com");
    // The same Google account in ANOTHER shop: allowed.
    identity.run(3, 2, "google", "sub-1", "p@example.com");
    // The same Google account on a second user of the SAME shop: refused,
    // or sign-in to that shop would be ambiguous.
    expect(() =>
      identity.run(2, 1, "google", "sub-1", "p@example.com"),
    ).toThrow(/UNIQUE constraint failed/);
    // A second Google account on one user: refused.
    expect(() =>
      identity.run(1, 1, "google", "sub-2", "q@example.com"),
    ).toThrow(/UNIQUE constraint failed/);
    expect(() => identity.run(2, 1, "github", "sub-3", null)).toThrow(
      /CHECK constraint failed/,
    );
    db.close();
  });

  it("up() is idempotent (guarded)", () => {
    const db = makeDb();
    V196!.up(db);
    expect(() => V196!.up(db)).not.toThrow();
    db.close();
  });

  it("down() removes the columns, the index and all five tables", () => {
    const db = makeDb();
    db.exec(`
      INSERT INTO tenants (id, name, slug, contact_email) VALUES (2, 'Two', 'two', 'o@example.com');
      INSERT INTO users (id, tenant_id, username, role) VALUES (5, 2, 'boss', 'admin');
    `);
    V196!.up(db);
    V196!.down!(db);
    expect(columns(db, "users")).not.toContain("email");
    expect(columns(db, "users")).not.toContain("email_verified_at");
    expect(objectExists(db, "index", "idx_users_tenant_email")).toBe(false);
    for (const table of NEW_TABLES) {
      expect(objectExists(db, "table", table)).toBe(false);
    }
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n,
    ).toBe(1);
    db.close();
  });

  it("down() works on a database built from the real create_db.sql", () => {
    const db = new Database(":memory:");
    db.exec(CREATE_DB_SQL);
    runMigrations(db);
    V196!.down!(db);
    expect(columns(db, "users")).not.toContain("email");
    for (const table of NEW_TABLES) {
      expect(objectExists(db, "table", table)).toBe(false);
    }
    db.close();
  });
});
