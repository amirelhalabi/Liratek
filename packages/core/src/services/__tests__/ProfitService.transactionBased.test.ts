/**
 * ProfitService — transaction-based profit refactor (parity + correctness)
 *
 * Verifies the unified-ledger profit sourcing across getSummary / getByModule /
 * getByDate, using a REAL in-memory better-sqlite3 database (not a mock), so the
 * actual SQL is exercised end-to-end.
 *
 * Covers:
 *   (a) a completed + fully-paid sale with known profit shows that profit in
 *       getSummary.sales and getByModule (SALE row)
 *   (b) after refunding part of it, getSummary.sales profit drops by exactly the
 *       refunded profit (REFUND row's negative profit nets the original SALE)
 *   (c) a financial is_settled = 1 row's commission shows as realized profit, and
 *       is_settled = 0 shows as pending (not realized)
 *   (d) recharge / custom / maintenance profit equals what is stamped on the
 *       transaction (price − cost), sourced from transactions.profit_usd/lbp
 */

import Database from "better-sqlite3";
import { ProfitService, resetProfitService } from "../ProfitService.js";

// All rows live inside the all-time range used by every assertion.
const FROM = "2000-01-01";
const TO = "2100-12-31";
const TS = "2026-03-01 10:00:00";

interface TestDb extends Database.Database {}

let db: TestDb;
let service: ProfitService;

function createSchema(d: TestDb): void {
  d.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT
    );

    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT,
      phone_number TEXT
    );

    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL DEFAULT 1,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0,
      summary TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'completed',
      final_amount_usd REAL NOT NULL DEFAULT 0,
      paid_usd REAL NOT NULL DEFAULT 0,
      paid_lbp REAL NOT NULL DEFAULT 0,
      exchange_rate_snapshot REAL NOT NULL DEFAULT 90000,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      product_id INTEGER,
      quantity INTEGER NOT NULL DEFAULT 1,
      sold_price_usd REAL NOT NULL DEFAULT 0,
      cost_price_snapshot_usd REAL NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_quantity INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT
    );

    CREATE TABLE financial_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      omt_service_type TEXT,
      currency TEXT NOT NULL DEFAULT 'USD',
      amount REAL NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      commission REAL NOT NULL DEFAULT 0,
      omt_fee REAL,
      is_settled INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE recharges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      carrier TEXT NOT NULL,
      recharge_type TEXT NOT NULL DEFAULT 'CREDIT_TRANSFER',
      currency_code TEXT NOT NULL DEFAULT 'USD',
      price REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE custom_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'completed',
      price_usd REAL NOT NULL DEFAULT 0,
      price_lbp REAL NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      cost_lbp REAL NOT NULL DEFAULT 0,
      profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE maintenance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'Delivered_Paid',
      final_amount_usd REAL NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE exchange_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount_in REAL NOT NULL DEFAULT 0,
      leg1_profit_usd REAL,
      leg2_profit_usd REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      expense_date TEXT
    );

    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      method TEXT,
      currency_code TEXT,
      amount REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  d.prepare(`INSERT INTO users (id, username) VALUES (1, 'cashier')`).run();
}

// ── Insert helpers ────────────────────────────────────────────────────────────

function insertSale(opts: {
  id: number;
  final: number;
  paid: number;
  status?: string;
}): void {
  db.prepare(
    `INSERT INTO sales (id, status, final_amount_usd, paid_usd, paid_lbp, exchange_rate_snapshot, created_at)
     VALUES (?, ?, ?, ?, 0, 90000, ?)`,
  ).run(opts.id, opts.status ?? "completed", opts.final, opts.paid, TS);
}

function insertSaleItem(opts: {
  saleId: number;
  qty: number;
  price: number;
  cost: number;
  isRefunded?: number;
  refundedQty?: number;
}): void {
  db.prepare(
    `INSERT INTO sale_items (sale_id, product_id, quantity, sold_price_usd, cost_price_snapshot_usd, is_refunded, refunded_quantity)
     VALUES (?, 1, ?, ?, ?, ?, ?)`,
  ).run(
    opts.saleId,
    opts.qty,
    opts.price,
    opts.cost,
    opts.isRefunded ?? 0,
    opts.refundedQty ?? 0,
  );
}

function insertTxn(opts: {
  type: string;
  sourceTable: string;
  sourceId: number;
  profitUsd?: number;
  profitLbp?: number;
  amountUsd?: number;
}): void {
  db.prepare(
    `INSERT INTO transactions (type, status, source_table, source_id, user_id, amount_usd, profit_usd, profit_lbp, created_at)
     VALUES (?, 'ACTIVE', ?, ?, 1, ?, ?, ?, ?)`,
  ).run(
    opts.type,
    opts.sourceTable,
    opts.sourceId,
    opts.amountUsd ?? 0,
    opts.profitUsd ?? 0,
    opts.profitLbp ?? 0,
    TS,
  );
}

beforeEach(() => {
  db = new Database(":memory:") as TestDb;
  createSchema(db);
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  resetProfitService();
  service = new ProfitService();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// (a) Completed + fully-paid sale → known profit in getSummary + getByModule
// ─────────────────────────────────────────────────────────────────────────────

describe("(a) paid sale profit from the unified ledger", () => {
  it("shows the SALE transaction profit in getSummary.sales and getByModule", () => {
    // 2 units @ price 100 cost 60 → profit 80, revenue 200, cost 120.
    insertSale({ id: 1, final: 200, paid: 200 });
    insertSaleItem({ saleId: 1, qty: 2, price: 100, cost: 60 });
    insertTxn({
      type: "SALE",
      sourceTable: "sales",
      sourceId: 1,
      profitUsd: 80,
      amountUsd: 200,
    });

    const summary = service.getSummary(FROM, TO);
    expect(summary.sales.revenue_usd).toBe(200);
    expect(summary.sales.cost_usd).toBe(120);
    expect(summary.sales.profit_usd).toBe(80);
    expect(summary.sales.count).toBe(1);

    const byModule = service.getByModule(FROM, TO);
    const saleRow = byModule.find((m) => m.module === "SALE");
    expect(saleRow).toBeDefined();
    expect(saleRow?.profit_usd).toBe(80);
    expect(saleRow?.revenue_usd).toBe(200);
  });

  it("excludes unpaid (debt) sales from realized profit via the paid gate", () => {
    insertSale({ id: 1, final: 200, paid: 0 }); // debt — not paid
    insertSaleItem({ saleId: 1, qty: 2, price: 100, cost: 60 });
    insertTxn({
      type: "SALE",
      sourceTable: "sales",
      sourceId: 1,
      profitUsd: 80,
      amountUsd: 200,
    });

    const summary = service.getSummary(FROM, TO);
    expect(summary.sales.profit_usd).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) Partial refund → sales profit drops by exactly the refunded profit
// ─────────────────────────────────────────────────────────────────────────────

describe("(b) REFUND netting", () => {
  it("drops getSummary.sales profit by exactly the refunded profit", () => {
    insertSale({ id: 1, final: 200, paid: 200 });
    insertSaleItem({ saleId: 1, qty: 2, price: 100, cost: 60 });
    insertTxn({
      type: "SALE",
      sourceTable: "sales",
      sourceId: 1,
      profitUsd: 80,
      amountUsd: 200,
    });

    const before = service.getSummary(FROM, TO).sales.profit_usd;
    expect(before).toBe(80);

    // Refund 1 of the 2 units → refunded profit = (100 - 60) * 1 = 40.
    // The REFUND transaction stamps profit_usd = -40.
    insertTxn({
      type: "REFUND",
      sourceTable: "sales",
      sourceId: 1,
      profitUsd: -40,
      amountUsd: -100,
    });

    const after = service.getSummary(FROM, TO).sales.profit_usd;
    expect(after).toBe(40);
    expect(before - after).toBe(40);

    // getByModule SALE row reflects the same net.
    const saleRow = service
      .getByModule(FROM, TO)
      .find((m) => m.module === "SALE");
    expect(saleRow?.profit_usd).toBe(40);
  });

  it("nets fully-refunded sales to zero profit (SALE + REFUND = 0)", () => {
    insertSale({ id: 1, final: 200, paid: 200, status: "refunded" });
    // Both units refunded → item flagged is_refunded for revenue/cost exclusion.
    insertSaleItem({
      saleId: 1,
      qty: 2,
      price: 100,
      cost: 60,
      isRefunded: 1,
      refundedQty: 2,
    });
    insertTxn({
      type: "SALE",
      sourceTable: "sales",
      sourceId: 1,
      profitUsd: 80,
      amountUsd: 200,
    });
    insertTxn({
      type: "REFUND",
      sourceTable: "sales",
      sourceId: 1,
      profitUsd: -80,
      amountUsd: -200,
    });

    expect(service.getSummary(FROM, TO).sales.profit_usd).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) Financial commission realized vs pending
// ─────────────────────────────────────────────────────────────────────────────

describe("(c) financial commission realized vs pending", () => {
  function insertFinancial(opts: {
    id: number;
    provider: string;
    currency?: string;
    amount: number;
    commission: number;
    isSettled: number;
  }): void {
    db.prepare(
      `INSERT INTO financial_services (id, provider, currency, amount, price, cost, commission, is_settled, created_at)
       VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?)`,
    ).run(
      opts.id,
      opts.provider,
      opts.currency ?? "USD",
      opts.amount,
      opts.commission,
      opts.isSettled,
      TS,
    );
    insertTxn({
      type: "FINANCIAL_SERVICE",
      sourceTable: "financial_services",
      sourceId: opts.id,
      profitUsd: opts.currency === "LBP" ? 0 : opts.commission,
      profitLbp: opts.currency === "LBP" ? opts.commission : 0,
      amountUsd: opts.amount,
    });
  }

  it("settled commission → realized profit; unsettled → pending (not realized)", () => {
    insertFinancial({
      id: 1,
      provider: "OMT",
      amount: 1000,
      commission: 12,
      isSettled: 1,
    });
    insertFinancial({
      id: 2,
      provider: "WHISH",
      amount: 500,
      commission: 7,
      isSettled: 0,
    });

    const summary = service.getSummary(FROM, TO);
    // Realized commission only counts the settled row.
    expect(summary.financial_services.commission_usd).toBe(12);
    // Pending commission counts the unsettled row, kept out of realized.
    expect(summary.financial_services.pending_commission_usd).toBe(7);

    // getByModule shows realized provider profit only (is_settled = 1).
    const byModule = service.getByModule(FROM, TO);
    const omt = byModule.find((m) => m.module === "FINANCIAL_SERVICE_OMT");
    const whish = byModule.find((m) => m.module === "FINANCIAL_SERVICE_WHISH");
    expect(omt?.profit_usd).toBe(12);
    expect(whish).toBeUndefined(); // unsettled → not in realized module breakdown
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (d) Recharge / custom / maintenance profit from transactions (price − cost)
// ─────────────────────────────────────────────────────────────────────────────

describe("(d) recharge / custom / maintenance profit from transactions", () => {
  it("recharge profit equals the stamped transaction profit", () => {
    db.prepare(
      `INSERT INTO recharges (id, carrier, currency_code, price, cost, created_at)
       VALUES (1, 'MTC', 'USD', 10, 8, ?)`,
    ).run(TS);
    insertTxn({
      type: "RECHARGE",
      sourceTable: "recharges",
      sourceId: 1,
      profitUsd: 2, // price - cost
      amountUsd: 10,
    });

    const summary = service.getSummary(FROM, TO);
    expect(summary.recharges.revenue_usd).toBe(10);
    expect(summary.recharges.cost_usd).toBe(8);
    expect(summary.recharges.profit_usd).toBe(2);

    const row = service
      .getByModule(FROM, TO)
      .find((m) => m.module === "RECHARGE_MTC");
    expect(row?.profit_usd).toBe(2);
  });

  it("custom service profit equals the stamped transaction profit", () => {
    db.prepare(
      `INSERT INTO custom_services (id, status, price_usd, cost_usd, profit_usd, created_at)
       VALUES (1, 'completed', 50, 30, 999, ?)`,
    ).run(TS); // source-table profit_usd=999 is intentionally wrong — must be ignored
    insertTxn({
      type: "CUSTOM_SERVICE",
      sourceTable: "custom_services",
      sourceId: 1,
      profitUsd: 20, // the real (price - cost) profit lives on the transaction
      amountUsd: 50,
    });

    const summary = service.getSummary(FROM, TO);
    expect(summary.custom_services.revenue_usd).toBe(50);
    expect(summary.custom_services.cost_usd).toBe(30);
    expect(summary.custom_services.profit_usd).toBe(20); // from transactions, not 999
  });

  it("maintenance profit equals the stamped transaction profit (B5: real Delivered_Paid status)", () => {
    // The app's workflow statuses are Received/In_Progress/Ready/Delivered/
    // Delivered_Paid — the old predicate matched only a fictional 'completed',
    // so maintenance profit was ALWAYS zero (and this test used to seed that
    // fictional status, hiding the bug).
    db.prepare(
      `INSERT INTO maintenance (id, status, final_amount_usd, cost_usd, created_at)
       VALUES (1, 'Delivered_Paid', 100, 70, ?)`,
    ).run(TS);
    insertTxn({
      type: "MAINTENANCE",
      sourceTable: "maintenance",
      sourceId: 1,
      profitUsd: 30,
      amountUsd: 100,
    });

    const summary = service.getSummary(FROM, TO);
    expect(summary.maintenance.revenue_usd).toBe(100);
    expect(summary.maintenance.cost_usd).toBe(70);
    expect(summary.maintenance.profit_usd).toBe(30);

    const row = service
      .getByModule(FROM, TO)
      .find((m) => m.module === "MAINTENANCE");
    expect(row?.profit_usd).toBe(30);
  });

  it("maintenance not yet delivered does NOT count as realized profit", () => {
    db.prepare(
      `INSERT INTO maintenance (id, status, final_amount_usd, cost_usd, created_at)
       VALUES (2, 'In_Progress', 60, 40, ?)`,
    ).run(TS);
    insertTxn({
      type: "MAINTENANCE",
      sourceTable: "maintenance",
      sourceId: 2,
      profitUsd: 20,
      amountUsd: 60,
    });

    expect(service.getSummary(FROM, TO).maintenance.profit_usd).toBe(0);
  });

  it("recharge teshriji (CREDIT_TRANSFER) profit counts in the recharge tab (B5)", () => {
    db.prepare(
      `INSERT INTO recharges (id, carrier, recharge_type, currency_code, price, cost, created_at)
       VALUES (2, 'MTC', 'CREDIT_TRANSFER', 'USD', 3.5, 3, ?)`,
    ).run(TS);
    insertTxn({
      type: "RECHARGE",
      sourceTable: "recharges",
      sourceId: 2,
      profitUsd: 0.34, // (price - cost) - 1 SMS × $0.16, as stamped at sale time
      amountUsd: 3.5,
    });

    const summary = service.getSummary(FROM, TO);
    expect(summary.recharges.profit_usd).toBeCloseTo(0.34, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getByDate parity — daily profit reflects unified-ledger + REFUND netting
// ─────────────────────────────────────────────────────────────────────────────

describe("getByDate transaction-based profit + refund netting", () => {
  it("daily sales profit nets a same-day refund", () => {
    insertSale({ id: 1, final: 200, paid: 200 });
    insertSaleItem({ saleId: 1, qty: 2, price: 100, cost: 60 });
    insertTxn({
      type: "SALE",
      sourceTable: "sales",
      sourceId: 1,
      profitUsd: 80,
      amountUsd: 200,
    });
    insertTxn({
      type: "REFUND",
      sourceTable: "sales",
      sourceId: 1,
      profitUsd: -40,
      amountUsd: -100,
    });

    const rows = service.getByDate("2026-03-01", "2026-03-01");
    const day = rows.find((r) => r.date === "2026-03-01");
    expect(day).toBeDefined();
    expect(day?.profit_usd).toBe(40); // 80 - 40
  });
});
