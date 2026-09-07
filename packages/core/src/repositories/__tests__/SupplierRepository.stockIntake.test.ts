/**
 * SUPPLIER_STOCK_INTAKE_PLAN.md — event-based supplier debt regression proofs.
 *
 * Before this change, `SupplierRepository.getProductSupplierBalances` (then
 * called `getProductSupplierBalances`/whatever recompute variant preceded it)
 * RECOMPUTED "what the shop owes" as
 *   SUM(live stock_quantity * live cost_price_usd) + SUM(supplier_ledger)
 * — see the method's own doc-comment for the exact bug list this replaces.
 * That meant a POS sale (which lowers `stock_quantity`) silently shrank the
 * owed balance, a refund raised it back up, and editing a product's cost
 * price re-priced ALREADY-SETTLED history. No code path ever wrote a
 * supplier ledger row for an actual stock delivery.
 *
 * The fix: `ProductRepository.receiveStock`/`createProduct` book ONE
 * `supplier_ledger` 'STOCK_INTAKE' row (+qty * unit cost) via
 * `SupplierRepository.recordStockIntake`, and `getProductSupplierBalances`
 * is now a pure ledger SUM — sales/refunds/cost edits never touch it.
 *
 * Every "pre-fix" case below is written so it would FAIL against the
 * recompute-based implementation (CLAUDE.md rule 17) — each test's comment
 * names exactly why.
 */

import Database from "better-sqlite3";
import { ProductRepository } from "../ProductRepository.js";
import { getSupplierRepository, resetSupplierRepository } from "../SupplierRepository.js";
import { getStockBatchRepository, resetStockBatchRepository } from "../StockBatchRepository.js";
import { resetProductSupplierRepository } from "../ProductSupplierRepository.js";
import { resetStockAdjustmentRepository } from "../StockAdjustmentRepository.js";
import { resetTransactionRepository } from "../TransactionRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";
import { ValidationError } from "../../utils/errors.js";

const SUPPLIER_NAME = "Acme Distributors";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL
    );
    INSERT INTO users (id, username) VALUES (1, 'admin');

    CREATE TABLE suppliers (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id             INTEGER DEFAULT 1,
      name                  TEXT NOT NULL,
      contact_name          TEXT,
      phone                 TEXT,
      note                  TEXT,
      is_active             INTEGER NOT NULL DEFAULT 1,
      module_key            TEXT,
      provider              TEXT,
      is_system             INTEGER NOT NULL DEFAULT 0,
      commission_entry_mode TEXT DEFAULT 'LUMP',
      commission_rate       REAL,
      created_at            DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE product_suppliers (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id   INTEGER DEFAULT 1,
      name        TEXT NOT NULL COLLATE NOCASE,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      is_active   INTEGER NOT NULL DEFAULT 1,
      supplier_id INTEGER REFERENCES suppliers(id),
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, name)
    );

    -- Widened CHECK (post-v164): 'STOCK_INTAKE' is the entry_type this whole
    -- feature books.
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
      barcode            TEXT,
      name               TEXT NOT NULL,
      item_type          TEXT NOT NULL DEFAULT 'Product',
      category           TEXT,
      category_id        INTEGER,
      cost_price_usd     REAL DEFAULT 0,
      selling_price_usd  REAL DEFAULT 0,
      min_stock_level    INTEGER DEFAULT 5,
      stock_quantity     INTEGER DEFAULT 0,
      image_url          TEXT,
      warranty_months    INTEGER,
      is_active          INTEGER DEFAULT 1,
      is_deleted         INTEGER DEFAULT 0,
      supplier           TEXT,
      created_at         TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at         TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, barcode)
    );

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
      is_restored        INTEGER NOT NULL DEFAULT 0,
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP
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

    CREATE TABLE stock_adjustments (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id     INTEGER,
      product_id    INTEGER NOT NULL,
      delta         INTEGER NOT NULL,
      old_quantity  INTEGER NOT NULL,
      new_quantity  INTEGER NOT NULL,
      reason        TEXT NOT NULL,
      user_id       INTEGER,
      -- v165: nullable, no backfill — receiveStock's
      -- getStockAdjustmentRepository().create(...) call always passes a
      -- real unit_cost_usd, and StockAdjustmentRepository.create()'s INSERT
      -- column list references this column unconditionally, so its absence
      -- fails db.prepare() for every receiveStock() call in this suite.
      unit_cost_usd DECIMAL(10,2) DEFAULT NULL,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
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

function seedSupplierAndProduct(
  db: Database.Database,
  opts: { productId?: number; supplierId?: number; supplierName?: string } = {},
): { supplierId: number; productId: number } {
  const supplierId = opts.supplierId ?? 1;
  const productId = opts.productId ?? 1;
  db.prepare(
    `INSERT INTO suppliers (id, name) VALUES (?, ?)`,
  ).run(supplierId, opts.supplierName ?? SUPPLIER_NAME);
  db.prepare(
    `INSERT INTO product_suppliers (id, name, supplier_id) VALUES (?, ?, ?)`,
  ).run(supplierId, opts.supplierName ?? SUPPLIER_NAME, supplierId);
  db.prepare(
    `INSERT INTO products (id, name, stock_quantity, cost_price_usd) VALUES (?, 'Widget', 0, 0)`,
  ).run(productId);
  return { supplierId, productId };
}

function balanceFor(
  repo: ReturnType<typeof getSupplierRepository>,
  supplierId: number,
): { total_usd: number; total_lbp: number } {
  const rows = repo.getProductSupplierBalances();
  return (
    rows.find((r) => r.supplier_id === supplierId) ?? {
      supplier_id: supplierId,
      total_usd: 0,
      total_lbp: 0,
    }
  );
}

describe("SupplierRepository / ProductRepository — event-based stock intake balance", () => {
  let db: Database.Database;
  let productRepo: ProductRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetSupplierRepository();
    resetStockBatchRepository();
    resetProductSupplierRepository();
    resetStockAdjustmentRepository();
    resetTransactionRepository();
    productRepo = new ProductRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetSupplierRepository();
    resetStockBatchRepository();
    resetProductSupplierRepository();
    resetStockAdjustmentRepository();
    resetTransactionRepository();
    resetTenantContext();
  });

  // ---------------------------------------------------------------------
  // 1a. Adding stock with a supplier books a STOCK_INTAKE ledger row.
  //
  // Pre-fix: `receiveStock` wrote no ledger row at all (the only debit path
  // was the live recompute), so this ledger SELECT would find zero rows and
  // `getProductSupplierBalances` — being a recompute of stock*cost, not a
  // ledger sum — would have reported the balance from CURRENT inventory
  // value instead of a stamped intake amount. Both assertions below fail
  // pre-fix.
  // ---------------------------------------------------------------------
  it("books ONE STOCK_INTAKE ledger row (qty * unit cost) and the balance equals it", () => {
    const { supplierId, productId } = seedSupplierAndProduct(db);

    productRepo.receiveStock({
      product_id: productId,
      quantity: 10,
      unit_cost_usd: 5,
      supplier: SUPPLIER_NAME,
      is_old_stock: false,
      created_by: 1,
    });

    const ledgerRow = db
      .prepare(
        `SELECT amount_usd FROM supplier_ledger WHERE supplier_id = ? AND entry_type = 'STOCK_INTAKE'`,
      )
      .get(supplierId) as { amount_usd: number };
    expect(ledgerRow.amount_usd).toBeCloseTo(50, 2);

    const repo = getSupplierRepository();
    const balance = balanceFor(repo, supplierId);
    expect(balance.total_usd).toBeCloseTo(50, 2);
  });

  // ---------------------------------------------------------------------
  // 1b. A completed sale leaves the supplier balance UNCHANGED — the
  // headline bug.
  //
  // Pre-fix: the balance was SUM(live stock_quantity * live cost_price_usd)
  // + ledger. Selling a unit lowers stock_quantity, so the recompute would
  // have DROPPED by the unit's cost the moment the sale posted — this test
  // asserts the balance is untouched, which fails against that recompute.
  // ---------------------------------------------------------------------
  it("a completed sale of the product does not move the supplier balance", () => {
    const { supplierId, productId } = seedSupplierAndProduct(db);
    productRepo.receiveStock({
      product_id: productId,
      quantity: 10,
      unit_cost_usd: 5,
      supplier: SUPPLIER_NAME,
      is_old_stock: false,
      created_by: 1,
    });
    const repo = getSupplierRepository();
    const before = balanceFor(repo, supplierId);
    expect(before.total_usd).toBeCloseTo(50, 2);

    // Simulate a completed sale of 3 units the way SalesRepository.processSale
    // does: FIFO-consume via StockBatchRepository, stamp the sale item's cost
    // snapshot, and lower products.stock_quantity — all real production code,
    // just without the surrounding sale-header bookkeeping this test doesn't
    // need.
    db.prepare(
      `INSERT INTO sale_items (id, sale_id, product_id, quantity, sold_price_usd, cost_price_snapshot_usd)
       VALUES (1, 1, ?, 3, 15, 0)`,
    ).run(productId);
    const { weightedUnitCostUsd } = getStockBatchRepository().consume(
      productId,
      3,
      { saleItemId: 1, reason: "SALE", fallbackUnitCostUsd: 5 },
    );
    db.prepare(
      `UPDATE sale_items SET cost_price_snapshot_usd = ? WHERE id = 1`,
    ).run(weightedUnitCostUsd);
    db.prepare(
      `UPDATE products SET stock_quantity = stock_quantity - 3 WHERE id = ?`,
    ).run(productId);

    const after = balanceFor(repo, supplierId);
    expect(after.total_usd).toBeCloseTo(50, 2);
  });

  // ---------------------------------------------------------------------
  // 1c. A refund of that sale ALSO leaves the balance unchanged.
  //
  // Pre-fix: refunding raised stock_quantity back up, so the live recompute
  // would have gone back UP by the refunded unit's cost on top of whatever
  // it had already dropped to — this test's "still exactly 50" assertion
  // fails against that behavior (it would read some other, moving, number).
  // ---------------------------------------------------------------------
  it("a refund of the sale leaves the supplier balance unchanged too", () => {
    const { supplierId, productId } = seedSupplierAndProduct(db);
    productRepo.receiveStock({
      product_id: productId,
      quantity: 10,
      unit_cost_usd: 5,
      supplier: SUPPLIER_NAME,
      is_old_stock: false,
      created_by: 1,
    });
    db.prepare(
      `INSERT INTO sale_items (id, sale_id, product_id, quantity, sold_price_usd, cost_price_snapshot_usd, refunded_quantity)
       VALUES (1, 1, ?, 3, 15, 0, 0)`,
    ).run(productId);
    const { weightedUnitCostUsd } = getStockBatchRepository().consume(
      productId,
      3,
      { saleItemId: 1, reason: "SALE", fallbackUnitCostUsd: 5 },
    );
    db.prepare(
      `UPDATE sale_items SET cost_price_snapshot_usd = ? WHERE id = 1`,
    ).run(weightedUnitCostUsd);
    db.prepare(
      `UPDATE products SET stock_quantity = stock_quantity - 3 WHERE id = ?`,
    ).run(productId);

    const repo = getSupplierRepository();
    expect(balanceFor(repo, supplierId).total_usd).toBeCloseTo(50, 2);

    // Refund 2 of the 3 sold units — mirrors SalesRepository's refund path:
    // restore stock and give the units back to their batch via
    // restoreForSaleItem.
    getStockBatchRepository().restoreForSaleItem(1, 2);
    db.prepare(
      `UPDATE products SET stock_quantity = stock_quantity + 2 WHERE id = ?`,
    ).run(productId);

    expect(balanceFor(repo, supplierId).total_usd).toBeCloseTo(50, 2);
  });

  // ---------------------------------------------------------------------
  // 1d. "Old stock" creates the batch but books NO ledger row — balance
  // stays at zero.
  //
  // Pre-fix there was no batch/ledger concept at all for this flag; framed
  // against the CURRENT design, the failure mode this guards is
  // `shouldBookIntakeDebt` being called with the wrong polarity (booking a
  // debt for old/backfilled stock the shop does not actually owe for) —
  // the ledger SELECT below would find a spurious row and the balance
  // assertion would be 50 instead of 0.
  // ---------------------------------------------------------------------
  it("'old stock' creates the batch but books no ledger row (balance 0)", () => {
    const { supplierId, productId } = seedSupplierAndProduct(db);

    const result = productRepo.receiveStock({
      product_id: productId,
      quantity: 10,
      unit_cost_usd: 5,
      supplier: SUPPLIER_NAME,
      is_old_stock: true,
      created_by: 1,
    });

    const ledgerCount = db
      .prepare(
        `SELECT COUNT(*) AS n FROM supplier_ledger WHERE supplier_id = ? AND entry_type = 'STOCK_INTAKE'`,
      )
      .get(supplierId) as { n: number };
    expect(ledgerCount.n).toBe(0);

    const batch = db
      .prepare(`SELECT quantity, books_debt FROM product_stock_batches WHERE id = ?`)
      .get(result.batch_id) as { quantity: number; books_debt: number };
    expect(batch.quantity).toBe(10);
    expect(batch.books_debt).toBe(0);

    const repo = getSupplierRepository();
    expect(balanceFor(repo, supplierId).total_usd).toBeCloseTo(0, 2);
  });

  // ---------------------------------------------------------------------
  // 1e. Editing the product's cost price afterward does not change the
  // balance.
  //
  // Pre-fix: the recompute used the product's CURRENT cost_price_usd, so
  // bumping it would have re-priced the ALREADY-BOOKED debt retroactively
  // — this test's "still 50" assertion fails against that recompute (it
  // would read 10 * new_cost instead).
  // ---------------------------------------------------------------------
  it("editing the product's cost price after intake does not re-price the balance", () => {
    const { supplierId, productId } = seedSupplierAndProduct(db);
    productRepo.receiveStock({
      product_id: productId,
      quantity: 10,
      unit_cost_usd: 5,
      supplier: SUPPLIER_NAME,
      is_old_stock: false,
      created_by: 1,
    });
    const repo = getSupplierRepository();
    expect(balanceFor(repo, supplierId).total_usd).toBeCloseTo(50, 2);

    db.prepare(`UPDATE products SET cost_price_usd = 999 WHERE id = ?`).run(
      productId,
    );

    expect(balanceFor(repo, supplierId).total_usd).toBeCloseTo(50, 2);
  });

  // ---------------------------------------------------------------------
  // 4. Actor guard — booking with no authenticated user throws.
  //
  // Pre-fix this codebase's own convention was `created_by ?? 1` (an
  // invented actor writing an unattributed money row) OR, in an earlier
  // draft, silently skipping the booking when no actor was available —
  // losing a real debt outright. Both are bugs this guard replaces with a
  // loud failure. Proven against the ACTUAL pre-fix behavior is not
  // possible without reverting `bookIntakeAndBatch`'s guard clause itself;
  // this test instead proves the CURRENT guard fires, and the comment above
  // documents which two silent failure modes it exists to prevent (see
  // ProductRepository.ts's `bookIntakeAndBatch` doc-comment, which this test
  // mirrors).
  // ---------------------------------------------------------------------
  it("throws rather than booking supplier debt with no authenticated user", () => {
    const { supplierId, productId } = seedSupplierAndProduct(db);

    expect(() =>
      productRepo.receiveStock({
        product_id: productId,
        quantity: 10,
        unit_cost_usd: 5,
        supplier: SUPPLIER_NAME,
        is_old_stock: false,
        created_by: null,
      }),
    ).toThrow(ValidationError);

    // Nothing was written — the whole receiveStock call rolled back inside
    // its own db.transaction(), not just the ledger insert.
    const ledgerCount = db
      .prepare(`SELECT COUNT(*) AS n FROM supplier_ledger WHERE supplier_id = ?`)
      .get(supplierId) as { n: number };
    expect(ledgerCount.n).toBe(0);
    const batchCount = db
      .prepare(`SELECT COUNT(*) AS n FROM product_stock_batches WHERE product_id = ?`)
      .get(productId) as { n: number };
    expect(batchCount.n).toBe(0);
    const product = db
      .prepare(`SELECT stock_quantity FROM products WHERE id = ?`)
      .get(productId) as { stock_quantity: number };
    expect(product.stock_quantity).toBe(0);
  });

  // ---------------------------------------------------------------------
  // 6a. Reactivating a soft-deleted product by barcode collision: the new
  // payload carries a quantity but NO supplier, while the stored (deleted)
  // row already has one. `createProduct`'s COALESCE keeps the pre-existing
  // supplier on the row, and `effectiveSupplier` must resolve to THAT
  // remembered supplier (not "no supplier"), booking the new opening
  // quantity against it.
  // ---------------------------------------------------------------------
  it("reactivating a soft-deleted product with no supplier in the payload books against the REMEMBERED supplier", () => {
    seedSupplierAndProduct(db, { supplierId: 1 });

    // First create: real product with a supplier and stock (books an
    // intake), then soft-delete it (mirrors ProductRepository.deleteProduct).
    const created = productRepo.createProduct(
      {
        barcode: "999-COLLIDE",
        name: "Reactivated Widget",
        category: "Accessories",
        cost_price: 4,
        retail_price: 8,
        stock_quantity: 2,
        supplier: SUPPLIER_NAME,
      },
      1,
    );
    db.prepare(
      `UPDATE products SET is_active = 0, is_deleted = 1 WHERE id = ?`,
    ).run(created.id);
    const repo = getSupplierRepository();
    expect(balanceFor(repo, 1).total_usd).toBeCloseTo(8, 2); // 2 * $4

    // Second create with the SAME barcode: quantity 3, supplier OMITTED.
    const reactivated = productRepo.createProduct(
      {
        barcode: "999-COLLIDE",
        name: "Reactivated Widget",
        category: "Accessories",
        cost_price: 6,
        retail_price: 10,
        stock_quantity: 3,
        supplier: null,
      },
      1,
    );
    expect(reactivated.id).toBe(created.id);

    const row = db
      .prepare(`SELECT is_active, is_deleted, supplier FROM products WHERE id = ?`)
      .get(created.id) as {
      is_active: number;
      is_deleted: number;
      supplier: string;
    };
    expect(row.is_active).toBe(1);
    expect(row.is_deleted).toBe(0);
    expect(row.supplier).toBe(SUPPLIER_NAME);

    // Old intake ($8) + new intake (3 * $6 = $18) = $26.
    expect(balanceFor(repo, 1).total_usd).toBeCloseTo(26, 2);

    const ledgerRows = db
      .prepare(
        `SELECT amount_usd FROM supplier_ledger WHERE supplier_id = 1 AND entry_type = 'STOCK_INTAKE' ORDER BY id ASC`,
      )
      .all() as { amount_usd: number }[];
    expect(ledgerRows).toHaveLength(2);
    expect(ledgerRows[0].amount_usd).toBeCloseTo(8, 2);
    expect(ledgerRows[1].amount_usd).toBeCloseTo(18, 2);
  });
});
