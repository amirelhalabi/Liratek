/**
 * LIRA-231 — `ProfitRepository.getPendingSaleProfit` (the Overview's
 * "Deferred Profit — Unpaid sales" card AND the Pending tab's unpaid-sales
 * table both read this one method unmodified — `ProfitService.getSummary`
 * line ~946 and `ProfitService.getPendingProfit` line ~1924 each call
 * `this.repo.getPendingSaleProfit()` and `.reduce()` the SAME
 * `outstanding_usd`/`potential_profit_usd` fields with no further
 * transformation, so a fix here fixes both surfaces identically — verified
 * by reading both call sites, not re-tested a second time at the service
 * layer).
 *
 * BUG (measured on the owner's local DB): `SalesRepository.refundSaleItem`
 * (the per-item refund path) only ever increments
 * `sale_items.refunded_quantity` — it never sets `sale_items.is_refunded`
 * (that flag is written ONLY by a WHOLE-sale refund, which also flips
 * `sales.status` away from `'completed'`). The old query here filtered
 * `si.is_refunded = 0` and then multiplied by the line's FULL `si.quantity`,
 * so an item-refunded line kept contributing its full pre-refund revenue and
 * margin to this card forever, and `total_amount_usd`/`outstanding_usd` read
 * straight off the sale's GROSS `final_amount_usd`, never netted against the
 * refund at all.
 *
 * Sale #4 on the owner's DB: final_amount_usd 1635, paid_usd 0 (charged to
 * the customer's account). Items: iPhone (sold 1500, cost 1300), 'test'
 * (sold 120, cost 100), 'testpart' (sold 15, cost 10) — SALE profit stamp
 * 225. The iPhone was then refunded via `refundSaleItem`
 * (sale_items.refunded_quantity = 1), which wrote a REFUND transaction
 * (amount_usd -1500, profit_usd -200, source_table 'sales', source_id 4).
 * Pre-fix, this card read `total_amount_usd 1635` / `potential_profit_usd
 * 225` — the refund was completely invisible to it. It must read net-of-
 * refund: $135 outstanding, $25 potential profit.
 *
 * RED proof (rule 17): the "owner's exact numbers" test below, run against
 * the pre-fix query (`si.is_refunded = 0` gross gate, `s.final_amount_usd`
 * for total/outstanding, item-margin-minus-discount subquery for profit),
 * fails with `outstanding_usd: 1635` (expected 135) and
 * `potential_profit_usd: 225` (expected 25) — the exact defect reported.
 * Fixed by netting revenue via the SAME `saleAggBody`/`netSaleRevenueExpr`
 * fragments `getSalesRevCost`/`getSalesDetail` already use (remaining
 * quantities + discount pro-rating), and profit via
 * `salePlusRefundProfitSubquery` (SALE stamp + its item-REFUND stamps,
 * correlated by `source_table`/`source_id` — the same pair
 * `getSalesProfit` sums for the Overview's own By Module total, so this card
 * can never disagree with it).
 */

import Database from "better-sqlite3";
import { SalesRepository } from "../SalesRepository.js";
import { ProfitRepository } from "../ProfitRepository.js";
import { resetTransactionRepository } from "../TransactionRepository.js";
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

    CREATE TABLE clients (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name       TEXT NOT NULL,
      phone_number    TEXT,
      whatsapp_opt_in INTEGER DEFAULT 0,
      tenant_id       INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at      TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE products (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT NOT NULL,
      cost_price_usd  REAL NOT NULL DEFAULT 0,
      stock_quantity  INTEGER NOT NULL DEFAULT 0,
      warranty_months INTEGER,
      tenant_id       INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE sales (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id              INTEGER,
      total_amount_usd       REAL NOT NULL DEFAULT 0,
      discount_usd           REAL NOT NULL DEFAULT 0,
      final_amount_usd       REAL NOT NULL DEFAULT 0,
      paid_usd               REAL NOT NULL DEFAULT 0,
      paid_lbp               REAL NOT NULL DEFAULT 0,
      change_given_usd       REAL NOT NULL DEFAULT 0,
      change_given_lbp       REAL NOT NULL DEFAULT 0,
      exchange_rate_snapshot REAL,
      drawer_name            TEXT DEFAULT 'General',
      status                 TEXT NOT NULL DEFAULT 'completed',
      note                   TEXT,
      tenant_id              INTEGER NOT NULL DEFAULT 1,
      created_at             TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at             TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE sale_items (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id                 INTEGER NOT NULL,
      product_id              INTEGER,
      quantity                INTEGER NOT NULL DEFAULT 1,
      sold_price_usd          REAL NOT NULL DEFAULT 0,
      cost_price_snapshot_usd REAL NOT NULL DEFAULT 0,
      imei                    TEXT,
      warranty_until          TEXT,
      is_refunded             INTEGER NOT NULL DEFAULT 0,
      refunded_quantity       INTEGER NOT NULL DEFAULT 0,
      tenant_id               INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE transactions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      type          TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table  TEXT,
      source_id     INTEGER,
      user_id       INTEGER,
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
      tenant_id     INTEGER NOT NULL DEFAULT 1,
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
      tenant_id      INTEGER NOT NULL DEFAULT 1,
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

    CREATE TABLE debt_ledger (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id        INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd       REAL,
      amount_lbp       REAL,
      transaction_id   INTEGER,
      note             TEXT,
      due_date         TEXT,
      created_by       INTEGER,
      covered_usd      REAL NOT NULL DEFAULT 0,
      covered_lbp      REAL NOT NULL DEFAULT 0,
      is_refunded      INTEGER DEFAULT 0,
      refunded_at      TEXT DEFAULT NULL,
      tenant_id        INTEGER NOT NULL DEFAULT 1,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- ProfitRepository's saleRecognitionWeight/saleHasPartnerObligation
    -- fragments reference partner_ledger unconditionally (not schema-drift
    -- guarded) — left empty so every sale is treated as plain customer-paid.
    CREATE TABLE partner_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      partner_id INTEGER NOT NULL,
      transaction_type TEXT,
      reference_table TEXT,
      reference_id INTEGER,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      direction TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      notes TEXT, user_id INTEGER, settlement_method TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      covered_amount REAL NOT NULL DEFAULT 0
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

    CREATE TABLE stock_batch_consumptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      batch_id INTEGER NOT NULL,
      sale_item_id INTEGER,
      custom_service_id INTEGER,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      unit_cost_usd DECIMAL(10,2) NOT NULL,
      reason TEXT NOT NULL DEFAULT 'SALE',
      is_restored INTEGER NOT NULL DEFAULT 0,
      maintenance_part_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.prepare(`INSERT INTO users (id, username) VALUES (1, 'cashier')`).run();
  // `SalesRepository.processSale` calls `bookClientDebtCharge` for any
  // unpaid remainder and throws "Cannot create debt for anonymous client"
  // when `finalClientId` is falsy (pre-existing behaviour, unrelated to
  // LIRA-231) — every sale below is unpaid, so a real client row is
  // required for `processSale` to succeed at all.
  db.prepare(
    `INSERT INTO clients (id, full_name, phone_number) VALUES (1, 'Test Client', '00000000')`,
  ).run();
  db.prepare(
    `INSERT INTO products (id, name, cost_price_usd, stock_quantity) VALUES
      (1, 'iPhone', 1300, 10),
      (2, 'test', 100, 10),
      (3, 'testpart', 10, 10),
      (4, 'ItemA', 60, 10),
      (5, 'ItemB', 50, 10),
      (6, 'Solo', 30, 10)`,
  ).run();
  db.prepare(
    `INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance)
     VALUES (1, 'General', 'USD', 0), (1, 'General', 'LBP', 0)`,
  ).run();
  return db;
}

describe("ProfitRepository.getPendingSaleProfit — net of item refunds (LIRA-231)", () => {
  let db: Database.Database;
  let salesRepo: SalesRepository;
  let profitRepo: ProfitRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetTransactionRepository();
    salesRepo = new SalesRepository();
    profitRepo = new ProfitRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
    resetTenantContext();
  });

  it("owner's exact numbers: a 3-item unpaid sale with one item refunded reads net $135 outstanding / $25 potential profit (was $1,635 / $225)", () => {
    const res = salesRepo.processSale(
      {
        client_id: 1,
        items: [
          { product_id: 1, quantity: 1, price: 1500 }, // iPhone, cost 1300
          { product_id: 2, quantity: 1, price: 120 }, // test, cost 100
          { product_id: 3, quantity: 1, price: 15 }, // testpart, cost 10
        ],
        total_amount: 1635,
        discount: 0,
        final_amount: 1635,
        payment_usd: 0, // charged to the customer's account — unpaid
        payment_lbp: 0,
        exchange_rate: 90_000,
      },
      1,
    );
    expect(res.success).toBe(true);
    const saleId = res.id!;

    // Sanity: the SALE row's RAW stamped profit_usd is 225, exactly as
    // reported on the owner's DB. Read directly off `transactions` rather
    // than through `getSalesProfit()`: that method reports RECOGNIZED
    // profit, weighted by `saleRecognitionWeight` (PFT-6) — for an unpaid,
    // non-partner sale (this one; customer debt) that weight is 0.0 by
    // design ("DBT-1/client debt is out of scope" — see that fragment's own
    // doc comment), so `getSalesProfit` correctly reads 0 here regardless of
    // this fix. `salePlusRefundProfitSubquery` — the fragment under test —
    // sums this same RAW `t.profit_usd` unweighted, so the raw stamp is the
    // right oracle for this sanity check.
    const stampedSaleProfit = (
      db
        .prepare(
          `SELECT profit_usd FROM transactions WHERE source_table = 'sales' AND source_id = ? AND type = 'SALE'`,
        )
        .get(saleId) as { profit_usd: number }
    ).profit_usd;
    expect(stampedSaleProfit).toBeCloseTo(225, 6);

    const iphoneItemId = (
      db
        .prepare(
          `SELECT id FROM sale_items WHERE sale_id = ? AND product_id = 1`,
        )
        .get(saleId) as { id: number }
    ).id;

    salesRepo.refundSaleItem({
      saleId,
      saleItemId: iphoneItemId,
      refundQuantity: 1,
      userId: 1,
    });

    const rows = profitRepo.getPendingSaleProfit();

    expect(rows).toHaveLength(1);
    expect(rows[0].sale_id).toBe(saleId);
    expect(rows[0].total_amount_usd).toBeCloseTo(135, 6);
    expect(rows[0].paid_usd).toBeCloseTo(0, 6);
    expect(rows[0].outstanding_usd).toBeCloseTo(135, 6);
    expect(rows[0].potential_profit_usd).toBeCloseTo(25, 6);
  });

  it("partial payment: paid $20 of a sale whose one item is later refunded — unpaid amount is net value minus paid, not gross minus paid", () => {
    const res = salesRepo.processSale(
      {
        client_id: 1,
        items: [
          { product_id: 4, quantity: 1, price: 100 }, // ItemA, cost 60
          { product_id: 5, quantity: 1, price: 80 }, // ItemB, cost 50
        ],
        total_amount: 180,
        discount: 0,
        final_amount: 180,
        payment_usd: 20,
        payment_lbp: 0,
        exchange_rate: 90_000,
      },
      1,
    );
    expect(res.success).toBe(true);
    const saleId = res.id!;

    const itemAId = (
      db
        .prepare(
          `SELECT id FROM sale_items WHERE sale_id = ? AND product_id = 4`,
        )
        .get(saleId) as { id: number }
    ).id;

    // Refund ItemA entirely; ItemB ($80, cost $50) remains outstanding.
    salesRepo.refundSaleItem({
      saleId,
      saleItemId: itemAId,
      refundQuantity: 1,
      userId: 1,
    });

    const rows = profitRepo.getPendingSaleProfit();

    expect(rows).toHaveLength(1);
    expect(rows[0].sale_id).toBe(saleId);
    // Net sale value = 80 (ItemB only). Outstanding = 80 - 20 paid = 60.
    expect(rows[0].total_amount_usd).toBeCloseTo(80, 6);
    expect(rows[0].outstanding_usd).toBeCloseTo(60, 6);
    // SALE profit (40+30=70) + REFUND profit (-40 for ItemA) = 30.
    expect(rows[0].potential_profit_usd).toBeCloseTo(30, 6);
  });

  it("a fully refunded unpaid sale shows 0 and is gone from the list entirely", () => {
    const res = salesRepo.processSale(
      {
        client_id: 1,
        items: [{ product_id: 6, quantity: 1, price: 50 }], // Solo, cost 30
        total_amount: 50,
        discount: 0,
        final_amount: 50,
        payment_usd: 0,
        payment_lbp: 0,
        exchange_rate: 90_000,
      },
      1,
    );
    expect(res.success).toBe(true);
    const saleId = res.id!;

    const soloItemId = (
      db
        .prepare(`SELECT id FROM sale_items WHERE sale_id = ?`)
        .get(saleId) as { id: number }
    ).id;

    salesRepo.refundSaleItem({
      saleId,
      saleItemId: soloItemId,
      refundQuantity: 1,
      userId: 1,
    });

    const rows = profitRepo.getPendingSaleProfit();

    expect(rows).toHaveLength(0);
  });

  it("regression: an UNREFUNDED unpaid discounted sale is unchanged vs the pre-fix behaviour (no refund in play, gross === net)", () => {
    const res = salesRepo.processSale(
      {
        client_id: 1,
        items: [{ product_id: 4, quantity: 1, price: 100 }], // ItemA, cost 60
        total_amount: 100,
        discount: 10,
        final_amount: 90,
        payment_usd: 0,
        payment_lbp: 0,
        exchange_rate: 90_000,
      },
      1,
    );
    expect(res.success).toBe(true);
    const saleId = res.id!;

    const rows = profitRepo.getPendingSaleProfit();

    expect(rows).toHaveLength(1);
    expect(rows[0].sale_id).toBe(saleId);
    expect(rows[0].total_amount_usd).toBeCloseTo(90, 6);
    expect(rows[0].outstanding_usd).toBeCloseTo(90, 6);
    // Margin (100-60) - discount(10) = 30, same as the pre-fix formula
    // would have produced for an unrefunded line.
    expect(rows[0].potential_profit_usd).toBeCloseTo(30, 6);
  });
});
