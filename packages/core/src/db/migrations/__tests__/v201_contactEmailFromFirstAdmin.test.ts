/**
 * Migration v201 (LIRA-290, owner decision 2026-10-08): "one shop per owner
 * email" must also see shops created before sign-up emails existed. Their
 * `tenants.contact_email` is NULL while the owner's address sits on the
 * shop's FIRST ADMIN (`users.email`, confirmed). The back-fill copies that
 * confirmed address (lowercased) into a NULL `contact_email`.
 *
 * Never overwrites; skips an unconfirmed address; uses only the FIRST admin
 * (lowest-id ACTIVE role='admin', UserRepository.FIRST_ADMIN_WHERE); and
 * skips an address another shop already holds as its contact email
 * (`idx_tenants_contact_email` is unique) — lowest shop id wins.
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "../index.js";

const V201 = MIGRATIONS.find((m) => m.version === 201);

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../../electron-app/create_db.sql"),
  "utf8",
);

const AT = "2026-09-01T08:00:00.000Z";

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  db.exec(`
    INSERT INTO tenants (id, name, slug, status, contact_email) VALUES
      (2, 'Corner Tech', 'cornertech', 'active', NULL),
      (3, 'Test', 'test', 'active', NULL),
      (4, 'Unconfirmed', 'unconfirmed', 'active', NULL),
      (5, 'Has email', 'hasemail', 'active', 'kept@shop.com'),
      (6, 'Second admin', 'secondadmin', 'active', NULL),
      (7, 'Inactive first', 'inactivefirst', 'active', NULL),
      (8, 'Clash', 'clash', 'active', NULL),
      (9, 'Staff only', 'staffonly', 'active', NULL);
    INSERT INTO users (id, tenant_id, username, password_hash, role, is_active, email, email_verified_at) VALUES
      (20, 2, 'boss', 'x', 'admin', 1, 'owner@gmail.com', '${AT}'),
      (21, 2, 'cashier', 'x', 'staff', 1, 'staff2@gmail.com', '${AT}'),
      (30, 3, 'boss3', 'x', 'admin', 1, 'owner@gmail.com', '${AT}'),
      (40, 4, 'boss4', 'x', 'admin', 1, 'unconfirmed@gmail.com', NULL),
      (50, 5, 'boss5', 'x', 'admin', 1, 'other@gmail.com', '${AT}'),
      (60, 6, 'boss6', 'x', 'admin', 1, NULL, NULL),
      (61, 6, 'admin6', 'x', 'admin', 1, 'second@gmail.com', '${AT}'),
      (70, 7, 'gone7', 'x', 'admin', 0, 'gone@gmail.com', '${AT}'),
      (71, 7, 'boss7', 'x', 'admin', 1, 'boss7@gmail.com', '${AT}'),
      (80, 8, 'boss8', 'x', 'admin', 1, 'kept@shop.com', '${AT}'),
      (90, 9, 'staff9', 'x', 'staff', 1, 'staff9@gmail.com', '${AT}');
  `);
  return db;
}

function contactOf(db: Database.Database, id: number): string | null {
  return (
    db.prepare(`SELECT contact_email FROM tenants WHERE id = ?`).get(id) as {
      contact_email: string | null;
    }
  ).contact_email;
}

describe("v201 — tenants.contact_email from the first admin's confirmed email", () => {
  it("is registered", () => {
    expect(V201?.name).toBe("tenants_contact_email_from_first_admin");
  });

  it("sets a NULL contact email to the first admin's confirmed email", () => {
    const db = makeDb();
    V201!.up!(db);
    expect(contactOf(db, 2)).toBe("owner@gmail.com");
    // The first ACTIVE admin: an inactive lower-id admin does not count.
    expect(contactOf(db, 7)).toBe("boss7@gmail.com");
  });

  it("skips an address another shop already holds — the lowest shop id wins", () => {
    const db = makeDb();
    V201!.up!(db);
    // cornertech (2) and test (3) share the owner's Gmail.
    expect(contactOf(db, 3)).toBeNull();
    // Already shop 5's contact email.
    expect(contactOf(db, 8)).toBeNull();
  });

  it("skips an unconfirmed email, a first admin with no email, and staff emails", () => {
    const db = makeDb();
    V201!.up!(db);
    expect(contactOf(db, 4)).toBeNull();
    // Only the FIRST admin counts, even when a later admin has a confirmed email.
    expect(contactOf(db, 6)).toBeNull();
    expect(contactOf(db, 9)).toBeNull();
  });

  it("never overwrites an existing contact email", () => {
    const db = makeDb();
    V201!.up!(db);
    expect(contactOf(db, 5)).toBe("kept@shop.com");
  });

  it("lowercases and trims, and is idempotent", () => {
    const db = makeDb();
    db.exec(`UPDATE users SET email = ' Boss7@Gmail.COM ' WHERE id = 71`);
    V201!.up!(db);
    V201!.up!(db);
    expect(contactOf(db, 7)).toBe("boss7@gmail.com");
  });

  it("create_db.sql seeds version 201", () => {
    const db = new Database(":memory:");
    db.exec(CREATE_DB_SQL);
    const row = db
      .prepare(`SELECT name FROM schema_migrations WHERE version = 201`)
      .get() as { name: string } | undefined;
    expect(row?.name).toBe("tenants_contact_email_from_first_admin");
  });
});
