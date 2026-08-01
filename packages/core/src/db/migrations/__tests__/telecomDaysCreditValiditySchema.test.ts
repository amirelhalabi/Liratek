/**
 * Migration v140 — add_telecom_days_credit_validity_schema (LIRA-090 Phase 1).
 *
 * Covers TELECOM_DAYS_VALIDITY_PLAN.md §7 "Phase 1 — Schema":
 *  - mobile_service_items gains nullable days_cost_lbp/sell_days_lbp/
 *    sell_credit_lbp (defaultless ALTER — existing rows stay NULL).
 *  - carrier_lines gains is_primary (default 0) + a partial unique index
 *    enforcing at most one primary line per (tenant, carrier).
 *  - carrier_line_movements is created with the expected columns.
 *  - the telecom_credit_sell_price_lbp setting is seeded per tenant
 *    (default 100000), without clobbering an existing value.
 *  - up() is idempotent; down() rolls everything back cleanly (round-trip).
 */

import Database from "better-sqlite3";
import { MIGRATIONS } from "../index";

function getMigration(version: number) {
  const migration = MIGRATIONS.find((m) => m.version === version);
  if (!migration) {
    throw new Error(`Migration v${version} not found`);
  }
  if (!migration.down) {
    throw new Error(`Migration v${version} has no down()`);
  }
  return migration as Required<typeof migration>;
}

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  db.exec(`
    CREATE TABLE tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    );
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER
    );
    CREATE TABLE mobile_service_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      provider TEXT NOT NULL,
      category TEXT NOT NULL,
      subcategory TEXT NOT NULL,
      label TEXT NOT NULL,
      cost_lbp REAL NOT NULL DEFAULT 0,
      sell_lbp REAL NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      validity_days INTEGER,
      credits REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, provider, category, subcategory, label)
    );
    CREATE TABLE carrier_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      carrier TEXT NOT NULL CHECK(carrier IN ('alfa', 'mtc')),
      phone_number TEXT NOT NULL,
      label TEXT,
      credits REAL NOT NULL DEFAULT 0,
      validity_expires_at TEXT,
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE system_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      key_name TEXT NOT NULL,
      value TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, key_name)
    );
    INSERT INTO tenants (id, name) VALUES (1, 'Default');
  `);
  return db;
}

function tableColumns(db: Database.Database, table: string): string[] {
  return (
    db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
    }>
  ).map((c) => c.name);
}

function tableExists(db: Database.Database, table: string): boolean {
  return (
    db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      )
      .get(table) !== undefined
  );
}

describe("Migration v140 — add_telecom_days_credit_validity_schema", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  describe("(a) mobile_service_items split columns", () => {
    it("adds nullable days_cost_lbp/sell_days_lbp/sell_credit_lbp columns", () => {
      getMigration(140).up(db);
      const cols = tableColumns(db, "mobile_service_items");
      expect(cols).toEqual(
        expect.arrayContaining([
          "days_cost_lbp",
          "sell_days_lbp",
          "sell_credit_lbp",
        ]),
      );
    });

    it("leaves existing rows NULL on the new columns (no default backfill)", () => {
      db.prepare(
        `INSERT INTO mobile_service_items (provider, category, subcategory, label, cost_lbp, sell_lbp)
         VALUES ('iPick', 'mtc', 'Prepaid', '77', 7600000, 0)`,
      ).run();

      getMigration(140).up(db);

      const row = db
        .prepare(
          `SELECT days_cost_lbp, sell_days_lbp, sell_credit_lbp FROM mobile_service_items WHERE label = '77'`,
        )
        .get() as {
        days_cost_lbp: number | null;
        sell_days_lbp: number | null;
        sell_credit_lbp: number | null;
      };
      expect(row.days_cost_lbp).toBeNull();
      expect(row.sell_days_lbp).toBeNull();
      expect(row.sell_credit_lbp).toBeNull();
    });

    it("accepts a fully-split row (the 77$ cart worked example)", () => {
      getMigration(140).up(db);

      expect(() =>
        db
          .prepare(
            `INSERT INTO mobile_service_items
               (provider, category, subcategory, label, cost_lbp, sell_lbp, days_cost_lbp, sell_days_lbp, sell_credit_lbp, credits)
             VALUES ('iPick', 'mtc', 'Prepaid', '77', 7600000, 0, 1162000, 1500000, 100000, 77)`,
          )
          .run(),
      ).not.toThrow();
    });
  });

  describe("(b) carrier_lines.is_primary + partial unique index", () => {
    it("adds is_primary defaulting to 0", () => {
      getMigration(140).up(db);
      db.prepare(
        `INSERT INTO carrier_lines (tenant_id, carrier, phone_number) VALUES (1, 'mtc', '71000000')`,
      ).run();
      const row = db
        .prepare(`SELECT is_primary FROM carrier_lines WHERE phone_number = '71000000'`)
        .get() as { is_primary: number };
      expect(row.is_primary).toBe(0);
    });

    it("allows exactly one primary line per (tenant, carrier)", () => {
      getMigration(140).up(db);
      expect(() =>
        db
          .prepare(
            `INSERT INTO carrier_lines (tenant_id, carrier, phone_number, is_primary) VALUES (1, 'mtc', '71000001', 1)`,
          )
          .run(),
      ).not.toThrow();
    });

    it("rejects a second primary line for the same (tenant, carrier)", () => {
      getMigration(140).up(db);
      db.prepare(
        `INSERT INTO carrier_lines (tenant_id, carrier, phone_number, is_primary) VALUES (1, 'mtc', '71000001', 1)`,
      ).run();

      expect(() =>
        db
          .prepare(
            `INSERT INTO carrier_lines (tenant_id, carrier, phone_number, is_primary) VALUES (1, 'mtc', '71000002', 1)`,
          )
          .run(),
      ).toThrow(/UNIQUE constraint failed/);
    });

    it("allows a second primary line for a DIFFERENT carrier in the same tenant", () => {
      getMigration(140).up(db);
      db.prepare(
        `INSERT INTO carrier_lines (tenant_id, carrier, phone_number, is_primary) VALUES (1, 'mtc', '71000001', 1)`,
      ).run();

      expect(() =>
        db
          .prepare(
            `INSERT INTO carrier_lines (tenant_id, carrier, phone_number, is_primary) VALUES (1, 'alfa', '76000001', 1)`,
          )
          .run(),
      ).not.toThrow();
    });

    it("allows multiple non-primary lines for the same (tenant, carrier)", () => {
      getMigration(140).up(db);
      db.prepare(
        `INSERT INTO carrier_lines (tenant_id, carrier, phone_number, is_primary) VALUES (1, 'mtc', '71000001', 0)`,
      ).run();

      expect(() =>
        db
          .prepare(
            `INSERT INTO carrier_lines (tenant_id, carrier, phone_number, is_primary) VALUES (1, 'mtc', '71000002', 0)`,
          )
          .run(),
      ).not.toThrow();
    });
  });

  describe("(c) carrier_line_movements table", () => {
    it("creates the table with the expected columns", () => {
      getMigration(140).up(db);
      expect(tableExists(db, "carrier_line_movements")).toBe(true);
      const cols = tableColumns(db, "carrier_line_movements");
      expect(cols).toEqual(
        expect.arrayContaining([
          "id",
          "tenant_id",
          "carrier_line_id",
          "transaction_id",
          "credits_delta",
          "validity_days_delta",
          "reason",
          "is_reversed",
          "created_at",
          "updated_at",
        ]),
      );
    });

    it("requires reason and defaults is_reversed to 0", () => {
      getMigration(140).up(db);
      db.prepare(
        `INSERT INTO carrier_lines (id, tenant_id, carrier, phone_number) VALUES (1, 1, 'mtc', '71000000')`,
      ).run();

      db.prepare(
        `INSERT INTO carrier_line_movements (tenant_id, carrier_line_id, credits_delta, validity_days_delta, reason)
         VALUES (1, 1, 73, 0, 'ONLY_DAYS_RETURN')`,
      ).run();

      const row = db
        .prepare(`SELECT credits_delta, validity_days_delta, is_reversed FROM carrier_line_movements WHERE carrier_line_id = 1`)
        .get() as {
        credits_delta: number;
        validity_days_delta: number;
        is_reversed: number;
      };
      expect(row.credits_delta).toBe(73);
      expect(row.is_reversed).toBe(0);

      expect(() =>
        db
          .prepare(
            `INSERT INTO carrier_line_movements (tenant_id, carrier_line_id, credits_delta, validity_days_delta) VALUES (1, 1, 1, 0)`,
          )
          .run(),
      ).toThrow(/NOT NULL constraint failed/);
    });

    it("allows a nullable transaction_id (self-charge has no transaction row)", () => {
      getMigration(140).up(db);
      db.prepare(
        `INSERT INTO carrier_lines (id, tenant_id, carrier, phone_number) VALUES (1, 1, 'mtc', '71000000')`,
      ).run();

      expect(() =>
        db
          .prepare(
            `INSERT INTO carrier_line_movements (tenant_id, carrier_line_id, transaction_id, credits_delta, validity_days_delta, reason)
             VALUES (1, 1, NULL, 77, 30, 'SELF_CHARGE')`,
          )
          .run(),
      ).not.toThrow();
    });
  });

  describe("(d) telecom_credit_sell_price_lbp setting", () => {
    it("seeds 100000 for every existing tenant", () => {
      db.prepare(`INSERT INTO tenants (id, name) VALUES (2, 'Second Shop')`).run();

      getMigration(140).up(db);

      const rows = db
        .prepare(
          `SELECT tenant_id, value FROM system_settings WHERE key_name = 'telecom_credit_sell_price_lbp' ORDER BY tenant_id`,
        )
        .all() as Array<{ tenant_id: number; value: string }>;
      expect(rows).toEqual([
        { tenant_id: 1, value: "100000" },
        { tenant_id: 2, value: "100000" },
      ]);
    });

    it("does not clobber an existing value (INSERT OR IGNORE)", () => {
      db.prepare(
        `INSERT INTO system_settings (tenant_id, key_name, value) VALUES (1, 'telecom_credit_sell_price_lbp', '120000')`,
      ).run();

      getMigration(140).up(db);

      const row = db
        .prepare(
          `SELECT value FROM system_settings WHERE tenant_id = 1 AND key_name = 'telecom_credit_sell_price_lbp'`,
        )
        .get() as { value: string };
      expect(row.value).toBe("120000");
    });
  });

  it("up() is idempotent — running twice does not throw", () => {
    getMigration(140).up(db);
    expect(() => getMigration(140).up(db)).not.toThrow();
  });

  it("down() rolls everything back cleanly (round-trip)", () => {
    getMigration(140).up(db);
    expect(tableExists(db, "carrier_line_movements")).toBe(true);
    expect(tableColumns(db, "mobile_service_items")).toEqual(
      expect.arrayContaining([
        "days_cost_lbp",
        "sell_days_lbp",
        "sell_credit_lbp",
      ]),
    );
    expect(tableColumns(db, "carrier_lines")).toContain("is_primary");

    getMigration(140).down(db);

    expect(tableExists(db, "carrier_line_movements")).toBe(false);
    expect(tableColumns(db, "mobile_service_items")).not.toEqual(
      expect.arrayContaining([
        "days_cost_lbp",
        "sell_days_lbp",
        "sell_credit_lbp",
      ]),
    );
    expect(tableColumns(db, "carrier_lines")).not.toContain("is_primary");
    expect(
      db
        .prepare(
          `SELECT * FROM system_settings WHERE key_name = 'telecom_credit_sell_price_lbp'`,
        )
        .get(),
    ).toBeUndefined();

    // The partial unique index must be gone too — inserting two primaries
    // for the same carrier must no longer be rejected by it.
    db.prepare(
      `INSERT INTO carrier_lines (tenant_id, carrier, phone_number) VALUES (1, 'mtc', '71000001')`,
    ).run();
    db.prepare(
      `INSERT INTO carrier_lines (tenant_id, carrier, phone_number) VALUES (1, 'mtc', '71000002')`,
    ).run();
  });

  it("up() -> down() -> up() round-trips cleanly (re-migration after rollback)", () => {
    getMigration(140).up(db);
    getMigration(140).down(db);
    expect(() => getMigration(140).up(db)).not.toThrow();
    expect(tableExists(db, "carrier_line_movements")).toBe(true);
  });
});
