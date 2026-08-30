/**
 * Migration v158 — add_custom_services_partner_mode_and_fulfillment
 * (D4.1 — schema only; nothing reads/writes these columns yet).
 *
 * Table inventory touched by up()/down() (TEST-SCHEMA TRAP check): both
 * methods only ever prepare against `sqlite_master` (table-existence guard)
 * and `PRAGMA table_info(custom_services)` (column-existence guard) before
 * ALTERing `custom_services` itself. No other table is referenced — the
 * in-memory test DB below only needs `custom_services`.
 *
 * Proves:
 *  - up() adds partner_mode, fulfillment_status, fulfilled_at — all
 *    nullable, existing rows read NULL (unchanged behaviour).
 *  - partner_mode CHECK accepts exactly ('FOR', 'VIA') and rejects a bogus
 *    value; a NULL value passes the CHECK (SQLite's NULL-is-not-a-violation
 *    rule — same precedent as v83's financial_services.partner_mode).
 *  - fulfillment_status CHECK accepts exactly
 *    ('ORDERED','ISSUED','RECEIVED','DELIVERED'), rejects a bogus value
 *    (including 'CANCELLED' — deliberately not a valid value), and NULL
 *    passes.
 *  - fulfilled_at accepts an arbitrary TEXT timestamp and NULL.
 *  - up() is idempotent (column-existence guards — a second call is a
 *    clean no-op, no thrown error, no data loss).
 *  - up() on a bare DB with NO custom_services table does not throw
 *    (sqlite_master guard, v152/v157 house pattern).
 *  - down() drops all three columns; down() on a bare DB without
 *    custom_services does not throw.
 *  - down() -> up() round trip is clean.
 *
 * Constructed directly against the migration's up()/down()
 * (`MIGRATIONS.find(...)` pattern, mirrors
 * ProductImeiUnitsAndWarrantyMigration.test.ts).
 */

import Database from "better-sqlite3";
import { MIGRATIONS } from "../index";

const migration = MIGRATIONS.find((m) => m.version === 158);

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE custom_services (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id     INTEGER,
      description   TEXT NOT NULL,
      cost_usd      DECIMAL(10, 2) NOT NULL DEFAULT 0,
      cost_lbp      DECIMAL(15, 2) NOT NULL DEFAULT 0,
      price_usd     DECIMAL(10, 2) NOT NULL DEFAULT 0,
      price_lbp     DECIMAL(15, 2) NOT NULL DEFAULT 0,
      is_refunded   INTEGER DEFAULT 0,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO custom_services (id, tenant_id, description, price_usd, cost_usd)
    VALUES (1, 1, 'Existing pre-migration row', 10, 4);
  `);
  return db;
}

function tableExists(db: Database.Database, name: string): boolean {
  return (
    db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
      )
      .get(name) !== undefined
  );
}

function columnExists(
  db: Database.Database,
  table: string,
  column: string,
): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  return cols.some((c) => c.name === column);
}

describe("Migration v158 — add_custom_services_partner_mode_and_fulfillment", () => {
  it("is registered at version 158", () => {
    expect(migration).toBeDefined();
    expect(migration!.name).toBe(
      "add_custom_services_partner_mode_and_fulfillment",
    );
  });

  it("up() adds partner_mode, fulfillment_status, fulfilled_at — existing rows read NULL", () => {
    const db = createTestDb();
    migration!.up(db);

    expect(columnExists(db, "custom_services", "partner_mode")).toBe(true);
    expect(columnExists(db, "custom_services", "fulfillment_status")).toBe(
      true,
    );
    expect(columnExists(db, "custom_services", "fulfilled_at")).toBe(true);

    const row = db
      .prepare(
        `SELECT partner_mode, fulfillment_status, fulfilled_at FROM custom_services WHERE id = 1`,
      )
      .get() as {
      partner_mode: string | null;
      fulfillment_status: string | null;
      fulfilled_at: string | null;
    };
    expect(row.partner_mode).toBeNull();
    expect(row.fulfillment_status).toBeNull();
    expect(row.fulfilled_at).toBeNull();

    db.close();
  });

  it("up() is idempotent — a second call is a clean no-op and preserves data", () => {
    const db = createTestDb();
    migration!.up(db);

    db.prepare(
      `UPDATE custom_services SET partner_mode = 'VIA' WHERE id = 1`,
    ).run();

    expect(() => migration!.up(db)).not.toThrow();

    const row = db
      .prepare(`SELECT partner_mode FROM custom_services WHERE id = 1`)
      .get() as { partner_mode: string | null };
    expect(row.partner_mode).toBe("VIA");

    db.close();
  });

  it("up() on a bare DB with no custom_services table does not throw, and down() is a clean no-op after it", () => {
    const db = new Database(":memory:");

    expect(() => migration!.up(db)).not.toThrow();
    expect(tableExists(db, "custom_services")).toBe(false);

    expect(() => migration!.down!(db)).not.toThrow();

    db.close();
  });

  describe("partner_mode CHECK", () => {
    it("accepts exactly ('FOR', 'VIA'), rejects a bogus value, and NULL passes", () => {
      const db = createTestDb();
      migration!.up(db);

      for (const mode of ["FOR", "VIA"]) {
        const result = db
          .prepare(
            `INSERT INTO custom_services (description, partner_mode) VALUES (?, ?)`,
          )
          .run(`service-${mode}`, mode);
        expect(result.changes).toBe(1);
      }

      expect(() =>
        db
          .prepare(
            `INSERT INTO custom_services (description, partner_mode) VALUES ('bogus', 'BOGUS')`,
          )
          .run(),
      ).toThrow(/CHECK constraint failed/);

      const nullModeResult = db
        .prepare(
          `INSERT INTO custom_services (description, partner_mode) VALUES ('no-mode', NULL)`,
        )
        .run();
      expect(nullModeResult.changes).toBe(1);

      db.close();
    });
  });

  describe("fulfillment_status CHECK", () => {
    it("accepts exactly ('ORDERED','ISSUED','RECEIVED','DELIVERED'), rejects 'CANCELLED' and other bogus values, and NULL passes", () => {
      const db = createTestDb();
      migration!.up(db);

      for (const status of ["ORDERED", "ISSUED", "RECEIVED", "DELIVERED"]) {
        const result = db
          .prepare(
            `INSERT INTO custom_services (description, fulfillment_status) VALUES (?, ?)`,
          )
          .run(`service-${status}`, status);
        expect(result.changes).toBe(1);
      }

      // 'CANCELLED' is deliberately NOT a valid value — cancellation is
      // derived from is_refunded instead.
      for (const bogus of ["CANCELLED", "BOGUS"]) {
        expect(() =>
          db
            .prepare(
              `INSERT INTO custom_services (description, fulfillment_status) VALUES (?, ?)`,
            )
            .run("bad", bogus),
        ).toThrow(/CHECK constraint failed/);
      }

      const nullStatusResult = db
        .prepare(
          `INSERT INTO custom_services (description, fulfillment_status) VALUES ('no-status', NULL)`,
        )
        .run();
      expect(nullStatusResult.changes).toBe(1);

      db.close();
    });
  });

  it("fulfilled_at accepts an arbitrary TEXT timestamp and NULL", () => {
    const db = createTestDb();
    migration!.up(db);

    const stamped = db
      .prepare(
        `INSERT INTO custom_services (description, fulfilled_at) VALUES ('stamped', '2026-08-29T12:00:00.000Z')`,
      )
      .run();
    expect(stamped.changes).toBe(1);

    const row = db
      .prepare(
        `SELECT fulfilled_at FROM custom_services WHERE description = 'stamped'`,
      )
      .get() as { fulfilled_at: string };
    expect(row.fulfilled_at).toBe("2026-08-29T12:00:00.000Z");

    db.close();
  });

  it("down() drops all three columns", () => {
    const db = createTestDb();
    migration!.up(db);
    migration!.down!(db);

    expect(columnExists(db, "custom_services", "partner_mode")).toBe(false);
    expect(columnExists(db, "custom_services", "fulfillment_status")).toBe(
      false,
    );
    expect(columnExists(db, "custom_services", "fulfilled_at")).toBe(false);

    // The pre-existing row and its original columns survive the round trip.
    const row = db
      .prepare(`SELECT description FROM custom_services WHERE id = 1`)
      .get() as { description: string };
    expect(row.description).toBe("Existing pre-migration row");

    db.close();
  });

  it("down() -> up() round trip is clean", () => {
    const db = createTestDb();
    migration!.up(db);
    migration!.down!(db);
    expect(() => migration!.up(db)).not.toThrow();

    expect(columnExists(db, "custom_services", "partner_mode")).toBe(true);
    expect(columnExists(db, "custom_services", "fulfillment_status")).toBe(
      true,
    );
    expect(columnExists(db, "custom_services", "fulfilled_at")).toBe(true);

    db.close();
  });
});
