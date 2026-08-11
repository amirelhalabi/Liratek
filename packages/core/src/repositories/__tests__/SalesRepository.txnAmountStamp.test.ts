/**
 * SalesRepository — unified-transaction amounts carry VALUE, never TENDER
 *
 * Pre-fix, the SALE transaction row stamped the sale's USD value into
 * amount_usd AND the customer's LBP tender (payment_lbp) into amount_lbp —
 * so a $5 sale paid with 450,000 LBP rendered as "$5 + 450,000 LBP" in the
 * audit view and inflated revenue_lbp in profit/session reports (the same $5
 * counted twice). Item-REFUND rows had the same disease by construction:
 * amount_lbp was stamped with the refund's LBP *conversion*.
 *
 * The tender belongs to (and stays in) the payments legs. Migration v126
 * repairs historical rows.
 */

import Database from "better-sqlite3";
import { SalesRepository } from "../SalesRepository.js";
import { resetTransactionRepository } from "../TransactionRepository.js";
import { MIGRATIONS } from "../../db/migrations/index.js";
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
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      name           TEXT NOT NULL,
      cost_price_usd REAL NOT NULL DEFAULT 0,
      stock_quantity INTEGER NOT NULL DEFAULT 0,
      tenant_id      INTEGER NOT NULL DEFAULT 1
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
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance, updated_at) VALUES (1, 'General', 'USD', 500, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance, updated_at) VALUES (1, 'General', 'LBP', 20000000, CURRENT_TIMESTAMP);

    CREATE TABLE debt_ledger (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id        INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd       REAL NOT NULL DEFAULT 0,
      amount_lbp       REAL,
      transaction_id   INTEGER,
      note             TEXT,
      due_date         TEXT,
      created_by       INTEGER,
      tenant_id        INTEGER NOT NULL DEFAULT 1,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);
  `);
  db.prepare(`INSERT INTO users (id, username) VALUES (1, 'cashier')`).run();
  db.prepare(
    `INSERT INTO products (id, name, cost_price_usd, stock_quantity)
     VALUES (1, 'Phone case', 3, 10)`,
  ).run();
  return db;
}

type TxnAmounts = { amount_usd: number; amount_lbp: number };

function stampedTxn(db: Database.Database, type: string): TxnAmounts {
  return db
    .prepare(
      `SELECT amount_usd, amount_lbp FROM transactions WHERE type = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(type) as TxnAmounts;
}

describe("SalesRepository — SALE/REFUND rows stamp value, not tender", () => {
  let db: Database.Database;
  let repo: SalesRepository;

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

  it("LBP-paid sale: SALE row carries the USD value only; the tender stays in the payment legs", () => {
    // $5 sale paid entirely with 450,000 LBP cash @ 90,000.
    const res = repo.processSale(
      {
        client_id: null,
        items: [{ product_id: 1, quantity: 1, price: 5 }],
        total_amount: 5,
        discount: 0,
        final_amount: 5,
        payment_usd: 0,
        payment_lbp: 450_000,
        payments: [{ method: "CASH", currency_code: "LBP", amount: 450_000 }],
        exchange_rate: 90_000,
      },
      1,
    );
    expect(res.success).toBe(true);

    // Pre-fix: amount_lbp = 450,000 → the audit row read "$5 + 450,000 LBP"
    // and revenue_lbp double-counted the sale.
    expect(stampedTxn(db, "SALE")).toEqual({ amount_usd: 5, amount_lbp: 0 });

    // The tender is not lost — it lives in the payments legs.
    const leg = db
      .prepare(
        `SELECT currency_code, amount FROM payments p
         JOIN transactions t ON t.id = p.transaction_id
         WHERE t.type = 'SALE' AND t.source_id = ?`,
      )
      .get(res.id) as { currency_code: string; amount: number };
    expect(leg).toEqual({ currency_code: "LBP", amount: 450_000 });
  });

  it("item refund of an LBP-paid sale: REFUND row carries the negated USD value, no LBP conversion", () => {
    const res = repo.processSale(
      {
        client_id: null,
        items: [{ product_id: 1, quantity: 1, price: 5 }],
        total_amount: 5,
        discount: 0,
        final_amount: 5,
        payment_usd: 0,
        payment_lbp: 450_000,
        payments: [{ method: "CASH", currency_code: "LBP", amount: 450_000 }],
        exchange_rate: 90_000,
      },
      1,
    );
    expect(res.success).toBe(true);
    const saleId = res.id!;
    const itemId = (
      db
        .prepare(`SELECT id FROM sale_items WHERE sale_id = ? LIMIT 1`)
        .get(saleId) as { id: number }
    ).id;

    repo.refundSaleItem({
      saleId,
      saleItemId: itemId,
      refundQuantity: 1,
      userId: 1,
    });

    // Pre-fix: amount_lbp = -(5 × 90,000) = -450,000 alongside amount_usd = -5.
    expect(stampedTxn(db, "REFUND")).toEqual({ amount_usd: -5, amount_lbp: 0 });
  });
});

describe("SalesRepository — discount surfaced in summary/debt note in the tender currency", () => {
  let db: Database.Database;
  let repo: SalesRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetTransactionRepository();
    repo = new SalesRepository();
    db.prepare(
      `INSERT INTO clients (id, full_name, phone_number) VALUES (1, 'Walk In', '70123456')`,
    ).run();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
    resetTenantContext();
  });

  const summaryOf = (saleId: number): string =>
    (
      db
        .prepare(
          `SELECT summary FROM transactions WHERE type = 'SALE' AND source_id = ?`,
        )
        .get(saleId) as { summary: string }
    ).summary;

  it("LBP-paid sale: discount shown converted to LBP", () => {
    // $5 basket, $1 discount → $4 final paid with 360,000 LBP @ 90,000.
    const res = repo.processSale(
      {
        client_id: null,
        items: [{ product_id: 1, quantity: 1, price: 5 }],
        total_amount: 5,
        discount: 1,
        final_amount: 4,
        payment_usd: 0,
        payment_lbp: 360_000,
        payments: [{ method: "CASH", currency_code: "LBP", amount: 360_000 }],
        exchange_rate: 90_000,
      },
      1,
    );
    expect(res.success).toBe(true);
    expect(summaryOf(res.id!)).toContain("(discounted 90,000 LBP)");
  });

  it("USD-paid sale: discount shown in USD", () => {
    const res = repo.processSale(
      {
        client_id: null,
        items: [{ product_id: 1, quantity: 1, price: 5 }],
        total_amount: 5,
        discount: 1,
        final_amount: 4,
        payment_usd: 4,
        payment_lbp: 0,
        payments: [{ method: "CASH", currency_code: "USD", amount: 4 }],
        exchange_rate: 90_000,
      },
      1,
    );
    expect(res.success).toBe(true);
    expect(summaryOf(res.id!)).toContain("(discounted $1)");
  });

  it("split payment: discount follows the FIRST payment row's currency", () => {
    const res = repo.processSale(
      {
        client_id: null,
        items: [{ product_id: 1, quantity: 1, price: 5 }],
        total_amount: 5,
        discount: 1,
        final_amount: 4,
        payment_usd: 2,
        payment_lbp: 180_000,
        payments: [
          { method: "CASH", currency_code: "LBP", amount: 180_000 },
          { method: "CASH", currency_code: "USD", amount: 2 },
        ],
        exchange_rate: 90_000,
      },
      1,
    );
    expect(res.success).toBe(true);
    expect(summaryOf(res.id!)).toContain("(discounted 90,000 LBP)");
  });

  it("debt note carries the discount tail too (partial payment)", () => {
    // $10 basket, $2 discount → $8 final; $4 USD paid, $4 goes to debt.
    const res = repo.processSale(
      {
        client_id: 1,
        items: [{ product_id: 1, quantity: 2, price: 5 }],
        total_amount: 10,
        discount: 2,
        final_amount: 8,
        payment_usd: 4,
        payment_lbp: 0,
        payments: [{ method: "CASH", currency_code: "USD", amount: 4 }],
        exchange_rate: 90_000,
      },
      1,
    );
    expect(res.success).toBe(true);
    const note = (
      db
        .prepare(`SELECT note FROM debt_ledger ORDER BY id DESC LIMIT 1`)
        .get() as { note: string }
    ).note;
    expect(note).toContain("(discounted $2)");
  });

  it("no discount → no tail", () => {
    const res = repo.processSale(
      {
        client_id: null,
        items: [{ product_id: 1, quantity: 1, price: 5 }],
        total_amount: 5,
        discount: 0,
        final_amount: 5,
        payment_usd: 5,
        payment_lbp: 0,
        payments: [{ method: "CASH", currency_code: "USD", amount: 5 }],
        exchange_rate: 90_000,
      },
      1,
    );
    expect(res.success).toBe(true);
    expect(summaryOf(res.id!)).not.toContain("discounted");
  });
});

describe("SalesRepository — sales.paid_* store what was PAID, excluding on-account legs", () => {
  let db: Database.Database;
  let repo: SalesRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetTransactionRepository();
    repo = new SalesRepository();
    db.prepare(
      `INSERT INTO clients (id, full_name, phone_number) VALUES (1, 'Walk In', '70123456')`,
    ).run();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
    resetTenantContext();
  });

  it("fully on-account sale: paid_usd/paid_lbp are 0 and the debt is created", () => {
    // $4 sale charged entirely to the customer's account as 360,000 LBP.
    // Pre-fix the INSERT wrote the raw client sums (which include the
    // on-account leg) into paid_lbp, so the sale was born "fully paid" per
    // the profit gate while simultaneously owing $4 in the debt ledger.
    const res = repo.processSale(
      {
        client_id: 1,
        items: [{ product_id: 1, quantity: 1, price: 4 }],
        total_amount: 4,
        discount: 0,
        final_amount: 4,
        payment_usd: 0,
        payment_lbp: 360_000, // raw client sum — includes the on-account leg
        payments: [
          { method: "CUSTOMER_ACCOUNT", currency_code: "LBP", amount: 360_000 },
        ],
        exchange_rate: 90_000,
      },
      1,
    );
    expect(res.success).toBe(true);

    const sale = db
      .prepare(`SELECT paid_usd, paid_lbp FROM sales WHERE id = ?`)
      .get(res.id) as { paid_usd: number; paid_lbp: number };
    expect(sale).toEqual({ paid_usd: 0, paid_lbp: 0 });

    const debt = db
      .prepare(
        `SELECT amount_usd FROM debt_ledger WHERE transaction_type = 'Sale Debt' ORDER BY id DESC LIMIT 1`,
      )
      .get() as { amount_usd: number } | undefined;
    expect(debt?.amount_usd).toBeCloseTo(4, 2);
  });

  it("cash-paid sale keeps its real paid totals (derived == raw)", () => {
    const res = repo.processSale(
      {
        client_id: null,
        items: [{ product_id: 1, quantity: 1, price: 5 }],
        total_amount: 5,
        discount: 0,
        final_amount: 5,
        payment_usd: 0,
        payment_lbp: 450_000,
        payments: [{ method: "CASH", currency_code: "LBP", amount: 450_000 }],
        exchange_rate: 90_000,
      },
      1,
    );
    expect(res.success).toBe(true);
    const sale = db
      .prepare(`SELECT paid_usd, paid_lbp FROM sales WHERE id = ?`)
      .get(res.id) as { paid_usd: number; paid_lbp: number };
    expect(sale).toEqual({ paid_usd: 0, paid_lbp: 450_000 });
  });
});

describe("migration v126 — repairs historical double-stamped sales rows", () => {
  it("zeroes amount_lbp on sales SALE/REFUND rows only, and only when amount_usd is present", () => {
    const db = createTestDb();
    const insert = db.prepare(
      `INSERT INTO transactions (type, source_table, source_id, amount_usd, amount_lbp)
       VALUES (?, ?, ?, ?, ?)`,
    );
    insert.run("SALE", "sales", 1, 5, 450_000); // double-stamped → repair
    insert.run("REFUND", "sales", 1, -5, -450_000); // double-stamped → repair
    insert.run("SALE", "sales", 2, 0, 900_000); // legacy LBP-only value → keep
    insert.run("RECHARGE", "recharges", 1, 0, 450_000); // LBP-denominated, other module → keep

    const v126 = MIGRATIONS.find((m) => m.version === 126);
    expect(v126).toBeDefined();
    v126!.up(db);

    const rows = db
      .prepare(
        `SELECT type, source_table, amount_usd, amount_lbp FROM transactions ORDER BY id`,
      )
      .all() as {
      type: string;
      source_table: string;
      amount_usd: number;
      amount_lbp: number;
    }[];
    expect(rows).toEqual([
      { type: "SALE", source_table: "sales", amount_usd: 5, amount_lbp: 0 },
      { type: "REFUND", source_table: "sales", amount_usd: -5, amount_lbp: 0 },
      {
        type: "SALE",
        source_table: "sales",
        amount_usd: 0,
        amount_lbp: 900_000,
      },
      {
        type: "RECHARGE",
        source_table: "recharges",
        amount_usd: 0,
        amount_lbp: 450_000,
      },
    ]);
    db.close();
  });
});
