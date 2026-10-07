/**
 * Migration v195 — email invites for sign-up (LIRA-267).
 *
 * Guards the schema the invite/outbox repositories depend on:
 *   1. `tenants.contact_email` exists after up().
 *   2. The partial unique index enforces one shop per email, while still
 *      allowing any number of shops with no email (NULL).
 *   3. `signup_invitations` and `email_outbox` exist with the columns in
 *      specs/267-email-invite-signup/data-model.md, including the CHECKs.
 *   4. down() removes every one of those again.
 *
 * Runs the migration against a hand-built pre-v195 `tenants` table (house
 * pattern — see tenantsStatusProvisioning.test.ts), not the full chain, so a
 * failure here names this migration and nothing else.
 */

import Database from "better-sqlite3";
import { MIGRATIONS } from "../index.js";

const V195 = MIGRATIONS.find((m) => m.version === 195);

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  db.exec(`
    CREATE TABLE tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      contact_name TEXT,
      contact_phone TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO tenants (id, name, slug) VALUES (1, 'Default', 'default');
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

describe("migration v195 — email invites", () => {
  it("is registered as v195 email_invites", () => {
    expect(V195).toBeDefined();
    expect(V195!.name).toBe("email_invites");
  });

  it("adds tenants.contact_email, with the existing row left NULL", () => {
    const db = makeDb();
    V195!.up(db);
    expect(columns(db, "tenants")).toContain("contact_email");
    const row = db
      .prepare(`SELECT contact_email FROM tenants WHERE id = 1`)
      .get() as { contact_email: string | null };
    expect(row.contact_email).toBeNull();
    db.close();
  });

  it("enforces one shop per email, but allows many shops with no email", () => {
    const db = makeDb();
    V195!.up(db);
    const insert = db.prepare(
      `INSERT INTO tenants (name, slug, contact_email) VALUES (?, ?, ?)`,
    );
    insert.run("A", "a", "owner@example.com");
    expect(() => insert.run("B", "b", "owner@example.com")).toThrow(
      /UNIQUE constraint failed: tenants\.contact_email/,
    );
    insert.run("C", "c", null);
    insert.run("D", "d", null);
    const nulls = db
      .prepare(`SELECT COUNT(*) AS n FROM tenants WHERE contact_email IS NULL`)
      .get() as { n: number };
    expect(nulls.n).toBe(3); // Default + C + D
    db.close();
  });

  it("creates email_outbox and signup_invitations with the data-model columns", () => {
    const db = makeDb();
    V195!.up(db);

    expect(columns(db, "email_outbox").sort()).toEqual(
      [
        "id",
        "idempotency_key",
        "template",
        "to_email",
        "data_json",
        "status",
        "attempts",
        "next_attempt_at",
        "give_up_at",
        "locked_at",
        "last_error",
        "provider_message_id",
        "sent_at",
        "created_at",
        "updated_at",
      ].sort(),
    );
    expect(columns(db, "signup_invitations").sort()).toEqual(
      [
        "id",
        "email",
        "shop_name_hint",
        "token_hash",
        "source",
        "invited_by_user_id",
        "expires_at",
        "claimed_at",
        "used_at",
        "used_by_tenant_id",
        "revoked_at",
        "email_outbox_id",
        "created_at",
        "updated_at",
      ].sort(),
    );

    for (const idx of [
      "idx_tenants_contact_email",
      "idx_signup_invitations_email_created",
      "idx_signup_invitations_source_created",
      "idx_email_outbox_status_next_attempt",
    ]) {
      expect(objectExists(db, "index", idx)).toBe(true);
    }

    // CHECK constraints.
    expect(() =>
      db
        .prepare(
          `INSERT INTO signup_invitations (email, token_hash, source, expires_at)
           VALUES ('x@example.com', 'h1', 'bogus', '2026-10-10T00:00:00.000Z')`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      db
        .prepare(
          `INSERT INTO email_outbox (idempotency_key, template, to_email, data_json, status, next_attempt_at, give_up_at)
           VALUES ('k1', 't', 'x@example.com', '{}', 'delivered', '2026-10-07T00:00:00.000Z', '2026-10-10T00:00:00.000Z')`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed/);

    // invited_by_user_id is nullable (self-serve requests have no inviter),
    // and token_hash is unique.
    const insertInvite = db.prepare(
      `INSERT INTO signup_invitations (email, token_hash, source, invited_by_user_id, expires_at)
       VALUES (?, ?, ?, ?, '2026-10-10T00:00:00.000Z')`,
    );
    insertInvite.run("self@example.com", "h2", "self", null);
    expect(() =>
      insertInvite.run("other@example.com", "h2", "admin", 7),
    ).toThrow(/UNIQUE constraint failed: signup_invitations\.token_hash/);
    db.close();
  });

  it("up() is idempotent (guarded)", () => {
    const db = makeDb();
    V195!.up(db);
    expect(() => V195!.up(db)).not.toThrow();
    db.close();
  });

  it("down() removes the column, the index and both tables", () => {
    const db = makeDb();
    db.prepare(
      `INSERT INTO tenants (name, slug) VALUES ('Second', 'second')`,
    ).run();
    V195!.up(db);
    db.prepare(`UPDATE tenants SET contact_email = 'a@b.co' WHERE id = 2`).run();
    V195!.down!(db);

    expect(columns(db, "tenants")).not.toContain("contact_email");
    expect(objectExists(db, "index", "idx_tenants_contact_email")).toBe(false);
    expect(objectExists(db, "table", "signup_invitations")).toBe(false);
    expect(objectExists(db, "table", "email_outbox")).toBe(false);
    // Existing tenants survive the rollback.
    const n = db.prepare(`SELECT COUNT(*) AS n FROM tenants`).get() as {
      n: number;
    };
    expect(n.n).toBe(2);
    db.close();
  });
});
