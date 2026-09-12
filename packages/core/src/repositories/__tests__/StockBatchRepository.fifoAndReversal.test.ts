/**
 * SUPPLIER_STOCK_INTAKE_PLAN.md — StockBatchRepository FIFO correctness and
 * rule-20 reversal ownership for SUPPLIER_STOCK_INTAKE.
 *
 * Split from SupplierRepository.stockIntake.test.ts (which covers the
 * balance-booking regression proofs) because this file exercises
 * StockBatchRepository's own consume/restore/void mechanics directly,
 * plus TransactionRepository's void path as the reversal owner — a
 * different unit under test, same feature.
 */

import Database from "better-sqlite3";
import {
  StockBatchRepository,
  getStockBatchRepository,
  resetStockBatchRepository,
} from "../StockBatchRepository.js";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository.js";
import {
  getSupplierRepository,
  resetSupplierRepository,
} from "../SupplierRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL
    );
    INSERT INTO users (id, username) VALUES (1, 'admin');

    CREATE TABLE suppliers (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id  INTEGER DEFAULT 1,
      name       TEXT NOT NULL,
      is_active  INTEGER NOT NULL DEFAULT 1,
      is_system  INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO suppliers (id, name) VALUES (1, 'Acme Distributors');

    CREATE TABLE product_suppliers (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id   INTEGER DEFAULT 1,
      name        TEXT NOT NULL,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      is_active   INTEGER NOT NULL DEFAULT 1,
      supplier_id INTEGER,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO product_suppliers (id, name, supplier_id) VALUES (1, 'Acme Distributors', 1);

    CREATE TABLE supplier_ledger (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id    INTEGER DEFAULT 1,
      supplier_id  INTEGER NOT NULL,
      entry_type   TEXT NOT NULL CHECK(entry_type IN ('TOP_UP','SALE_COST','PAYMENT','ADJUSTMENT','SETTLEMENT','CASH_PRIZE','SUPPLIER_PAYS_US','DISCOUNT','STOCK_INTAKE')),
      amount_usd   REAL NOT NULL DEFAULT 0,
      amount_lbp   REAL NOT NULL DEFAULT 0,
      note         TEXT,
      created_by   INTEGER,
      transaction_id INTEGER,
      is_auto      INTEGER NOT NULL DEFAULT 0,
      is_refunded  INTEGER NOT NULL DEFAULT 0,
      refunded_at  DATETIME,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE products (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id          INTEGER DEFAULT 1,
      name               TEXT NOT NULL,
      cost_price_usd     REAL DEFAULT 0,
      stock_quantity     INTEGER DEFAULT 0,
      supplier           TEXT,
      created_at         TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at         TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO products (id, name, stock_quantity, cost_price_usd) VALUES (1, 'Widget', 0, 7);

    CREATE TABLE product_stock_batches (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id           INTEGER,
      product_id          INTEGER NOT NULL,
      supplier_id         INTEGER,
      quantity            INTEGER NOT NULL,
      quantity_remaining  INTEGER NOT NULL,
      unit_cost_usd       DECIMAL(10,2) NOT NULL DEFAULT 0,
      books_debt          INTEGER NOT NULL DEFAULT 0,
      ledger_entry_id     INTEGER,
      transaction_id      INTEGER,
      is_opening          INTEGER NOT NULL DEFAULT 0,
      created_by          INTEGER,
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE maintenance_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      maintenance_id INTEGER NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      changed_by INTEGER,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE maintenance_parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      maintenance_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      unit_price_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      stock_restored INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );



    CREATE TABLE stock_batch_consumptions (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id         INTEGER,
      batch_id          INTEGER NOT NULL,
      sale_item_id      INTEGER,
      custom_service_id INTEGER,
      product_id        INTEGER NOT NULL,
      quantity          INTEGER NOT NULL,
      unit_cost_usd     DECIMAL(10,2) NOT NULL,
      reason            TEXT NOT NULL DEFAULT 'SALE',
      is_restored       INTEGER NOT NULL DEFAULT 0,
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP
    ,
  maintenance_part_id INTEGER REFERENCES maintenance_parts(id) ON DELETE SET NULL
);

    CREATE TABLE sale_items (
      id                        INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id                 INTEGER DEFAULT 1,
      sale_id                   INTEGER NOT NULL,
      product_id                INTEGER NOT NULL,
      quantity                  INTEGER NOT NULL DEFAULT 1,
      sold_price_usd            REAL DEFAULT 0,
      cost_price_snapshot_usd   REAL DEFAULT 0,
      refunded_quantity         INTEGER DEFAULT 0,
      is_refunded               INTEGER DEFAULT 0
    );

    CREATE TABLE custom_services (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id    INTEGER DEFAULT 1,
      description  TEXT NOT NULL DEFAULT 'service',
      product_id   INTEGER,
      status       TEXT DEFAULT 'completed',
      is_refunded  INTEGER DEFAULT 0,
      refunded_at  TEXT,
      created_at   TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE debt_ledger (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id        INTEGER,
      transaction_type TEXT NOT NULL,
      amount_usd       REAL NOT NULL DEFAULT 0,
      amount_lbp       REAL NOT NULL DEFAULT 0,
      transaction_id   INTEGER,
      session_id       INTEGER,
      note             TEXT,
      due_date         TEXT,
      created_by       INTEGER,
      tenant_id        INTEGER DEFAULT 1,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
      is_refunded      INTEGER DEFAULT 0,
      refunded_at      TEXT
    );

    CREATE TABLE transactions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      type          TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table  TEXT,
      source_id     INTEGER,
      user_id       INTEGER NOT NULL DEFAULT 1,
      amount_usd    REAL NOT NULL DEFAULT 0,
      amount_lbp    REAL NOT NULL DEFAULT 0,
      profit_usd    REAL NOT NULL DEFAULT 0,
      profit_lbp    REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id     INTEGER,
      client_name   TEXT,
      client_phone  TEXT,
      reverses_id   INTEGER,
      summary       TEXT,
      metadata_json TEXT,
      device_id     TEXT,
      tenant_id     INTEGER DEFAULT 1,
      created_at    TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id     INTEGER,
      method         TEXT NOT NULL,
      drawer_name    TEXT NOT NULL,
      currency_code  TEXT NOT NULL,
      amount         REAL NOT NULL,
      note           TEXT,
      created_by     INTEGER,
      tenant_id      INTEGER DEFAULT 1,
      created_at     TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id     INTEGER NOT NULL DEFAULT 1,
      drawer_name   TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance       REAL NOT NULL DEFAULT 0,
      updated_at    TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 0);
  `);
  return db;
}

/** Books a real STOCK_INTAKE ledger row + transaction + batch, exactly the
 *  way ProductRepository.bookIntakeAndBatch does — used to set up the
 *  rule-20 reversal tests against a REAL intake transaction id. */
function bookIntake(
  db: Database.Database,
  quantity: number,
  unitCostUsd: number,
): { batchId: number; transactionId: number; ledgerEntryId: number } {
  const booked = getSupplierRepository().recordStockIntake({
    supplier_id: 1,
    product_id: 1,
    product_name: "Widget",
    quantity,
    unit_cost_usd: unitCostUsd,
    created_by: 1,
  });
  const batchId = getStockBatchRepository().createBatch({
    product_id: 1,
    supplier_id: 1,
    quantity,
    unit_cost_usd: unitCostUsd,
    books_debt: true,
    ledger_entry_id: booked.ledgerEntryId,
    transaction_id: booked.transactionId,
    created_by: 1,
  });
  db.prepare(
    `UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = 1`,
  ).run(quantity);
  return {
    batchId,
    transactionId: booked.transactionId,
    ledgerEntryId: booked.ledgerEntryId,
  };
}

describe("StockBatchRepository — FIFO consumption/restoration", () => {
  let db: Database.Database;
  let batchRepo: StockBatchRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetStockBatchRepository();
    resetSupplierRepository();
    resetTransactionRepository();
    batchRepo = getStockBatchRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetStockBatchRepository();
    resetSupplierRepository();
    resetTransactionRepository();
    resetTenantContext();
  });

  // -------------------------------------------------------------------
  // FIFO correctness — two batches at different costs.
  // Pre-fix (before batches existed at all): every sale stamped
  // `cost_price_snapshot_usd` from the product's single, current
  // `cost_price_usd` column — a later re-cost of the SAME product would
  // have retroactively changed the profit of an OLD sale on every read.
  // These assertions (snapshot = 10, then the WEIGHTED cost of a
  // cross-batch draw) fail against a single-cost-column model, which can
  // only ever report one number (whatever `cost_price_usd` is NOW), never
  // a per-sale historical blend.
  // -------------------------------------------------------------------
  it("selling within the first batch stamps that batch's own unit cost", () => {
    batchRepo.createBatch({
      product_id: 1,
      supplier_id: 1,
      quantity: 2,
      unit_cost_usd: 10,
      books_debt: false,
      created_by: 1,
    });
    batchRepo.createBatch({
      product_id: 1,
      supplier_id: 1,
      quantity: 3,
      unit_cost_usd: 12,
      books_debt: false,
      created_by: 1,
    });

    const result = batchRepo.consume(1, 1, {
      reason: "SALE",
      fallbackUnitCostUsd: 999,
    });
    expect(result.weightedUnitCostUsd).toBeCloseTo(10, 2);
    expect(result.uncoveredQuantity).toBe(0);
    expect(result.takes).toHaveLength(1);
  });

  it("selling across both batches stamps the WEIGHTED cost (2@$10 + 1@$12)/3", () => {
    const first = batchRepo.createBatch({
      product_id: 1,
      supplier_id: 1,
      quantity: 2,
      unit_cost_usd: 10,
      books_debt: false,
      created_by: 1,
    });
    const second = batchRepo.createBatch({
      product_id: 1,
      supplier_id: 1,
      quantity: 3,
      unit_cost_usd: 12,
      books_debt: false,
      created_by: 1,
    });

    const result = batchRepo.consume(1, 3, {
      reason: "SALE",
      fallbackUnitCostUsd: 999,
    });
    // 2 units @ $10 + 1 unit @ $12 = $32 / 3 = $10.666...
    expect(result.weightedUnitCostUsd).toBeCloseTo(32 / 3, 4);
    expect(result.uncoveredQuantity).toBe(0);
    expect(result.takes).toEqual(
      expect.arrayContaining([
        { batch_id: first, quantity: 2, unit_cost_usd: 10 },
        { batch_id: second, quantity: 1, unit_cost_usd: 12 },
      ]),
    );

    const secondBatch = db
      .prepare(
        `SELECT quantity_remaining FROM product_stock_batches WHERE id = ?`,
      )
      .get(second) as { quantity_remaining: number };
    expect(secondBatch.quantity_remaining).toBe(2);
  });

  it("a refund returns units to the batch they came from", () => {
    batchRepo.createBatch({
      product_id: 1,
      supplier_id: 1,
      quantity: 2,
      unit_cost_usd: 10,
      books_debt: false,
      created_by: 1,
    });
    const second = batchRepo.createBatch({
      product_id: 1,
      supplier_id: 1,
      quantity: 3,
      unit_cost_usd: 12,
      books_debt: false,
      created_by: 1,
    });
    db.prepare(
      `INSERT INTO sale_items (id, sale_id, product_id, quantity) VALUES (1, 1, 1, 3)`,
    ).run();
    batchRepo.consume(1, 3, {
      saleItemId: 1,
      reason: "SALE",
      fallbackUnitCostUsd: 999,
    });

    // Refund 1 unit — restores newest-consumption-first, i.e. the unit taken
    // from the SECOND batch (the $12 one).
    batchRepo.restoreForSaleItem(1, 1);

    const secondBatch = db
      .prepare(
        `SELECT quantity_remaining FROM product_stock_batches WHERE id = ?`,
      )
      .get(second) as { quantity_remaining: number };
    expect(secondBatch.quantity_remaining).toBe(3); // fully restored (had taken 1, given 1 back)
  });

  // -------------------------------------------------------------------
  // Uncovered-quantity fallback: stock with no batch cover (legacy stock,
  // or an allowOutOfStock oversell) prices at the product's current
  // cost_price_usd and does NOT throw.
  //
  // Pre-fix concern this proves against: a batch-aware consume() that
  // THROWS on insufficient cover would break every legacy sale (products
  // that existed before this feature shipped, with no batch history at
  // all) — this asserts the call returns normally and reports the
  // shortfall via `uncoveredQuantity`/the fallback cost instead.
  // -------------------------------------------------------------------
  it("consuming more than available batch cover does not throw and falls back to the given unit cost", () => {
    batchRepo.createBatch({
      product_id: 1,
      supplier_id: 1,
      quantity: 1,
      unit_cost_usd: 10,
      books_debt: false,
      created_by: 1,
    });

    let result: ReturnType<StockBatchRepository["consume"]>;
    expect(() => {
      result = batchRepo.consume(1, 4, {
        reason: "SALE",
        fallbackUnitCostUsd: 7,
      });
    }).not.toThrow();

    expect(result!.uncoveredQuantity).toBe(3);
    // 1 unit @ $10 (covered) + 3 units @ $7 (fallback) = $31 / 4
    expect(result!.weightedUnitCostUsd).toBeCloseTo(31 / 4, 4);
  });

  it("a product with NO batches at all (fully legacy stock) prices entirely at the fallback and does not throw", () => {
    let result: ReturnType<StockBatchRepository["consume"]>;
    expect(() => {
      result = batchRepo.consume(1, 5, {
        reason: "SALE",
        fallbackUnitCostUsd: 7,
      });
    }).not.toThrow();
    expect(result!.uncoveredQuantity).toBe(5);
    expect(result!.weightedUnitCostUsd).toBeCloseTo(7, 2);
    expect(result!.takes).toHaveLength(0);
  });
});

describe("TransactionRepository — rule 20 reversal owner for SUPPLIER_STOCK_INTAKE", () => {
  let db: Database.Database;
  let txnRepo: TransactionRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetStockBatchRepository();
    resetSupplierRepository();
    resetTransactionRepository();
    txnRepo = new TransactionRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetStockBatchRepository();
    resetSupplierRepository();
    resetTransactionRepository();
    resetTenantContext();
  });

  function ledgerSum(): { usd: number; lbp: number } {
    return db
      .prepare(
        `SELECT COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_lbp), 0) AS lbp
         FROM supplier_ledger WHERE supplier_id = 1 AND is_refunded = 0`,
      )
      .get() as { usd: number; lbp: number };
  }

  // -------------------------------------------------------------------
  // Void an untouched intake — nets the ledger to zero, deletes the
  // batch, restores stock.
  //
  // Pre-fix: SUPPLIER_STOCK_INTAKE did not exist as a reversible type at
  // all (there was no event to reverse), so this whole call would have
  // been unrecognised by `voidTransaction`'s dispatch — no batch deletion,
  // no ledger soft-void, stock left inflated by the intake's quantity.
  // -------------------------------------------------------------------
  it("voiding an untouched intake nets the ledger to 0, deletes the batch, and restores stock", () => {
    const { batchId, transactionId } = bookIntake(db, 10, 5);
    expect(ledgerSum().usd).toBeCloseTo(50, 2);
    const productBefore = db
      .prepare(`SELECT stock_quantity FROM products WHERE id = 1`)
      .get() as { stock_quantity: number };
    expect(productBefore.stock_quantity).toBe(10);

    txnRepo.voidTransaction(transactionId, 1);

    expect(ledgerSum().usd).toBeCloseTo(0, 2);
    expect(ledgerSum().lbp).toBeCloseTo(0, 2);

    const batch = db
      .prepare(`SELECT * FROM product_stock_batches WHERE id = ?`)
      .get(batchId);
    expect(batch).toBeUndefined();

    const productAfter = db
      .prepare(`SELECT stock_quantity FROM products WHERE id = 1`)
      .get() as { stock_quantity: number };
    expect(productAfter.stock_quantity).toBe(0);

    const original = db
      .prepare(`SELECT status FROM transactions WHERE id = ?`)
      .get(transactionId) as { status: string };
    expect(original.status).toBe("VOIDED");
  });

  // -------------------------------------------------------------------
  // Voiding an intake with ANY unit already consumed must be REFUSED —
  // never silently delete a batch a sale's cost_price_snapshot_usd
  // already depends on.
  //
  // Pre-fix: with no reversal owner at all, this would either no-op
  // (leaving a phantom debt with no batch, or nothing) or — had someone
  // naively wired a blanket batch DELETE into the generic void path — it
  // would have silently erased a batch a sale already drew its cost from.
  // This test fails against either: it asserts a THROW and that NOTHING
  // changed.
  // -------------------------------------------------------------------
  it("refuses to void an intake once a unit has been sold, and changes nothing", () => {
    const { batchId, transactionId } = bookIntake(db, 5, 5);
    db.prepare(
      `INSERT INTO sale_items (id, sale_id, product_id, quantity) VALUES (1, 1, 1, 1)`,
    ).run();
    getStockBatchRepository().consume(1, 1, {
      saleItemId: 1,
      reason: "SALE",
      fallbackUnitCostUsd: 5,
    });
    db.prepare(
      `UPDATE products SET stock_quantity = stock_quantity - 1 WHERE id = 1`,
    ).run();

    const ledgerBefore = ledgerSum();
    const stockBefore = (
      db.prepare(`SELECT stock_quantity FROM products WHERE id = 1`).get() as {
        stock_quantity: number;
      }
    ).stock_quantity;

    expect(() => txnRepo.voidTransaction(transactionId, 1)).toThrow(
      /already been sold/i,
    );

    // Nothing changed: the guard throws BEFORE the surrounding
    // this.transaction() commits, so even the "mark VOIDED" write rolls back.
    expect(ledgerSum()).toEqual(ledgerBefore);
    const stockAfter = (
      db.prepare(`SELECT stock_quantity FROM products WHERE id = 1`).get() as {
        stock_quantity: number;
      }
    ).stock_quantity;
    expect(stockAfter).toBe(stockBefore);
    const batch = db
      .prepare(
        `SELECT quantity, quantity_remaining FROM product_stock_batches WHERE id = ?`,
      )
      .get(batchId) as { quantity: number; quantity_remaining: number };
    expect(batch.quantity).toBe(5);
    expect(batch.quantity_remaining).toBe(4);
    const original = db
      .prepare(`SELECT status FROM transactions WHERE id = ?`)
      .get(transactionId) as { status: string };
    expect(original.status).toBe("ACTIVE");
  });

  // -------------------------------------------------------------------
  // Custom-service path: an inventory-backed custom service consumes a
  // batch unit (via its OWN customServiceId-keyed consumption row, not
  // sale_item_id), and voiding the SERVICE (not the intake) returns that
  // unit to the batch.
  //
  // Pre-fix: `stock_batch_consumptions` had no `custom_service_id` column
  // and `restoreForCustomService` did not exist — a custom service that
  // consumed a batch unit could never have that unit returned on void; the
  // batch's `quantity_remaining` would stay short by 1 unit forever. This
  // test's "quantity_remaining back to 5" assertion fails without that
  // wiring.
  // -------------------------------------------------------------------
  it("voiding an inventory-backed custom service restores the batch unit it consumed", () => {
    const { batchId } = bookIntake(db, 5, 5);
    db.prepare(
      `INSERT INTO custom_services (id, description, product_id, status) VALUES (1, 'Screen install', 1, 'completed')`,
    ).run();
    getStockBatchRepository().consume(1, 1, {
      customServiceId: 1,
      reason: "SERVICE",
      fallbackUnitCostUsd: 0,
    });
    db.prepare(
      `UPDATE products SET stock_quantity = stock_quantity - 1 WHERE id = 1`,
    ).run();

    const batchBefore = db
      .prepare(
        `SELECT quantity_remaining FROM product_stock_batches WHERE id = ?`,
      )
      .get(batchId) as { quantity_remaining: number };
    expect(batchBefore.quantity_remaining).toBe(4);

    const serviceTxnId = txnRepo.createTransaction({
      type: "CUSTOM_SERVICE",
      source_table: "custom_services",
      source_id: 1,
      user_id: 1,
      amount_usd: 20,
      amount_lbp: 0,
      summary: "Custom service #1",
      metadata_json: {},
    });

    txnRepo.voidTransaction(serviceTxnId, 1);

    const batchAfter = db
      .prepare(
        `SELECT quantity_remaining FROM product_stock_batches WHERE id = ?`,
      )
      .get(batchId) as { quantity_remaining: number };
    expect(batchAfter.quantity_remaining).toBe(5);

    const product = db
      .prepare(`SELECT stock_quantity FROM products WHERE id = 1`)
      .get() as { stock_quantity: number };
    // 5 intake − 1 consumed + 1 restored (by the void) = 5, net-zero across
    // the whole create→void cycle (rule 20) — NOT 4. The batch's own
    // quantity_remaining is asserted to be back at 5 above; stock_quantity
    // must return to the SAME 5 it was at right after the intake, or the
    // two ledgers (batch vs. live stock) would disagree by exactly the unit
    // this test exists to prove gets restored.
    expect(product.stock_quantity).toBe(5);
  });
});
