/**
 * Migration v187 — widens `tenants.status`'s CHECK constraint to add
 * 'provisioning' (Phase C, PRODUCTION_DATABASE_AND_HOSTING_PLAN.md § 12.2).
 *
 * SQLite cannot ALTER a CHECK constraint in place, so this is a full table
 * rebuild (house pattern — see v158's note). The properties that matter:
 *
 *   1. Before the migration, 'provisioning' is REJECTED (proves the test
 *      fixture reproduces the real pre-migration constraint, not a fixture
 *      that already happens to accept it).
 *   2. After up(), 'provisioning' is accepted and every existing row/column
 *      survives untouched.
 *   3. AUTOINCREMENT keeps working across the rebuild (a fresh insert gets
 *      an id larger than any that ever existed, not a reused one).
 *   4. down() narrows the CHECK back; with no 'provisioning' row present it
 *      round-trips cleanly, and with one present it fails loudly rather than
 *      silently guessing a replacement status.
 */

import Database from "better-sqlite3";
import { MIGRATIONS } from "../index.js";

const V187 = MIGRATIONS.find((m) => m.version === 187)!;

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  // better-sqlite3 in this codebase defaults `foreign_keys` to ON for every
  // new connection (see PartnersSystemAssociationFkMigration.test.ts's note);
  // production always runs migrations through `runMigrations()`, which sets
  // `foreign_keys = OFF` for the whole batch specifically so a rebuild's
  // `DROP TABLE` doesn't trip a child table's reference mid-migration —
  // matched here so up()/down() are exercised under the same bracket they
  // actually run inside.
  db.pragma("foreign_keys = OFF");
  db.exec(`
    CREATE TABLE tenants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
        contact_name TEXT,
        contact_phone TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    -- A child table so the rebuild is proven not to break existing FK
    -- references naming "tenants" as parent.
    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id),
      name TEXT
    );
    INSERT INTO tenants (id, name, slug, status, contact_name, contact_phone, notes)
      VALUES (1, 'Default', 'default', 'active', 'Alice', '555-1234', 'seed note');
    INSERT INTO clients (tenant_id, name) VALUES (1, 'Bob');
  `);
  return db;
}

describe("migration v187 — tenants.status allows 'provisioning'", () => {
  it("the fixture reproduces the REAL pre-migration constraint (sanity check)", () => {
    const db = makeDb();
    expect(() =>
      db
        .prepare(
          `INSERT INTO tenants (name, slug, status) VALUES ('X', 'x', 'provisioning')`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed/i);
    db.close();
  });

  it("up() accepts 'provisioning' and leaves existing rows/columns untouched", () => {
    const db = makeDb();
    V187.up(db);

    const before = db.prepare(`SELECT * FROM tenants WHERE id = 1`).get() as {
      name: string;
      slug: string;
      status: string;
      contact_name: string;
      contact_phone: string;
      notes: string;
    };
    expect(before.name).toBe("Default");
    expect(before.slug).toBe("default");
    expect(before.status).toBe("active");
    expect(before.contact_name).toBe("Alice");
    expect(before.contact_phone).toBe("555-1234");
    expect(before.notes).toBe("seed note");

    expect(() =>
      db
        .prepare(
          `INSERT INTO tenants (id, name, slug, status) VALUES (2, 'Y', 'y', 'provisioning')`,
        )
        .run(),
    ).not.toThrow();

    const still409 = db.prepare(`SELECT * FROM clients WHERE tenant_id = 1`).get();
    expect(still409).toBeTruthy();

    // Every OTHER status value must still be rejected — this widens the
    // set, it does not remove the CHECK entirely.
    expect(() =>
      db
        .prepare(`INSERT INTO tenants (name, slug, status) VALUES ('Z', 'z', 'bogus')`)
        .run(),
    ).toThrow(/CHECK constraint failed/i);

    db.close();
  });

  it("AUTOINCREMENT survives the rebuild — no id reuse", () => {
    const db = makeDb();
    V187.up(db);

    db.prepare(`INSERT INTO tenants (name, slug, status) VALUES ('Y', 'y', 'provisioning')`).run();
    const maxId = (
      db.prepare(`SELECT MAX(id) AS m FROM tenants`).get() as { m: number }
    ).m;
    expect(maxId).toBeGreaterThan(1);

    db.prepare(`DELETE FROM tenants WHERE id = ?`).run(maxId);
    db.prepare(`INSERT INTO tenants (name, slug, status) VALUES ('Z', 'z', 'active')`).run();
    const newMaxId = (
      db.prepare(`SELECT MAX(id) AS m FROM tenants`).get() as { m: number }
    ).m;
    // A reused id would be `maxId` again — AUTOINCREMENT must have moved past it.
    expect(newMaxId).toBeGreaterThan(maxId);

    db.close();
  });

  it("up() is a no-op (skip-guarded) when the CHECK already allows 'provisioning'", () => {
    const db = makeDb();
    V187.up(db);
    expect(() => V187.up(db)).not.toThrow();
    // The child row must still be there — a second rebuild must not have
    // dropped/lost anything.
    const client = db.prepare(`SELECT * FROM clients WHERE tenant_id = 1`).get();
    expect(client).toBeTruthy();
    db.close();
  });

  it("down() narrows the CHECK back when no 'provisioning' row exists", () => {
    const db = makeDb();
    V187.up(db);
    V187.down!(db);

    const row = db.prepare(`SELECT * FROM tenants WHERE id = 1`).get() as {
      status: string;
    };
    expect(row.status).toBe("active");
    expect(() =>
      db
        .prepare(`INSERT INTO tenants (name, slug, status) VALUES ('X', 'x', 'provisioning')`)
        .run(),
    ).toThrow(/CHECK constraint failed/i);
    db.close();
  });

  it("down() FAILS LOUDLY rather than silently guessing when a 'provisioning' row exists", () => {
    const db = makeDb();
    V187.up(db);
    db.prepare(`INSERT INTO tenants (name, slug, status) VALUES ('Prov', 'prov', 'provisioning')`).run();

    expect(() => V187.down!(db)).toThrow();
    db.close();
  });
});
