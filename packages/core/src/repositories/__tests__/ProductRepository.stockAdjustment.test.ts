/**
 * LIRA-077 — ProductRepository.adjustStock / adjustStockDelta write the
 * stock_adjustments audit row in the SAME db transaction as the
 * stock_quantity UPDATE (rule 13/20 discipline).
 *
 * NOTE: written but NOT run by this workstream (W4) — core jest requires the
 * Node-ABI dance (`cd packages/core && npm rebuild better-sqlite3 && npx jest
 * StockAdjustmentRepository ProductRepository.stockAdjustment
 * InventoryService.stockAdjustment && npm run rebuild:native`), reserved for
 * W5. The verifier should run that exact command.
 *
 * Failing-first proof for the atomicity test below (rule 17): temporarily
 * comment out the `getStockAdjustmentRepository().create(...)` call inside
 * ProductRepository.adjustStock/adjustStockDelta (packages/core/src/
 * repositories/ProductRepository.ts) — leaving the quantity UPDATE itself
 * untouched — then re-run. "writes the audit row" assertions fail (no row
 * exists); if instead you move the audit write OUTSIDE `this.transaction()`
 * (still present, just uncommitted-together), the "rolls back... on audit
 * failure" test fails because the quantity change survives the simulated
 * audit-write throw. Restore afterward.
 */

import Database from "better-sqlite3";
import { ProductRepository } from "../ProductRepository.js";
import {
  getStockAdjustmentRepository,
  resetStockAdjustmentRepository,
} from "../StockAdjustmentRepository.js";

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
    `INSERT INTO products (id, name, stock_quantity) VALUES (1, 'Widget', 10)`,
  ).run();

  return db;
}

function getStockQuantity(db: Database.Database, id: number): number {
  const row = db
    .prepare(`SELECT stock_quantity FROM products WHERE id = ?`)
    .get(id) as { stock_quantity: number };
  return row.stock_quantity;
}

function getAdjustmentRows(
  db: Database.Database,
  productId: number,
): Array<{ delta: number; old_quantity: number; new_quantity: number }> {
  return db
    .prepare(
      `SELECT delta, old_quantity, new_quantity FROM stock_adjustments WHERE product_id = ? ORDER BY id ASC`,
    )
    .all(productId) as Array<{
    delta: number;
    old_quantity: number;
    new_quantity: number;
  }>;
}

describe("ProductRepository — stock adjustment audit trail (LIRA-077)", () => {
  let db: Database.Database;
  let repo: ProductRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    resetStockAdjustmentRepository();
    repo = new ProductRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetStockAdjustmentRepository();
  });

  it("adjustStock (absolute set) updates stock_quantity and writes a matching audit row", () => {
    const changed = repo.adjustStock(1, 25, "Physical recount", 1);
    expect(changed).toBe(true);
    expect(getStockQuantity(db, 1)).toBe(25);

    const rows = getAdjustmentRows(db, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ delta: 15, old_quantity: 10, new_quantity: 25 });
  });

  it("adjustStockDelta increments stock_quantity and writes a matching audit row", () => {
    const changed = repo.adjustStockDelta(1, -4, "Damaged units", 1);
    expect(changed).toBe(true);
    expect(getStockQuantity(db, 1)).toBe(6);

    const rows = getAdjustmentRows(db, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ delta: -4, old_quantity: 10, new_quantity: 6 });
  });

  it("returns false and writes nothing for a non-existent product", () => {
    const changed = repo.adjustStock(999, 5, "no-op", 1);
    expect(changed).toBe(false);
    expect(getAdjustmentRows(db, 999)).toHaveLength(0);
  });

  it("accepts a null userId (unattributed adjustment) and records it as such", () => {
    repo.adjustStock(1, 3, "system reconciliation", null);
    const row = db
      .prepare(`SELECT user_id FROM stock_adjustments WHERE product_id = 1`)
      .get() as { user_id: number | null };
    expect(row.user_id).toBeNull();
  });

  it("rolls back the stock_quantity UPDATE if the audit-row insert fails (same-transaction atomicity, rule 13/20)", () => {
    const before = getStockQuantity(db, 1);
    const auditRepo = getStockAdjustmentRepository();
    const spy = jest.spyOn(auditRepo, "create").mockImplementation(() => {
      throw new Error("simulated audit-write failure");
    });

    expect(() =>
      repo.adjustStock(1, before + 50, "should roll back", 1),
    ).toThrow();
    // The quantity UPDATE must NOT have survived — same transaction as the
    // audit write, so a mid-failure leaves BOTH un-committed.
    expect(getStockQuantity(db, 1)).toBe(before);
    expect(getAdjustmentRows(db, 1)).toHaveLength(0);

    spy.mockRestore();
  });

  it("rolls back adjustStockDelta the same way on a simulated audit failure", () => {
    const before = getStockQuantity(db, 1);
    const auditRepo = getStockAdjustmentRepository();
    const spy = jest.spyOn(auditRepo, "create").mockImplementation(() => {
      throw new Error("simulated audit-write failure");
    });

    expect(() => repo.adjustStockDelta(1, -7, "should roll back", 1)).toThrow();
    expect(getStockQuantity(db, 1)).toBe(before);
    expect(getAdjustmentRows(db, 1)).toHaveLength(0);

    spy.mockRestore();
  });
});
