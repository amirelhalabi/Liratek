/**
 * LIRA-077 — InventoryService.adjustStock / adjustStockDelta /
 * getStockAdjustments.
 *
 * NOTE: written but NOT run by this workstream (W4) — core jest requires the
 * Node-ABI dance (`cd packages/core && npm rebuild better-sqlite3 && npx jest
 * StockAdjustmentRepository ProductRepository.stockAdjustment
 * InventoryService.stockAdjustment && npm run rebuild:native`), reserved for
 * W5. The verifier should run that exact command.
 *
 * Failing-first proof (rule 17) for "reason is required": temporarily
 * comment out the `if (!reason?.trim()) { return {...} }` guard in
 * InventoryService.adjustStock/adjustStockDelta and re-run — the "rejects an
 * empty/whitespace reason and writes nothing" tests below fail because the
 * call falls through to the repository and actually changes stock_quantity.
 * Restore afterward.
 */

import Database from "better-sqlite3";
import { ProductRepository } from "../../repositories/ProductRepository.js";
import {
  StockAdjustmentRepository,
  resetStockAdjustmentRepository,
} from "../../repositories/StockAdjustmentRepository.js";
import { InventoryService } from "../InventoryService.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL
    );
    INSERT INTO users (id, username) VALUES (1, 'amir');

    CREATE TABLE products (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id          INTEGER DEFAULT 1,
      barcode            TEXT,
      name               TEXT NOT NULL,
      item_type          TEXT NOT NULL DEFAULT 'Physical',
      category           TEXT,
      description        TEXT,
      cost_price_usd     REAL DEFAULT 0,
      selling_price_usd  REAL DEFAULT 0,
      min_stock_level    INTEGER DEFAULT 5,
      stock_quantity     INTEGER DEFAULT 0,
      imei               TEXT,
      color              TEXT,
      image_url          TEXT,
      warranty_expiry    TEXT,
      status             TEXT DEFAULT 'Active',
      is_active          INTEGER DEFAULT 1,
      is_deleted         INTEGER DEFAULT 0,
      supplier           TEXT,
      created_at         TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at         TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE stock_adjustments (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id    INTEGER DEFAULT 1,
      product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      delta        INTEGER NOT NULL,
      old_quantity INTEGER NOT NULL,
      new_quantity INTEGER NOT NULL,
      reason       TEXT NOT NULL,
      user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at   TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.prepare(
    `INSERT INTO products (id, name, stock_quantity) VALUES (1, 'Widget', 10), (2, 'Gadget', 5)`,
  ).run();

  return db;
}

function getStockQuantity(db: Database.Database, id: number): number {
  const row = db
    .prepare(`SELECT stock_quantity FROM products WHERE id = ?`)
    .get(id) as { stock_quantity: number };
  return row.stock_quantity;
}

function countAdjustmentRows(db: Database.Database): number {
  return (
    db.prepare(`SELECT COUNT(*) as c FROM stock_adjustments`).get() as {
      c: number;
    }
  ).c;
}

describe("InventoryService — stock adjustment (LIRA-077)", () => {
  let db: Database.Database;
  let service: InventoryService;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    resetStockAdjustmentRepository();
    service = new InventoryService(
      new ProductRepository(),
      new StockAdjustmentRepository(),
    );
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetStockAdjustmentRepository();
  });

  describe("adjustStock (absolute set)", () => {
    it("succeeds with a reason and writes the audit row", () => {
      const result = service.adjustStock(1, 20, "Physical recount", 1);
      expect(result).toEqual({ success: true });
      expect(getStockQuantity(db, 1)).toBe(20);
      expect(countAdjustmentRows(db)).toBe(1);
    });

    it("rejects an empty/whitespace reason and writes nothing", () => {
      const empty = service.adjustStock(1, 20, "", 1);
      expect(empty.success).toBe(false);
      expect(empty.error).toMatch(/reason/i);

      const whitespace = service.adjustStock(1, 20, "   ", 1);
      expect(whitespace.success).toBe(false);

      expect(getStockQuantity(db, 1)).toBe(10);
      expect(countAdjustmentRows(db)).toBe(0);
    });

    it("rejects a negative quantity", () => {
      const result = service.adjustStock(1, -5, "bad", 1);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/negative/i);
      expect(getStockQuantity(db, 1)).toBe(10);
    });

    it("rejects a missing product id", () => {
      const result = service.adjustStock(0, 5, "bad", 1);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/product id/i);
    });

    it("reports failure for a non-existent product without writing an audit row", () => {
      const result = service.adjustStock(999, 5, "no-op", 1);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/i);
      expect(countAdjustmentRows(db)).toBe(0);
    });

    it("trims the reason before persisting and passes the userId through", () => {
      // FK enforcement is ON in the jest runtime, so the attributed user must
      // exist — a nonexistent user_id correctly rolls back the whole
      // adjustment transaction (verified 2026-07-19: "FOREIGN KEY constraint
      // failed" surfaces as {success:false} from the service).
      db.prepare(`INSERT INTO users (id, username) VALUES (7, 'clerk7')`).run();

      const result = service.adjustStock(1, 20, "  Physical recount  ", 7);
      expect(result).toEqual({ success: true });
      const row = db
        .prepare(
          `SELECT reason, user_id FROM stock_adjustments WHERE product_id = 1`,
        )
        .get() as { reason: string; user_id: number };
      expect(row.reason).toBe("Physical recount");
      expect(row.user_id).toBe(7);
    });
  });

  describe("adjustStockDelta", () => {
    it("succeeds with a reason and writes the audit row", () => {
      const result = service.adjustStockDelta(1, -3, "Damaged units", 1);
      expect(result).toEqual({ success: true });
      expect(getStockQuantity(db, 1)).toBe(7);
      expect(countAdjustmentRows(db)).toBe(1);
    });

    it("rejects an empty reason and writes nothing", () => {
      const result = service.adjustStockDelta(1, -3, "", 1);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/reason/i);
      expect(getStockQuantity(db, 1)).toBe(10);
      expect(countAdjustmentRows(db)).toBe(0);
    });

    it("allows a negative resulting quantity (manual reconciliation is not blocked here)", () => {
      const result = service.adjustStockDelta(1, -50, "big correction", 1);
      expect(result.success).toBe(true);
      expect(getStockQuantity(db, 1)).toBe(-40);
    });
  });

  describe("getStockAdjustments", () => {
    it("scopes to one product when productId is given", () => {
      service.adjustStock(1, 20, "a", 1);
      service.adjustStockDelta(2, -1, "b", 1);

      const history = service.getStockAdjustments(1);
      expect(history).toHaveLength(1);
      expect(history[0]!.product_id).toBe(1);
    });

    it("returns the most recent across all products when productId is omitted", () => {
      service.adjustStock(1, 20, "a", 1);
      service.adjustStockDelta(2, -1, "b", 1);

      const recent = service.getStockAdjustments();
      expect(recent).toHaveLength(2);
    });
  });
});
