/**
 * SalesRepository — a per-item refund gives back a share of the sale's
 * PRE-discount total, never of the post-discount tender.
 *
 * `refundSaleItem` pro-rates the original tender across the SALE's payment
 * legs. The numerator is the line's PRE-discount value
 * (`item.sold_price_usd × qty`), so the denominator must be the sale's
 * PRE-discount total (`sales.total_amount_usd`) for the per-line shares to sum
 * to exactly 1. It used `originalTxn.amount_usd` — the POST-discount final —
 * so the shares summed to `total / final` (> 1 on any discounted sale) and
 * refunding every line individually handed back the full PRE-discount price
 * while the customer had only ever tendered the discounted total. The
 * over-refund equalled the discount, in every currency leg.
 *
 * This is the money twin of the discount pro-rating the PROFIT arm of the same
 * function already did correctly (guarded by
 * `SalesRepository.discountProfit.test.ts`) — one business rule, two
 * denominators that disagreed (rule 14). It is load-bearing now that
 * `TransactionRepository._assertNoPartialItemRefunds` BLOCKS the whole-sale
 * refund of a partially item-refunded sale and points the operator at this
 * per-item route as the exact one.
 *
 * The same ratio drives the `Sale Debt` reversal, so an on-account discounted
 * sale over-cancelled the client's debt by the discount too (turning it into a
 * phantom credit) — covered below.
 */

import Database from "better-sqlite3";
import { SalesRepository } from "../SalesRepository.js";
import { resetTransactionRepository } from "../TransactionRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

const OPENING_USD = 500;
const OPENING_LBP = 20_000_000;

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
      -- Nullable, exactly as in create_db.sql: bookClientDebtCharge writes a
      -- NULL amount_lbp for USD-priced POS sales.
      amount_usd       REAL,
      amount_lbp       REAL,
      transaction_id   INTEGER,
      note             TEXT,
      due_date         TEXT,
      created_by       INTEGER,
      is_refunded      INTEGER DEFAULT 0,
      refunded_at      TEXT DEFAULT NULL,
      tenant_id        INTEGER NOT NULL DEFAULT 1,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.prepare(`INSERT INTO users (id, username) VALUES (1, 'cashier')`).run();
  db.prepare(
    `INSERT INTO clients (id, full_name, phone_number) VALUES (1, 'Discount Dana', '0700111')`,
  ).run();
  db.prepare(
    `INSERT INTO products (id, name, cost_price_usd, stock_quantity)
     VALUES (1, 'Screen protector', 4, 50)`,
  ).run();
  db.prepare(
    `INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance)
     VALUES (1, 'General', 'USD', ?), (1, 'General', 'LBP', ?)`,
  ).run(OPENING_USD, OPENING_LBP);
  return db;
}

describe("SalesRepository — per-item refund of a DISCOUNTED sale returns exactly the tender", () => {
  let db: Database.Database;
  let repo: SalesRepository;

  const drawer = (currency: "USD" | "LBP"): number =>
    (
      db
        .prepare(
          `SELECT balance FROM drawer_balances
            WHERE tenant_id = 1 AND drawer_name = 'General' AND currency_code = ?`,
        )
        .get(currency) as { balance: number }
    ).balance;

  const lineIds = (saleId: number): number[] =>
    (
      db
        .prepare(`SELECT id FROM sale_items WHERE sale_id = ? ORDER BY id`)
        .all(saleId) as { id: number }[]
    ).map((r) => r.id);

  const refundEveryLine = (saleId: number): void => {
    for (const saleItemId of lineIds(saleId)) {
      repo.refundSaleItem({
        saleId,
        saleItemId,
        refundQuantity: 1,
        userId: 1,
      });
    }
  };

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetTransactionRepository();
    repo = new SalesRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
    resetTenantContext();
  });

  it("returns the cash drawer to its pre-sale balance after every line is refunded individually", () => {
    // 3 x $10 = $30 pre-discount, $3 discount → $27 final, $27 cash tendered.
    const res = repo.processSale(
      {
        client_id: null,
        items: [
          { product_id: 1, quantity: 1, price: 10 },
          { product_id: 1, quantity: 1, price: 10 },
          { product_id: 1, quantity: 1, price: 10 },
        ],
        total_amount: 30,
        discount: 3,
        final_amount: 27,
        payment_usd: 27,
        payment_lbp: 0,
        exchange_rate: 30_000,
      },
      1,
    );
    expect(res.success).toBe(true);
    const saleId = res.id!;
    expect(drawer("USD")).toBe(OPENING_USD + 27);
    expect(lineIds(saleId)).toHaveLength(3);

    refundEveryLine(saleId);

    // Pre-fix each line gave back 27 x (10/27) = $10 → $30 handed back on a $27
    // tender, leaving the drawer $3 (the discount) SHORT of where it started.
    expect(drawer("USD")).toBe(OPENING_USD);
  });

  it("returns EVERY currency leg to its pre-sale balance (mixed USD + LBP tender)", () => {
    // 2 x $30 = $60 pre-discount, $6 discount → $54 final, tendered as
    // $27 + 810,000 LBP (= $27 at 30,000).
    const res = repo.processSale(
      {
        client_id: null,
        items: [
          { product_id: 1, quantity: 1, price: 30 },
          { product_id: 1, quantity: 1, price: 30 },
        ],
        total_amount: 60,
        discount: 6,
        final_amount: 54,
        payment_usd: 27,
        payment_lbp: 810_000,
        exchange_rate: 30_000,
      },
      1,
    );
    expect(res.success).toBe(true);
    const saleId = res.id!;
    expect(drawer("USD")).toBe(OPENING_USD + 27);
    expect(drawer("LBP")).toBe(OPENING_LBP + 810_000);

    refundEveryLine(saleId);

    // Both legs in ONE assertion so a regression reports both numbers rather
    // than stopping at USD. Pre-fix: 2 x 27 x (30/54) = $30 back on a $27
    // tender (over by $3) and 2 x 810,000 x (30/54) = 900,000 LBP back on
    // 810,000 (over by 90,000) — the discount, in each currency.
    expect({ usd: drawer("USD"), lbp: drawer("LBP") }).toEqual({
      usd: OPENING_USD,
      lbp: OPENING_LBP,
    });
  });

  it("cancels exactly the booked Sale Debt on a discounted on-account sale", () => {
    // 2 x $30 = $60 pre-discount, $6 discount → $54 owed, nothing tendered.
    const res = repo.processSale(
      {
        client_id: 1,
        items: [
          { product_id: 1, quantity: 1, price: 30 },
          { product_id: 1, quantity: 1, price: 30 },
        ],
        total_amount: 60,
        discount: 6,
        final_amount: 54,
        payment_usd: 0,
        payment_lbp: 0,
        exchange_rate: 30_000,
      },
      1,
    );
    expect(res.success).toBe(true);
    const saleId = res.id!;

    const netDebt = (): number =>
      (
        db
          .prepare(
            `SELECT COALESCE(SUM(amount_usd), 0) AS d FROM debt_ledger WHERE client_id = 1`,
          )
          .get() as { d: number }
      ).d;

    expect(netDebt()).toBeCloseTo(54, 6);

    refundEveryLine(saleId);

    // Pre-fix each line reversed 54 x (30/54) = $30 → −$60 against a $54
    // charge, leaving the client a phantom $6 CREDIT.
    expect(netDebt()).toBeCloseTo(0, 6);
  });

  it("stays exact on an UNDISCOUNTED sale (control — unchanged by the fix)", () => {
    const res = repo.processSale(
      {
        client_id: null,
        items: [
          { product_id: 1, quantity: 1, price: 10 },
          { product_id: 1, quantity: 1, price: 10 },
        ],
        total_amount: 20,
        discount: 0,
        final_amount: 20,
        payment_usd: 20,
        payment_lbp: 0,
        exchange_rate: 30_000,
      },
      1,
    );
    expect(res.success).toBe(true);
    expect(drawer("USD")).toBe(OPENING_USD + 20);

    refundEveryLine(res.id!);

    expect(drawer("USD")).toBe(OPENING_USD);
  });

  it("gives back a HALF-refunded discounted line only its discounted share", () => {
    // ONE line, 2 units @ $10 = $20 pre-discount, $4 discount → $16 tendered.
    // Refunding 1 of the 2 units returns 16 x (10/20) = $8, not 16 x (10/16) = $10.
    const res = repo.processSale(
      {
        client_id: null,
        items: [{ product_id: 1, quantity: 2, price: 10 }],
        total_amount: 20,
        discount: 4,
        final_amount: 16,
        payment_usd: 16,
        payment_lbp: 0,
        exchange_rate: 30_000,
      },
      1,
    );
    expect(res.success).toBe(true);
    const saleId = res.id!;
    const [itemId] = lineIds(saleId);

    repo.refundSaleItem({
      saleId,
      saleItemId: itemId,
      refundQuantity: 1,
      userId: 1,
    });

    expect(drawer("USD")).toBe(OPENING_USD + 8);

    // …and the second unit closes it out to zero.
    repo.refundSaleItem({
      saleId,
      saleItemId: itemId,
      refundQuantity: 1,
      userId: 1,
    });
    expect(drawer("USD")).toBe(OPENING_USD);
  });
});
