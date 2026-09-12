/**
 * LIRA-176 phase 8a — MaintenanceRepository parts lifecycle: stock/FIFO
 * netting through a full pay-then-refund cycle, the double-restore guard,
 * `parts: undefined` semantics, the parts-edit money lock, the syncParts
 * reconciliation matrix, and the attach-time cost snapshot.
 *
 * Harness mirrors CustomServiceRepository.stock.test.ts (closest analogue —
 * same stock-link-and-restore shape) and MaintenanceRepository
 * .amountEditGate.test.ts (maintenance schema + money-lock predicate), using
 * the `globalThis.__LIRATEK_TEST_DB__` hook (StockBatchRepository
 * .fifoAndReversal.test.ts's pattern) since this file needs THREE real
 * singletons (MaintenanceRepository/Service, TransactionRepository,
 * StockBatchRepository) wired against the SAME in-memory db.
 *
 * Rule 15: every assertion is a snapshot-before/compare-after DELTA, never an
 * absolute row-position read.
 *
 * Rule 17 — six proofs in this file are failing-first. Each documents the
 * EXACT one-line bug reintroduced, the command run, and the observed failure
 * before the fix was restored (recorded in the PR/agent report, not just
 * asserted from reading the diff).
 */

import Database from "better-sqlite3";
import {
  MaintenanceRepository,
  MAINTENANCE_PARTS_EDIT_BLOCKED_ERROR,
  type MaintenancePartInput,
} from "../MaintenanceRepository";
import { MaintenanceService } from "../../services/MaintenanceService";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import {
  getStockBatchRepository,
  resetStockBatchRepository,
} from "../StockBatchRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      username TEXT NOT NULL,
      role TEXT DEFAULT 'admin'
    );
    INSERT INTO users (id, tenant_id, username, role) VALUES (1, 1, 'admin', 'admin');

    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      whatsapp_opt_in INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      name TEXT NOT NULL,
      cost_price_usd REAL DEFAULT 0,
      selling_price_usd REAL DEFAULT 0,
      stock_quantity INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE product_stock_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      product_id INTEGER NOT NULL,
      supplier_id INTEGER,
      quantity INTEGER NOT NULL,
      quantity_remaining INTEGER NOT NULL,
      unit_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      books_debt INTEGER NOT NULL DEFAULT 0,
      ledger_entry_id INTEGER,
      transaction_id INTEGER,
      is_opening INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE maintenance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      client_id INTEGER,
      client_name TEXT,
      device_name TEXT NOT NULL,
      issue_description TEXT,
      cost_usd DECIMAL(10, 2) DEFAULT 0,
      price_usd DECIMAL(10, 2) DEFAULT 0,
      cost_lbp DECIMAL(15, 2) DEFAULT 0,
      price_lbp DECIMAL(15, 2) DEFAULT 0,
      discount_usd DECIMAL(10, 2) DEFAULT 0,
      final_amount_usd DECIMAL(10, 2) DEFAULT 0,
      final_amount_lbp DECIMAL(15, 2) DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      paid_usd DECIMAL(10, 2) DEFAULT 0,
      paid_lbp DECIMAL(15, 2) DEFAULT 0,
      exchange_rate DECIMAL(15, 2),
      status TEXT DEFAULT 'Received',
      paid_by TEXT DEFAULT 'CASH',
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      edited_by TEXT DEFAULT NULL,
      edited_at TEXT DEFAULT NULL,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT DEFAULT NULL,
      parts_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      parts_price_usd DECIMAL(10,2) NOT NULL DEFAULT 0
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

    CREATE TABLE stock_batch_consumptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      batch_id INTEGER NOT NULL,
      sale_item_id INTEGER,
      custom_service_id INTEGER,
      maintenance_part_id INTEGER REFERENCES maintenance_parts(id) ON DELETE SET NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      unit_cost_usd DECIMAL(10,2) NOT NULL,
      reason TEXT NOT NULL DEFAULT 'SALE',
      is_restored INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT,
      source_id INTEGER,
      user_id INTEGER NOT NULL DEFAULT 1,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      reverses_id INTEGER,
      summary TEXT,
      metadata_json TEXT,
      device_id TEXT,
      transaction_time DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      transaction_id INTEGER,
      session_id INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER NOT NULL DEFAULT 1,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'General', 'USD', 500);
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'General', 'LBP', 20000000);

    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      client_id INTEGER,
      transaction_type TEXT,
      amount_usd REAL,
      amount_lbp REAL,
      transaction_id INTEGER,
      session_id INTEGER,
      note TEXT,
      created_by INTEGER,
      covered_usd REAL DEFAULT 0,
      covered_lbp REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      due_date DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      refunded_at TEXT DEFAULT NULL
    );
  `);
  return db;
}

function seedProduct(
  db: Database.Database,
  opts: { name: string; costUsd: number; stock: number },
): number {
  const res = db
    .prepare(
      `INSERT INTO products (tenant_id, name, cost_price_usd, selling_price_usd, stock_quantity)
       VALUES (1, ?, ?, ?, ?)`,
    )
    .run(opts.name, opts.costUsd, opts.costUsd * 2, opts.stock);
  const productId = Number(res.lastInsertRowid);
  // A real FIFO batch backing the product's stock so `consume()` resolves a
  // real weighted cost (not the fallback) — the realistic shape for these
  // tests' cost assertions.
  db.prepare(
    `INSERT INTO product_stock_batches
       (tenant_id, product_id, quantity, quantity_remaining, unit_cost_usd, books_debt, is_opening)
     VALUES (1, ?, ?, ?, ?, 0, 1)`,
  ).run(productId, opts.stock, opts.stock, opts.costUsd);
  return productId;
}

function stockOf(db: Database.Database, productId: number): number {
  return (
    db
      .prepare(`SELECT stock_quantity FROM products WHERE id = ?`)
      .get(productId) as { stock_quantity: number }
  ).stock_quantity;
}

function batchRemaining(db: Database.Database, productId: number): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(quantity_remaining), 0) AS r FROM product_stock_batches WHERE product_id = ?`,
    )
    .get(productId) as { r: number };
  return row.r;
}

function drawerBalance(
  db: Database.Database,
  drawer: string,
  currency: string,
): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE tenant_id = 1 AND drawer_name = ? AND currency_code = ?`,
    )
    .get(drawer, currency) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

function profitSumForJob(
  db: Database.Database,
  jobId: number,
): { usd: number; lbp: number } {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(profit_usd),0) AS usd, COALESCE(SUM(profit_lbp),0) AS lbp
       FROM transactions WHERE source_table = 'maintenance' AND source_id = ?`,
    )
    .get(jobId) as { usd: number; lbp: number };
  return row;
}

function partsOf(db: Database.Database, jobId: number) {
  return db
    .prepare(
      `SELECT * FROM maintenance_parts WHERE maintenance_id = ? ORDER BY id ASC`,
    )
    .all(jobId) as {
    id: number;
    product_id: number;
    quantity: number;
    unit_cost_usd: number;
    unit_price_usd: number;
    stock_restored: number;
  }[];
}

describe("MaintenanceRepository — parts lifecycle (LIRA-176 phase 8a)", () => {
  let db: Database.Database;
  let repo: MaintenanceRepository;
  let service: MaintenanceService;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetTransactionRepository();
    resetStockBatchRepository();
    repo = new MaintenanceRepository();
    service = new MaintenanceService(repo);
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
    resetStockBatchRepository();
    resetTenantContext();
  });

  // ---------------------------------------------------------------------
  // 1. Stock netting — pay then refund a two-part job through the generic
  //    TransactionRepository.refundTransaction path.
  // ---------------------------------------------------------------------
  it("1. two-part job, delivered+paid, then refunded via the generic path: stock, batches, drawer, and profit all net back to their pre-job values", () => {
    const productA = seedProduct(db, { name: "Screen", costUsd: 5, stock: 10 });
    const productB = seedProduct(db, { name: "Battery", costUsd: 3, stock: 5 });

    const beforeStockA = stockOf(db, productA);
    const beforeStockB = stockOf(db, productB);
    const beforeBatchA = batchRemaining(db, productA);
    const beforeBatchB = batchRemaining(db, productB);
    const beforeDrawerUsd = drawerBalance(db, "General", "USD");

    const parts: MaintenancePartInput[] = [
      { product_id: productA, quantity: 2, unit_price_usd: 10 },
      { product_id: productB, quantity: 1, unit_price_usd: 6 },
    ];

    const res = service.saveJob({
      device_name: "iPhone 13",
      currency: "USD",
      cost_usd: 20,
      price_usd: 50,
      final_amount_usd: 50,
      status: "Delivered_Paid",
      payments: [{ method: "CASH", currency_code: "USD", amount: 76 }],
      parts,
    });
    expect(res.success).toBe(true);
    const jobId = res.id as number;

    // Mid-state: stock actually moved (2 units of A, 1 of B), parts total is
    // labour(50) + parts(26) = 76, matching the CASH payment above exactly
    // (no debt/change).
    expect(stockOf(db, productA)).toBe(beforeStockA - 2);
    expect(stockOf(db, productB)).toBe(beforeStockB - 1);
    expect(batchRemaining(db, productA)).toBe(beforeBatchA - 2);
    expect(batchRemaining(db, productB)).toBe(beforeBatchB - 1);
    expect(drawerBalance(db, "General", "USD")).toBeCloseTo(
      beforeDrawerUsd + 76,
      6,
    );

    const txn = db
      .prepare(
        `SELECT id, amount_usd, profit_usd FROM transactions WHERE source_table='maintenance' AND source_id=? AND type='MAINTENANCE'`,
      )
      .get(jobId) as { id: number; amount_usd: number; profit_usd: number };
    expect(txn.amount_usd).toBeCloseTo(76, 6);
    // labour margin 30 + parts margin (2*(10-5) + 1*(6-3)) = 30 + 13 = 43
    expect(txn.profit_usd).toBeCloseTo(43, 6);

    // Refund via the GENERIC Transactions-table path — the exact path a
    // maintenance job voided/refunded from the Transactions page uses.
    getTransactionRepository().refundTransaction(txn.id, 1);

    // Net back to pre-job baselines — deltas, never absolute totals read off
    // a shared fixture.
    expect(stockOf(db, productA)).toBe(beforeStockA);
    expect(stockOf(db, productB)).toBe(beforeStockB);
    expect(batchRemaining(db, productA)).toBe(beforeBatchA);
    expect(batchRemaining(db, productB)).toBe(beforeBatchB);
    expect(drawerBalance(db, "General", "USD")).toBeCloseTo(beforeDrawerUsd, 6);

    const profitSum = profitSumForJob(db, jobId);
    expect(profitSum.usd).toBeCloseTo(0, 6);
    expect(profitSum.lbp).toBeCloseTo(0, 6);
  });

  // ---------------------------------------------------------------------
  // 2. No double restore — refund then delete moves stock exactly once.
  // ---------------------------------------------------------------------
  it("2. refund then delete: stock moves exactly once (stock_restored guard)", () => {
    const productA = seedProduct(db, { name: "Screen", costUsd: 5, stock: 10 });
    const before = stockOf(db, productA);

    const res = service.saveJob({
      device_name: "iPhone 13",
      currency: "USD",
      cost_usd: 20,
      price_usd: 50,
      final_amount_usd: 50,
      status: "Delivered_Paid",
      payments: [{ method: "CASH", currency_code: "USD", amount: 70 }],
      parts: [{ product_id: productA, quantity: 2, unit_price_usd: 10 }],
    });
    expect(res.success).toBe(true);
    const jobId = res.id as number;
    expect(stockOf(db, productA)).toBe(before - 2);

    const txn = db
      .prepare(
        `SELECT id FROM transactions WHERE source_table='maintenance' AND source_id=? AND type='MAINTENANCE'`,
      )
      .get(jobId) as { id: number };

    getTransactionRepository().refundTransaction(txn.id, 1);
    expect(stockOf(db, productA)).toBe(before); // restored once by the refund

    repo.deleteJob(jobId);
    // Still exactly `before` — deleteJob must NOT restore a second time.
    expect(stockOf(db, productA)).toBe(before);
    expect(
      db.prepare(`SELECT status FROM maintenance WHERE id=?`).get(jobId),
    ).toEqual({ status: "Deleted" });
  });

  // ---------------------------------------------------------------------
  // 3. `parts: undefined` must not delete all parts.
  // ---------------------------------------------------------------------
  it("3. syncParts(id, undefined) leaves existing parts and stock untouched — a status-only resave must never wipe parts", () => {
    const productA = seedProduct(db, { name: "Screen", costUsd: 5, stock: 10 });
    const jobId = repo.createJob({
      device_name: "iPhone 13",
      status: "Received",
    });

    repo.syncParts(jobId, [
      { product_id: productA, quantity: 2, unit_price_usd: 10 },
    ]);
    const afterAttach = stockOf(db, productA);
    expect(afterAttach).toBe(8);
    expect(partsOf(db, jobId)).toHaveLength(1);

    // The exact payload shape a status-transition resave produces: no
    // `parts` key at all.
    repo.syncParts(jobId, undefined);

    expect(stockOf(db, productA)).toBe(afterAttach); // unchanged
    expect(partsOf(db, jobId)).toHaveLength(1); // still there
  });

  // ---------------------------------------------------------------------
  // 4 (of the six) lives in MaintenanceService.partsProfitStamp.test.ts —
  // this file's item 5 below is the parts-edit money lock.
  // ---------------------------------------------------------------------

  // ---------------------------------------------------------------------
  // 5. Amount lock covers parts (MAINTENANCE_PARTS_EDIT_BLOCKED_ERROR).
  // ---------------------------------------------------------------------
  it("5. syncParts on a paid, unrefunded job throws MAINTENANCE_PARTS_EDIT_BLOCKED_ERROR; after refund the same edit succeeds", () => {
    const productA = seedProduct(db, { name: "Screen", costUsd: 5, stock: 10 });
    const productB = seedProduct(db, { name: "Battery", costUsd: 3, stock: 5 });

    const res = service.saveJob({
      device_name: "iPhone 13",
      currency: "USD",
      cost_usd: 20,
      price_usd: 50,
      final_amount_usd: 50,
      status: "Delivered_Paid",
      payments: [{ method: "CASH", currency_code: "USD", amount: 70 }],
      parts: [{ product_id: productA, quantity: 2, unit_price_usd: 10 }],
    });
    const jobId = res.id as number;

    expect(() =>
      repo.syncParts(jobId, [
        { product_id: productB, quantity: 1, unit_price_usd: 6 },
      ]),
    ).toThrow(MAINTENANCE_PARTS_EDIT_BLOCKED_ERROR);
    // Rejected BEFORE any stock moved.
    expect(stockOf(db, productB)).toBe(5);

    const txn = db
      .prepare(
        `SELECT id FROM transactions WHERE source_table='maintenance' AND source_id=? AND type='MAINTENANCE'`,
      )
      .get(jobId) as { id: number };
    getTransactionRepository().refundTransaction(txn.id, 1);

    expect(() =>
      repo.syncParts(jobId, [
        { product_id: productB, quantity: 1, unit_price_usd: 6 },
      ]),
    ).not.toThrow();
    expect(stockOf(db, productB)).toBe(4);
  });

  // ---------------------------------------------------------------------
  // 6. Stock guard — attaching more units than on hand rolls back the WHOLE
  //    save (no orphan job row, no stock movement).
  // ---------------------------------------------------------------------
  it("6. out-of-stock parts on create rolls back the whole save — no job row left behind, stock unchanged", () => {
    const productA = seedProduct(db, {
      name: "Rare Screen",
      costUsd: 5,
      stock: 3,
    });
    const beforeStock = stockOf(db, productA);
    const beforeCount = (
      db.prepare(`SELECT COUNT(*) c FROM maintenance`).get() as { c: number }
    ).c;

    const res = service.saveJob({
      device_name: "iPhone 13",
      status: "Received",
      parts: [{ product_id: productA, quantity: 999, unit_price_usd: 10 }],
    });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not enough stock/i);

    const afterCount = (
      db.prepare(`SELECT COUNT(*) c FROM maintenance`).get() as { c: number }
    ).c;
    expect(afterCount).toBe(beforeCount); // no orphan job row
    expect(stockOf(db, productA)).toBe(beforeStock); // no partial stock move
  });

  // ---------------------------------------------------------------------
  // 8. syncParts reconciliation matrix — add / increase / decrease / remove
  //    / no-op resend.
  // ---------------------------------------------------------------------
  it("8. syncParts reconciliation matrix: add, increase, decrease, remove, and a no-op resend move exactly the expected stock delta", () => {
    const productA = seedProduct(db, { name: "Screen", costUsd: 5, stock: 20 });
    const jobId = repo.createJob({
      device_name: "iPhone 13",
      status: "Received",
    });

    // Add: 3 units.
    repo.syncParts(jobId, [
      { product_id: productA, quantity: 3, unit_price_usd: 10 },
    ]);
    expect(stockOf(db, productA)).toBe(17);
    let rows = partsOf(db, jobId);
    expect(rows).toHaveLength(1);
    const partId = rows[0].id;

    // Increase: 3 -> 5 (draw 2 more).
    repo.syncParts(jobId, [
      { id: partId, product_id: productA, quantity: 5, unit_price_usd: 10 },
    ]);
    expect(stockOf(db, productA)).toBe(15);

    // Decrease: 5 -> 2 (return 3).
    repo.syncParts(jobId, [
      { id: partId, product_id: productA, quantity: 2, unit_price_usd: 10 },
    ]);
    expect(stockOf(db, productA)).toBe(18);

    // No-op resend of the identical array — must move nothing.
    const beforeNoop = stockOf(db, productA);
    repo.syncParts(jobId, [
      { id: partId, product_id: productA, quantity: 2, unit_price_usd: 10 },
    ]);
    expect(stockOf(db, productA)).toBe(beforeNoop);

    // Remove: incoming array no longer contains the row -> full restore + delete.
    repo.syncParts(jobId, []);
    expect(stockOf(db, productA)).toBe(20); // back to the original 20
    expect(partsOf(db, jobId)).toHaveLength(0);
  });

  // ---------------------------------------------------------------------
  // 9. Attach-time cost snapshot — a later re-cost of the product must not
  //    move an already-attached part's stamped cost.
  // ---------------------------------------------------------------------
  it("9. unit_cost_usd is snapshotted at attach time and does not move when the product's cost_price_usd later changes", () => {
    const productA = seedProduct(db, { name: "Screen", costUsd: 5, stock: 10 });
    const jobId = repo.createJob({
      device_name: "iPhone 13",
      status: "Received",
    });

    repo.syncParts(jobId, [
      { product_id: productA, quantity: 1, unit_price_usd: 10 },
    ]);
    const snapshot = partsOf(db, jobId)[0];
    expect(snapshot.unit_cost_usd).toBeCloseTo(5, 6);

    db.prepare(`UPDATE products SET cost_price_usd = 999 WHERE id = ?`).run(
      productA,
    );

    const jobAfterReprice = repo.findById(jobId);
    expect(jobAfterReprice?.parts_cost_usd).toBeCloseTo(5, 6);
    expect(partsOf(db, jobId)[0].unit_cost_usd).toBeCloseTo(5, 6);
  });
});
