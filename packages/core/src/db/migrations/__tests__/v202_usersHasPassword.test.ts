/**
 * Migration v202 (LIRA-291): `users.has_password INTEGER NOT NULL DEFAULT 1`.
 *
 * Only a user who joined a shop with Google (audit `via = 'invite_google'`)
 * and never set a password afterwards gets 0. "Set a password afterwards" is
 * any of:
 *   - a completed reset link (audit "Password reset by emailed link");
 *   - an admin "Changed user password" (Settings → Users → Set Password);
 *   - a USED `password_reset_tokens` row.
 * Merely SENDING a reset link ("Sent a password reset link") does not set a
 * password, so it does not count. Everyone else keeps the default 1.
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "../index.js";

const V202 = MIGRATIONS.find((m) => m.version === 202);

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../../electron-app/create_db.sql"),
  "utf8",
);

const AT = "2026-10-01T08:00:00.000Z";

function columnInfo(db: Database.Database) {
  return (
    db.prepare(`PRAGMA table_info(users)`).all() as {
      name: string;
      notnull: number;
      dflt_value: string | null;
    }[]
  ).find((c) => c.name === "has_password");
}

function audit(
  db: Database.Database,
  userId: number,
  summary: string,
  metadata: Record<string, unknown> | null,
  tenantId = 2,
) {
  db.prepare(
    `INSERT INTO audit_log (tenant_id, user_id, username, role, action, entity_type, entity_id, summary, metadata)
     VALUES (?, ?, 'x', 'staff', 'update', 'user', ?, ?, ?)`,
  ).run(
    tenantId,
    userId,
    String(userId),
    summary,
    metadata === null ? null : JSON.stringify(metadata),
  );
}

const JOINED = "Joined by email invite with Google as staff";

/** A database at v201: create_db.sql minus the v202 column. */
function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  if (columnInfo(db)) db.exec(`ALTER TABLE users DROP COLUMN has_password`);
  db.exec(`
    INSERT INTO tenants (id, name, slug, status) VALUES (2, 'Corner Tech', 'cornertech', 'active');
    INSERT INTO users (id, tenant_id, username, password_hash, role, is_active) VALUES
      (10, 2, 'googleonly', 'x', 'staff', 1),
      (11, 2, 'resetbylink', 'x', 'staff', 1),
      (12, 2, 'adminset', 'x', 'staff', 1),
      (13, 2, 'usedtoken', 'x', 'staff', 1),
      (14, 2, 'pwinvite', 'x', 'staff', 1),
      (15, 2, 'noaudit', 'x', 'staff', 1),
      (16, 2, 'googleowner', 'x', 'admin', 1),
      (17, 2, 'sentonly', 'x', 'staff', 1);
  `);
  audit(db, 10, JOINED, { via: "invite_google", invitation_id: 1 });

  audit(db, 11, JOINED, { via: "invite_google", invitation_id: 2 });
  audit(db, 11, "Password reset by emailed link", {
    via: "password_reset_link",
    sessions_revoked: 1,
  });

  audit(db, 12, JOINED, { via: "invite_google", invitation_id: 3 });
  audit(db, 12, "Changed user password", null);

  audit(db, 13, JOINED, { via: "invite_google", invitation_id: 4 });
  db.prepare(
    `INSERT INTO password_reset_tokens (tenant_id, user_id, token_hash, expires_at, used_at)
     VALUES (2, 13, 'h13', ?, ?)`,
  ).run(AT, AT);

  audit(db, 14, "Joined by email invite as staff", {
    via: "invite",
    invitation_id: 5,
  });

  audit(db, 16, "Created a shop with Google", {
    self_service: true,
    via: "google",
  });

  audit(db, 17, JOINED, { via: "invite_google", invitation_id: 6 });
  audit(db, 17, "Sent a password reset link", { via: "password_reset_link" });
  db.prepare(
    `INSERT INTO password_reset_tokens (tenant_id, user_id, token_hash, expires_at, used_at)
     VALUES (2, 17, 'h17', ?, NULL)`,
  ).run(AT);
  return db;
}

function flagOf(db: Database.Database, id: number): number {
  return (
    db.prepare(`SELECT has_password FROM users WHERE id = ?`).get(id) as {
      has_password: number;
    }
  ).has_password;
}

describe("v202 — users.has_password", () => {
  it("is registered as the next migration after v201", () => {
    expect(V202?.name).toBe("users_has_password");
    expect(MIGRATIONS[MIGRATIONS.length - 1]?.version).toBe(202);
  });

  it("adds the column NOT NULL DEFAULT 1", () => {
    const db = makeDb();
    V202!.up(db);
    const col = columnInfo(db);
    expect(col).toBeDefined();
    expect(col!.notnull).toBe(1);
    expect(col!.dflt_value).toBe("1");
  });

  it("marks a Google-joined user with no later password as 0", () => {
    const db = makeDb();
    V202!.up(db);
    expect(flagOf(db, 10)).toBe(0);
    // Only SENDING a link (never used) does not give them a password.
    expect(flagOf(db, 17)).toBe(0);
  });

  it("keeps 1 for a Google-joined user who later set a password", () => {
    const db = makeDb();
    V202!.up(db);
    expect(flagOf(db, 11)).toBe(1); // reset by link
    expect(flagOf(db, 12)).toBe(1); // admin "Changed user password"
    expect(flagOf(db, 13)).toBe(1); // a used reset token
  });

  it("keeps 1 for everyone else", () => {
    const db = makeDb();
    V202!.up(db);
    expect(flagOf(db, 14)).toBe(1); // password invite
    expect(flagOf(db, 15)).toBe(1); // no audit row
    expect(flagOf(db, 16)).toBe(1); // shop created with Google
  });

  it("is idempotent", () => {
    const db = makeDb();
    V202!.up(db);
    V202!.up(db);
    expect(flagOf(db, 10)).toBe(0);
    expect(flagOf(db, 11)).toBe(1);
  });

  it("skips when users is absent", () => {
    const db = new Database(":memory:");
    expect(() => V202!.up(db)).not.toThrow();
  });

  it("down() drops the column", () => {
    const db = makeDb();
    V202!.up(db);
    V202!.down!(db);
    expect(columnInfo(db)).toBeUndefined();
  });

  it("create_db.sql has the column and seeds version 202", () => {
    const db = new Database(":memory:");
    db.exec(CREATE_DB_SQL);
    const col = columnInfo(db);
    expect(col?.notnull).toBe(1);
    expect(col?.dflt_value).toBe("1");
    const row = db
      .prepare(`SELECT name FROM schema_migrations WHERE version = 202`)
      .get() as { name: string } | undefined;
    expect(row?.name).toBe("users_has_password");
  });
});
