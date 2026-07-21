/**
 * LIRA-077 — StockAdjustmentRepository.
 *
 * NOTE: written but NOT run by this workstream (W4) — core jest requires the
 * Node-ABI dance (`cd packages/core && npm rebuild better-sqlite3 && npx jest
 * StockAdjustmentRepository ProductRepository.stockAdjustment
 * InventoryService.stockAdjustment && npm run rebuild:native`), which is
 * reserved for W5 per the parallel-workstream plan. The verifier should run
 * that exact command.
 *
 * Covers:
 *  - create() inserts a tenant-scoped row and returns it via findByIdOrFail.
 *  - getByProduct() scopes to one product, most-recent-first, joined to the
 *    acting user's username (LEFT JOIN — null-safe when user_id is null).
 *  - getRecent() spans all products, most-recent-first, respects the limit.
 */

import Database from "better-sqlite3";
import {
  StockAdjustmentRepository,
  resetStockAdjustmentRepository,
} from "../StockAdjustmentRepository.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL
    );

    CREATE TABLE products (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id      INTEGER DEFAULT 1,
      name           TEXT NOT NULL,
      stock_quantity INTEGER DEFAULT 0,
      created_at     TEXT DEFAULT CURRENT_TIMESTAMP
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

  db.prepare(`INSERT INTO users (id, username) VALUES (1, 'amir')`).run();
  db.prepare(
    `INSERT INTO products (id, name, stock_quantity) VALUES (1, 'Widget', 10), (2, 'Gadget', 5)`,
  ).run();

  return db;
}

describe("StockAdjustmentRepository (LIRA-077)", () => {
  let db: Database.Database;
  let repo: StockAdjustmentRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    resetStockAdjustmentRepository();
    repo = new StockAdjustmentRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetStockAdjustmentRepository();
  });

  it("create() writes a row and returns it", () => {
    const row = repo.create({
      product_id: 1,
      delta: 5,
      old_quantity: 10,
      new_quantity: 15,
      reason: "Physical recount",
      user_id: 1,
    });

    expect(row.id).toBeGreaterThan(0);
    expect(row.product_id).toBe(1);
    expect(row.delta).toBe(5);
    expect(row.old_quantity).toBe(10);
    expect(row.new_quantity).toBe(15);
    expect(row.reason).toBe("Physical recount");
    expect(row.user_id).toBe(1);
    expect(row.created_at).toBeTruthy();
  });

  it("create() accepts a null user_id (unattributed adjustment)", () => {
    const row = repo.create({
      product_id: 1,
      delta: -2,
      old_quantity: 10,
      new_quantity: 8,
      reason: "System correction",
      user_id: null,
    });
    expect(row.user_id).toBeNull();
  });

  it("getByProduct() scopes to one product, most recent first, joined to username", () => {
    repo.create({
      product_id: 1,
      delta: 5,
      old_quantity: 10,
      new_quantity: 15,
      reason: "first",
      user_id: 1,
    });
    repo.create({
      product_id: 2,
      delta: -1,
      old_quantity: 5,
      new_quantity: 4,
      reason: "other product",
      user_id: 1,
    });
    repo.create({
      product_id: 1,
      delta: -3,
      old_quantity: 15,
      new_quantity: 12,
      reason: "second",
      user_id: 1,
    });

    const history = repo.getByProduct(1);
    expect(history).toHaveLength(2);
    // Most recent first
    expect(history[0]!.reason).toBe("second");
    expect(history[1]!.reason).toBe("first");
    expect(history.every((h) => h.product_id === 1)).toBe(true);
    expect(history[0]!.username).toBe("amir");
  });

  it("getByProduct() resolves username to null when user_id is null", () => {
    repo.create({
      product_id: 1,
      delta: 1,
      old_quantity: 10,
      new_quantity: 11,
      reason: "unattributed",
      user_id: null,
    });
    const history = repo.getByProduct(1);
    expect(history[0]!.username).toBeNull();
  });

  it("getRecent() spans all products, most recent first, and respects limit", () => {
    repo.create({
      product_id: 1,
      delta: 1,
      old_quantity: 10,
      new_quantity: 11,
      reason: "a",
      user_id: 1,
    });
    repo.create({
      product_id: 2,
      delta: 2,
      old_quantity: 5,
      new_quantity: 7,
      reason: "b",
      user_id: 1,
    });
    repo.create({
      product_id: 1,
      delta: -1,
      old_quantity: 11,
      new_quantity: 10,
      reason: "c",
      user_id: 1,
    });

    const all = repo.getRecent();
    expect(all).toHaveLength(3);
    expect(all[0]!.reason).toBe("c");

    const limited = repo.getRecent(2);
    expect(limited).toHaveLength(2);
    expect(limited[0]!.reason).toBe("c");
    expect(limited[1]!.reason).toBe("b");
  });
});
