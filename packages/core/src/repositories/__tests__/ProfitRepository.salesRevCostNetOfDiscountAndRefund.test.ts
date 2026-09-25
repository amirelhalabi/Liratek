/**
 * PA-4.23 (a) — owner decision 2026-09-24 (OWNER_NOTES_2026-09-21.md §6.9):
 * "Sale revenue and cost become net of discounts and refunded items, so the
 * row adds up to the ledger profit." On real data a SALE row's expanded
 * detail read "$70 − $42 = $22": the $22 profit was CORRECT (the unified
 * ledger, `getSalesProfit`) — the $70/$42 were wrong because
 * `ProfitRepository.getSalesRevCost` summed the sale_items' FULL
 * `sold_price_usd`/`cost_price_snapshot_usd` × quantity, ignoring
 * `sales.discount_usd` and `sale_items.refunded_quantity` (only a WHOLE-sale
 * refund, which stamps `sale_items.is_refunded = 1` on every line, was ever
 * excluded — a partial per-item refund via `refundSaleItem` only increments
 * `refunded_quantity` and leaves `is_refunded` at 0, so it kept counting the
 * refunded units' full price/cost forever).
 *
 * Drives the REAL writers end to end (rule 17 + the owner's own instruction:
 * "processSale with a discount and a refundSaleItem") — `SalesRepository
 * .processSale` (discount) then `.refundSaleItem` (partial item refund) —
 * and asserts `ProfitRepository.getSalesRevCost().revenue_usd -
 * .cost_usd === ProfitRepository.getSalesProfit().profit_usd`, the exact
 * equation PA-4.23's By Module detail row now renders for the SALE row.
 *
 * RED (pre-fix, actually observed): revenue_usd 100, cost_usd 60,
 * revenue−cost 40 ≠ profit_usd 15 — the item that was fully refunded still
 * contributed its full $50 revenue / $30 cost, and the discount was never
 * subtracted at all.
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
  db.prepare(
    `INSERT INTO products (id, name, cost_price_usd, stock_quantity)
     VALUES (1, 'Charger', 30, 50)`,
  ).run();
  db.prepare(
    `INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance)
     VALUES (1, 'General', 'USD', 0), (1, 'General', 'LBP', 0)`,
  ).run();
  return db;
}

describe("ProfitRepository.getSalesRevCost — net of discount + refunded_quantity (PA-4.23 a)", () => {
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

  it("revenue_usd − cost_usd equals the ledger's profit_usd once a discounted sale has one fully-refunded item and one kept item", () => {
    // 2 x $50 = $100 pre-discount, $10 discount → $90 tendered in cash.
    // cost_price_snapshot_usd = $30/unit (stubbed via cost_price_usd = 30).
    const res = salesRepo.processSale(
      {
        client_id: null,
        items: [
          { product_id: 1, quantity: 1, price: 50 },
          { product_id: 1, quantity: 1, price: 50 },
        ],
        total_amount: 100,
        discount: 10,
        final_amount: 90,
        payment_usd: 90,
        payment_lbp: 0,
        exchange_rate: 90_000,
      },
      1,
    );
    expect(res.success).toBe(true);
    const saleId = res.id!;

    const itemIds = (
      db
        .prepare(`SELECT id FROM sale_items WHERE sale_id = ? ORDER BY id`)
        .all(saleId) as { id: number }[]
    ).map((r) => r.id);
    expect(itemIds).toHaveLength(2);

    // Fully refund ONE of the two lines — a partial (per-item) refund, which
    // increments refunded_quantity and leaves is_refunded at 0 (only a
    // WHOLE-sale void ever sets is_refunded = 1).
    salesRepo.refundSaleItem({
      saleId,
      saleItemId: itemIds[0],
      refundQuantity: 1,
      userId: 1,
    });

    const from = "2000-01-01 00:00:00";
    const to = "2100-01-01 23:59:59";
    const revCost = profitRepo.getSalesRevCost(from, to);
    const profit = profitRepo.getSalesProfit(from, to);

    // Ledger truth (SALE profit 30, minus the refund's own profit-give-back
    // 15 = net 15): SALE stamps (50-30)+(50-30)-10 = 30; the refund gives
    // back its gross margin (50-30=20) minus its pro-rata discount share
    // (10 * 50/100 = 5) = 15, so net profit_usd = 30 - 15 = 15.
    expect(profit.profit_usd).toBeCloseTo(15, 6);

    // The fix: revenue/cost net of the refunded line and the discount's
    // pro-rata share of what's LEFT (the remaining $50 line carries half the
    // $10 discount = $5): revenue 50 - 5 = 45, cost 30 (only the kept line).
    expect(revCost.revenue_usd).toBeCloseTo(45, 6);
    expect(revCost.cost_usd).toBeCloseTo(30, 6);
    expect(revCost.count).toBe(1);

    // The equation PA-4.23's By Module detail row now renders for SALE rows.
    expect(revCost.revenue_usd - revCost.cost_usd).toBeCloseTo(
      profit.profit_usd,
      6,
    );
  });

  it("stays exact on an UNDISCOUNTED, unrefunded sale (control)", () => {
    const res = salesRepo.processSale(
      {
        client_id: null,
        items: [{ product_id: 1, quantity: 2, price: 40 }],
        total_amount: 80,
        discount: 0,
        final_amount: 80,
        payment_usd: 80,
        payment_lbp: 0,
        exchange_rate: 90_000,
      },
      1,
    );
    expect(res.success).toBe(true);

    const from = "2000-01-01 00:00:00";
    const to = "2100-01-01 23:59:59";
    const revCost = profitRepo.getSalesRevCost(from, to);
    const profit = profitRepo.getSalesProfit(from, to);

    expect(revCost.revenue_usd).toBeCloseTo(80, 6);
    expect(revCost.cost_usd).toBeCloseTo(60, 6);
    expect(revCost.count).toBe(1);
    expect(revCost.revenue_usd - revCost.cost_usd).toBeCloseTo(
      profit.profit_usd,
      6,
    );
  });
});
