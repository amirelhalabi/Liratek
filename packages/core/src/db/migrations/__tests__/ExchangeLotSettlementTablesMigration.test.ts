/**
 * Migration v156 — add_exchange_lot_settlement_tables
 * (EXCHANGE_LOT_SETTLEMENT.md Phase 1 — schema only; Phase 1 shipped without
 * a test file, this closes that gap ahead of Phase 2's engine).
 *
 * Proves:
 *  - up() creates all three tables (`exchange_lots`, `exchange_lot_settlements`,
 *    `exchange_position_adjustments`) plus their indexes.
 *  - up() is idempotent (CREATE TABLE/INDEX IF NOT EXISTS — a second call is
 *    a clean no-op, no thrown error, no duplicated rows).
 *  - down() drops all three tables (children before the parent — the
 *    dependent order matches the migration's own DROP order:
 *    exchange_lot_settlements, exchange_position_adjustments, exchange_lots).
 *  - The composite currency FK — `FOREIGN KEY (tenant_id, currency_code)
 *    REFERENCES currencies(tenant_id, code)`, on BOTH `exchange_lots` and
 *    `exchange_position_adjustments` — genuinely rejects an unknown
 *    (tenant_id, currency_code) pair and accepts a real one (the v154/v155
 *    FK-mismatch trap this migration's own description calls out: a bare
 *    `REFERENCES currencies(code)` would throw "foreign key mismatch" on
 *    every statement, since `currencies` only carries UNIQUE(tenant_id,
 *    code), never a unique index on `code` alone).
 *  - `exchange_lots.source_type` CHECK accepts exactly
 *    ('EXCHANGE_BUY','DRAWER_TOPUP','ADJUSTMENT') and rejects anything else.
 *  - `exchange_lot_settlements.basis_source` CHECK accepts exactly
 *    ('LOT','MARKET') and rejects anything else.
 *  - `exchange_lot_settlements.lot_id` is nullable (the Q6 MARKET-basis
 *    uncovered-oversell slice has no lot).
 *  - A NULL `tenant_id` row bypasses the composite FK (SQLite's standard
 *    composite-FK NULL semantics, matching v154/v155's precedent for
 *    legacy/pre-multi-tenant data).
 *
 * Constructed directly against the migration's up()/down()
 * (`MIGRATIONS.find(...)` pattern, mirrors
 * `PartnersSystemAssociationFkMigration.test.ts`).
 */

import Database from "better-sqlite3";
import { MIGRATIONS } from "../index";

const migration = MIGRATIONS.find((m) => m.version === 156);

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  // better-sqlite3 defaults `foreign_keys` ON for every new connection in
  // this codebase, so the tenants/currencies parent tables must exist
  // before any INSERT against exchange_lots/exchange_position_adjustments
  // is even prepared (mirrors PartnersSystemAssociationFkMigration.test.ts's
  // identical fixture for the identical reason).
  db.exec(`
    CREATE TABLE tenants (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      name   TEXT NOT NULL,
      slug   TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
    INSERT INTO tenants (id, name, slug, status) VALUES (1, 'Default', 'default', 'active');
    INSERT INTO tenants (id, name, slug, status) VALUES (2, 'Second', 'second', 'active');

    CREATE TABLE currencies (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id      INTEGER REFERENCES tenants(id),
      code           TEXT NOT NULL,
      name           TEXT NOT NULL,
      symbol         TEXT NOT NULL DEFAULT '',
      decimal_places INTEGER NOT NULL DEFAULT 2,
      is_active      BOOLEAN DEFAULT 1,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, code)
    );
    INSERT INTO currencies (tenant_id, code, name) VALUES (1, 'EUR', 'Euro');
    INSERT INTO currencies (tenant_id, code, name) VALUES (1, 'USD', 'US Dollar');
  `);
  return db;
}

function tableExists(db: Database.Database, name: string): boolean {
  return (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(name) !== undefined
  );
}

function indexExists(db: Database.Database, name: string): boolean {
  return (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`)
      .get(name) !== undefined
  );
}

describe("Migration v156 — add_exchange_lot_settlement_tables", () => {
  it("is registered at version 156", () => {
    expect(migration).toBeDefined();
    expect(migration!.name).toBe("add_exchange_lot_settlement_tables");
  });

  it("up() creates all three tables and their indexes", () => {
    const db = createTestDb();
    migration!.up(db);

    expect(tableExists(db, "exchange_lots")).toBe(true);
    expect(tableExists(db, "exchange_lot_settlements")).toBe(true);
    expect(tableExists(db, "exchange_position_adjustments")).toBe(true);

    expect(indexExists(db, "idx_exchange_lots_tenant_id")).toBe(true);
    expect(indexExists(db, "idx_exchange_lots_fifo")).toBe(true);
    expect(indexExists(db, "idx_exchange_lot_settlements_tenant_id")).toBe(
      true,
    );
    expect(indexExists(db, "idx_exchange_lot_settlements_lot")).toBe(true);
    expect(indexExists(db, "idx_exchange_lot_settlements_settled_by")).toBe(
      true,
    );
    expect(
      indexExists(db, "idx_exchange_position_adjustments_tenant_id"),
    ).toBe(true);
    expect(indexExists(db, "idx_exchange_position_adjustments_currency")).toBe(
      true,
    );

    db.close();
  });

  it("up() is idempotent — a second call is a clean no-op", () => {
    const db = createTestDb();
    migration!.up(db);

    db.prepare(
      `INSERT INTO exchange_lots (tenant_id, currency_code, source_type, original_qty, remaining_qty, unit_cost_usd, acquired_at)
       VALUES (1, 'EUR', 'EXCHANGE_BUY', 2000, 2000, 1.09, '2026-08-22 10:00:00')`,
    ).run();

    expect(() => migration!.up(db)).not.toThrow();

    // The pre-existing row survives a re-run of up() untouched.
    const rows = db.prepare(`SELECT * FROM exchange_lots`).all();
    expect(rows).toHaveLength(1);

    db.close();
  });

  it("down() drops all three tables", () => {
    const db = createTestDb();
    migration!.up(db);
    expect(tableExists(db, "exchange_lots")).toBe(true);

    migration!.down!(db);

    expect(tableExists(db, "exchange_lots")).toBe(false);
    expect(tableExists(db, "exchange_lot_settlements")).toBe(false);
    expect(tableExists(db, "exchange_position_adjustments")).toBe(false);

    db.close();
  });

  it("down() -> up() round trip is clean", () => {
    const db = createTestDb();
    migration!.up(db);
    migration!.down!(db);
    expect(() => migration!.up(db)).not.toThrow();
    expect(tableExists(db, "exchange_lots")).toBe(true);
    db.close();
  });

  describe("composite currency FK — FOREIGN KEY (tenant_id, currency_code) REFERENCES currencies(tenant_id, code)", () => {
    it("exchange_lots rejects an unknown (tenant, currency) pair and accepts a real one", () => {
      const db = createTestDb();
      migration!.up(db);

      // No 'GBP' row for tenant 1 in `currencies` — must be rejected.
      expect(() =>
        db
          .prepare(
            `INSERT INTO exchange_lots (tenant_id, currency_code, source_type, original_qty, remaining_qty, unit_cost_usd, acquired_at)
             VALUES (1, 'GBP', 'EXCHANGE_BUY', 100, 100, 1.27, '2026-08-22 10:00:00')`,
          )
          .run(),
      ).toThrow(/FOREIGN KEY constraint failed/);

      // A real, seeded (tenant, currency) pair is accepted.
      const ok = db
        .prepare(
          `INSERT INTO exchange_lots (tenant_id, currency_code, source_type, original_qty, remaining_qty, unit_cost_usd, acquired_at)
           VALUES (1, 'EUR', 'EXCHANGE_BUY', 2000, 2000, 1.09, '2026-08-22 10:00:00')`,
        )
        .run();
      expect(ok.changes).toBe(1);

      // A DIFFERENT tenant cannot reference tenant 1's EUR row — proves the
      // FK is genuinely composite, not a bare `currency_code` match.
      expect(() =>
        db
          .prepare(
            `INSERT INTO exchange_lots (tenant_id, currency_code, source_type, original_qty, remaining_qty, unit_cost_usd, acquired_at)
             VALUES (2, 'EUR', 'EXCHANGE_BUY', 100, 100, 1.09, '2026-08-22 10:00:00')`,
          )
          .run(),
      ).toThrow(/FOREIGN KEY constraint failed/);

      // A NULL tenant_id row bypasses the FK entirely (SQLite's standard
      // composite-FK NULL semantics — same precedent as v154/v155).
      const legacyRow = db
        .prepare(
          `INSERT INTO exchange_lots (tenant_id, currency_code, source_type, original_qty, remaining_qty, unit_cost_usd, acquired_at)
           VALUES (NULL, 'TOTALLY_UNSEEDED', 'EXCHANGE_BUY', 1, 1, 1, '2026-08-22 10:00:00')`,
        )
        .run();
      expect(legacyRow.changes).toBe(1);

      expect(db.pragma("foreign_key_check")).toEqual([]);
      db.close();
    });

    it("exchange_position_adjustments rejects an unknown (tenant, currency) pair and accepts a real one", () => {
      const db = createTestDb();
      migration!.up(db);

      expect(() =>
        db
          .prepare(
            `INSERT INTO exchange_position_adjustments (tenant_id, currency_code, qty, unit_cost_usd, created_by)
             VALUES (1, 'GBP', 500, 1.27, 'admin')`,
          )
          .run(),
      ).toThrow(/FOREIGN KEY constraint failed/);

      const ok = db
        .prepare(
          `INSERT INTO exchange_position_adjustments (tenant_id, currency_code, qty, unit_cost_usd, created_by)
           VALUES (1, 'EUR', 500, 1.09, 'admin')`,
        )
        .run();
      expect(ok.changes).toBe(1);

      db.close();
    });
  });

  describe("CHECK constraints", () => {
    it("exchange_lots.source_type rejects a bogus value and accepts the three real ones", () => {
      const db = createTestDb();
      migration!.up(db);

      expect(() =>
        db
          .prepare(
            `INSERT INTO exchange_lots (tenant_id, currency_code, source_type, original_qty, remaining_qty, unit_cost_usd, acquired_at)
             VALUES (1, 'EUR', 'BOGUS', 100, 100, 1.09, '2026-08-22 10:00:00')`,
          )
          .run(),
      ).toThrow(/CHECK constraint failed/);

      for (const sourceType of ["EXCHANGE_BUY", "DRAWER_TOPUP", "ADJUSTMENT"]) {
        const result = db
          .prepare(
            `INSERT INTO exchange_lots (tenant_id, currency_code, source_type, original_qty, remaining_qty, unit_cost_usd, acquired_at)
             VALUES (1, 'EUR', ?, 10, 10, 1.09, '2026-08-22 10:00:00')`,
          )
          .run(sourceType);
        expect(result.changes).toBe(1);
      }

      db.close();
    });

    it("exchange_lot_settlements.basis_source rejects a bogus value and accepts LOT/MARKET, with lot_id nullable for MARKET", () => {
      const db = createTestDb();
      migration!.up(db);

      const lot = db
        .prepare(
          `INSERT INTO exchange_lots (tenant_id, currency_code, source_type, original_qty, remaining_qty, unit_cost_usd, acquired_at)
           VALUES (1, 'EUR', 'EXCHANGE_BUY', 2000, 2000, 1.09, '2026-08-22 10:00:00')`,
        )
        .run();
      const lotId = Number(lot.lastInsertRowid);

      expect(() =>
        db
          .prepare(
            `INSERT INTO exchange_lot_settlements (tenant_id, lot_id, basis_source, settled_by_table, settled_by_id, qty, unit_cost_usd, unit_proceeds_usd, profit_usd)
             VALUES (1, ?, 'BOGUS', 'exchange_transactions', 1, 100, 1.09, 1.12, 3)`,
          )
          .run(lotId),
      ).toThrow(/CHECK constraint failed/);

      const lotSettled = db
        .prepare(
          `INSERT INTO exchange_lot_settlements (tenant_id, lot_id, basis_source, settled_by_table, settled_by_id, qty, unit_cost_usd, unit_proceeds_usd, profit_usd)
           VALUES (1, ?, 'LOT', 'exchange_transactions', 1, 100, 1.09, 1.12, 3)`,
        )
        .run(lotId);
      expect(lotSettled.changes).toBe(1);

      // MARKET basis with lot_id = NULL — the Q6 uncovered-oversell slice.
      const marketSettled = db
        .prepare(
          `INSERT INTO exchange_lot_settlements (tenant_id, lot_id, basis_source, settled_by_table, settled_by_id, qty, unit_cost_usd, unit_proceeds_usd, profit_usd)
           VALUES (1, NULL, 'MARKET', 'exchange_transactions', 1, 50, 1.10, 1.10, 0)`,
        )
        .run();
      expect(marketSettled.changes).toBe(1);

      db.close();
    });
  });
});
