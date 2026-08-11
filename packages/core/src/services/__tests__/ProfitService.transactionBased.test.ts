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
 *   (e) cost/price grid-item sales (iPick/Katsh mobile services, WHISH_APP
 *       items) are counted in the summary buckets — guards the 'KATCH' vs
 *       'Katsh' provider-string mismatch that made every Katsh sale's profit
 *       invisible on the Profits overview (the DB CHECK constraint only ever
 *       stores 'Katsh'; SQLite IN is case-sensitive)
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
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT
    );

    CREATE TABLE clients (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT,
      phone_number TEXT
    );

    CREATE TABLE transactions (
      tenant_id INTEGER DEFAULT 1,
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
      reverses_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE sales (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'completed',
      final_amount_usd REAL NOT NULL DEFAULT 0,
      paid_usd REAL NOT NULL DEFAULT 0,
      paid_lbp REAL NOT NULL DEFAULT 0,
      exchange_rate_snapshot REAL NOT NULL DEFAULT 90000,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE sale_items (
      tenant_id INTEGER DEFAULT 1,
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
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT
    );

    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      omt_service_type TEXT,
      currency TEXT NOT NULL DEFAULT 'USD',
      amount REAL NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      commission REAL NOT NULL DEFAULT 0,
      omt_fee REAL,
      payment_method_fee REAL NOT NULL DEFAULT 0,
      is_settled INTEGER NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , refunded_at TEXT DEFAULT NULL);

    CREATE TABLE recharges (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      carrier TEXT NOT NULL,
      recharge_type TEXT NOT NULL DEFAULT 'CREDIT_TRANSFER',
      currency_code TEXT NOT NULL DEFAULT 'USD',
      price REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , refunded_at TEXT DEFAULT NULL);

    CREATE TABLE custom_services (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'completed',
      price_usd REAL NOT NULL DEFAULT 0,
      price_lbp REAL NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      cost_lbp REAL NOT NULL DEFAULT 0,
      profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE maintenance (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'Delivered_Paid',
      final_amount_usd REAL NOT NULL DEFAULT 0,
      final_amount_lbp REAL NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      cost_lbp REAL NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE loto_tickets (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_number TEXT,
      sale_amount REAL NOT NULL DEFAULT 0,
      commission_amount REAL NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE exchange_transactions (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount_in REAL NOT NULL DEFAULT 0,
      leg1_profit_usd REAL,
      leg2_profit_usd REAL,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , refunded_at TEXT DEFAULT NULL);

    CREATE TABLE expenses (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      expense_date TEXT
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

    CREATE TABLE payments (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      method TEXT,
      currency_code TEXT,
      amount REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Referenced by ProfitRepository's notPartnerPending / salePaidOrPartnerSettled
    -- fragments (PFT-6). Left empty: the NOT EXISTS gate then passes every row,
    -- preserving this suite's pre-partner expectations unchanged.
    CREATE TABLE partner_ledger (
      tenant_id INTEGER DEFAULT 1,
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id        INTEGER NOT NULL,
      transaction_type  TEXT,
      reference_table   TEXT,
      reference_id      INTEGER,
      amount            REAL NOT NULL,
      currency          TEXT NOT NULL DEFAULT 'USD',
      direction         TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      notes             TEXT,
      user_id           INTEGER,
      settlement_method TEXT,
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
      covered_amount    REAL NOT NULL DEFAULT 0
    );

    -- Referenced by ProfitRepository's notDebtPending fragment (DBT-1, v129).
    -- Left empty: the NOT EXISTS gate passes every row unchanged.
    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL DEFAULT 0,
      amount_lbp REAL DEFAULT 0,
      transaction_id INTEGER,
      due_date TEXT,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER,
      is_refunded INTEGER DEFAULT 0,
      session_id INTEGER,
      covered_usd REAL NOT NULL DEFAULT 0,
      covered_lbp REAL NOT NULL DEFAULT 0
    , refunded_at TEXT DEFAULT NULL);
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
  userId?: number;
  reversesId?: number;
  createdAt?: string;
}): number {
  const info = db
    .prepare(
      `INSERT INTO transactions (type, status, source_table, source_id, user_id, amount_usd, profit_usd, profit_lbp, reverses_id, created_at)
     VALUES (?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      opts.type,
      opts.sourceTable,
      opts.sourceId,
      opts.userId ?? 1,
      opts.amountUsd ?? 0,
      opts.profitUsd ?? 0,
      opts.profitLbp ?? 0,
      opts.reversesId ?? null,
      opts.createdAt ?? TS,
    );
  return Number(info.lastInsertRowid);
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

  it("nets a cross-day refund at the SALE's original date, not the refund's date", () => {
    // Sale (profit 80) on 2026-03-01; the refund transaction lands on 2026-03-05.
    insertSale({ id: 1, final: 200, paid: 200, status: "refunded" });
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
      createdAt: "2026-03-05 10:00:00",
    });

    const rows = service.getByDate("2026-03-01", "2026-03-05");
    const saleDay = rows.find((r) => r.date === "2026-03-01");
    const refundDay = rows.find((r) => r.date === "2026-03-05");
    // Refund nets at the SALE's date → 2026-03-01 = 80 − 80 = 0 (was 80 pre-fix).
    expect(saleDay?.profit_usd).toBe(0);
    // The refund does NOT land on its own date (was −80 pre-fix).
    expect(refundDay?.profit_usd ?? 0).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (e) Refunded module rows are excluded (profit-audit fix 1)
//
// Void AND refund both set is_refunded = 1 on the module source row
// (TransactionRepository._markSourceRefunded), but no profit query checked it —
// a refunded OMT/recharge/maintenance kept its full revenue AND profit forever.
// ─────────────────────────────────────────────────────────────────────────────

describe("(e) refunded module rows excluded from profit", () => {
  it("a refunded settled financial service drops out of realized commission", () => {
    db.prepare(
      `INSERT INTO financial_services (id, provider, currency, amount, commission, is_settled, is_refunded, created_at)
       VALUES (1, 'OMT', 'USD', 1000, 12, 1, 1, ?)`,
    ).run(TS);
    insertTxn({
      type: "FINANCIAL_SERVICE",
      sourceTable: "financial_services",
      sourceId: 1,
      profitUsd: 12,
      amountUsd: 1000,
    });

    const summary = service.getSummary(FROM, TO);
    expect(summary.financial_services.commission_usd).toBe(0);
    expect(summary.financial_services.revenue_usd).toBe(0);
  });

  it("a refunded unsettled financial service drops out of pending commission", () => {
    db.prepare(
      `INSERT INTO financial_services (id, provider, currency, amount, commission, is_settled, is_refunded, created_at)
       VALUES (1, 'WHISH', 'USD', 500, 7, 0, 1, ?)`,
    ).run(TS);
    insertTxn({
      type: "FINANCIAL_SERVICE",
      sourceTable: "financial_services",
      sourceId: 1,
      profitUsd: 7,
      amountUsd: 500,
    });

    expect(
      service.getSummary(FROM, TO).financial_services.pending_commission_usd,
    ).toBe(0);
  });

  it("a refunded recharge drops out of recharge profit and revenue", () => {
    db.prepare(
      `INSERT INTO recharges (id, carrier, currency_code, price, cost, is_refunded, created_at)
       VALUES (1, 'MTC', 'USD', 10, 8, 1, ?)`,
    ).run(TS);
    insertTxn({
      type: "RECHARGE",
      sourceTable: "recharges",
      sourceId: 1,
      profitUsd: 2,
      amountUsd: 10,
    });

    const summary = service.getSummary(FROM, TO);
    expect(summary.recharges.profit_usd).toBe(0);
    expect(summary.recharges.revenue_usd).toBe(0);
  });

  it("a refunded maintenance job drops out of maintenance profit", () => {
    db.prepare(
      `INSERT INTO maintenance (id, status, final_amount_usd, cost_usd, is_refunded, created_at)
       VALUES (1, 'Delivered_Paid', 100, 70, 1, ?)`,
    ).run(TS);
    insertTxn({
      type: "MAINTENANCE",
      sourceTable: "maintenance",
      sourceId: 1,
      profitUsd: 30,
      amountUsd: 100,
    });

    expect(service.getSummary(FROM, TO).maintenance.profit_usd).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (f) Maintenance LBP profit (profit-audit fix 4)
//
// LBP jobs stamp profit_lbp — summing only the USD columns made every LBP
// maintenance job invisible in the profits views.
// ─────────────────────────────────────────────────────────────────────────────

describe("(f) maintenance LBP profit", () => {
  it("counts LBP maintenance revenue/cost/profit in summary + byModule", () => {
    db.prepare(
      `INSERT INTO maintenance (id, status, final_amount_usd, final_amount_lbp, cost_usd, cost_lbp, created_at)
       VALUES (1, 'Delivered_Paid', 0, 900000, 0, 500000, ?)`,
    ).run(TS);
    insertTxn({
      type: "MAINTENANCE",
      sourceTable: "maintenance",
      sourceId: 1,
      profitLbp: 400000,
    });

    const summary = service.getSummary(FROM, TO);
    expect(summary.maintenance.revenue_lbp).toBe(900000);
    expect(summary.maintenance.cost_lbp).toBe(500000);
    expect(summary.maintenance.profit_lbp).toBe(400000);
    expect(summary.totals.gross_profit_lbp).toBe(400000);

    const row = service
      .getByModule(FROM, TO)
      .find((m) => m.module === "MAINTENANCE");
    expect(row?.profit_lbp).toBe(400000);

    const day = service
      .getByDate("2026-03-01", "2026-03-01")
      .find((r) => r.date === "2026-03-01");
    expect(day?.profit_lbp).toBe(400000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (g) Loto commissions in the profits views (profit-audit fix 5)
//
// Loto stamps its commission as profit_lbp on the LOTO transaction at sale time
// but was entirely absent from every profits view.
// ─────────────────────────────────────────────────────────────────────────────

describe("(g) loto commission in profits", () => {
  it("counts loto ticket commission in summary, byModule and byDate", () => {
    db.prepare(
      `INSERT INTO loto_tickets (id, ticket_number, sale_amount, commission_amount, created_at)
       VALUES (1, 'T-1', 500000, 22250, ?)`,
    ).run(TS);
    insertTxn({
      type: "LOTO",
      sourceTable: "loto_tickets",
      sourceId: 1,
      profitLbp: 22250,
    });

    const summary = service.getSummary(FROM, TO);
    expect(summary.loto.revenue_lbp).toBe(500000);
    expect(summary.loto.profit_lbp).toBe(22250);
    expect(summary.loto.count).toBe(1);
    expect(summary.totals.gross_profit_lbp).toBe(22250);
    expect(summary.totals.gross_revenue_lbp).toBe(500000);

    const row = service.getByModule(FROM, TO).find((m) => m.module === "LOTO");
    expect(row?.profit_lbp).toBe(22250);

    const day = service
      .getByDate("2026-03-01", "2026-03-01")
      .find((r) => r.date === "2026-03-01");
    expect(day?.profit_lbp).toBe(22250);
  });

  it("excludes refunded loto tickets", () => {
    db.prepare(
      `INSERT INTO loto_tickets (id, ticket_number, sale_amount, commission_amount, is_refunded, created_at)
       VALUES (1, 'T-1', 500000, 22250, 1, ?)`,
    ).run(TS);
    insertTxn({
      type: "LOTO",
      sourceTable: "loto_tickets",
      sourceId: 1,
      profitLbp: 22250,
    });

    expect(service.getSummary(FROM, TO).loto.profit_lbp).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (h) Payment-method fees as profit (profit-audit fix 6, hardened by review)
//
// The pmFee is the shop's immediate profit on a wallet payment. It is sourced
// from financial_services.payment_method_fee (NOT raw PM_FEE payment rows) and
// gated by notRefunded — so it counts regardless of is_settled, and a
// refund/void removes it retroactively (no report-boundary self-net bug).
// ─────────────────────────────────────────────────────────────────────────────

describe("(h) payment-method fees in profits", () => {
  it("counts a pending (unsettled) FS's payment_method_fee as immediate profit", () => {
    db.prepare(
      `INSERT INTO financial_services (id, provider, currency, amount, commission, payment_method_fee, is_settled, created_at)
       VALUES (1, 'WHISH', 'USD', 100, 0, 0.5, 0, ?)`,
    ).run(TS);
    insertTxn({
      type: "FINANCIAL_SERVICE",
      sourceTable: "financial_services",
      sourceId: 1,
      amountUsd: 100,
    });

    const summary = service.getSummary(FROM, TO);
    // Not gated by is_settled — realized immediately even while the commission
    // is pending.
    expect(summary.financial_services.pm_fee_usd).toBe(0.5);
    expect(summary.totals.gross_profit_usd).toBe(0.5);

    const row = service
      .getByModule(FROM, TO)
      .find((m) => m.module === "PM_FEE");
    expect(row?.profit_usd).toBe(0.5);
  });

  it("a refunded/voided FS removes its pmFee retroactively (no period-boundary leak)", () => {
    db.prepare(
      `INSERT INTO financial_services (id, provider, currency, amount, commission, payment_method_fee, is_settled, is_refunded, created_at)
       VALUES (1, 'WHISH', 'USD', 100, 0, 0.5, 1, 1, ?)`,
    ).run(TS);
    insertTxn({
      type: "FINANCIAL_SERVICE",
      sourceTable: "financial_services",
      sourceId: 1,
      amountUsd: 100,
    });

    expect(service.getSummary(FROM, TO).financial_services.pm_fee_usd).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (i) By-cashier / by-client corrections (adversarial-review fixes)
//
// The review found getByUser/getByClient (a) hardcoded profit_lbp = 0 (dropping
// loto + LBP-maintenance profit), (b) excluded LOTO from PROFIT_TXN_TYPES, and
// (c) let a refunded UNSETTLED commission fall to the ungated ELSE, posting a
// phantom negative. These guard all three.
// ─────────────────────────────────────────────────────────────────────────────

describe("(i) getByUser / getByClient corrections", () => {
  it("surfaces LBP maintenance profit in getByUser.profit_lbp (was hardcoded 0)", () => {
    db.prepare(
      `INSERT INTO maintenance (id, status, final_amount_lbp, cost_lbp, created_at)
       VALUES (1, 'Delivered_Paid', 900000, 500000, ?)`,
    ).run(TS);
    insertTxn({
      type: "MAINTENANCE",
      sourceTable: "maintenance",
      sourceId: 1,
      profitLbp: 400000,
    });

    const row = service.getByUser(FROM, TO).find((r) => r.user_id === 1);
    expect(row).toBeDefined();
    expect(row?.profit_lbp).toBe(400000);
  });

  it("includes loto commission in getByUser (LOTO now in PROFIT_TXN_TYPES)", () => {
    db.prepare(
      `INSERT INTO loto_tickets (id, ticket_number, sale_amount, commission_amount, created_at)
       VALUES (1, 'T-1', 500000, 22250, ?)`,
    ).run(TS);
    insertTxn({
      type: "LOTO",
      sourceTable: "loto_tickets",
      sourceId: 1,
      profitLbp: 22250,
    });

    const row = service.getByUser(FROM, TO).find((r) => r.user_id === 1);
    expect(row).toBeDefined();
    expect(row?.transaction_count).toBe(1); // loto row is no longer filtered out
    expect(row?.profit_lbp).toBe(22250);
  });

  it("refunding an UNSETTLED commission nets getByUser profit to 0 (no phantom loss)", () => {
    // Pending OMT commission $3 (is_settled=0), stamped profit_usd=3.
    db.prepare(
      `INSERT INTO financial_services (id, provider, currency, amount, commission, is_settled, created_at)
       VALUES (1, 'OMT', 'USD', 1000, 3, 0, ?)`,
    ).run(TS);
    insertTxn({
      type: "FINANCIAL_SERVICE",
      sourceTable: "financial_services",
      sourceId: 1,
      profitUsd: 3,
      amountUsd: 1000,
    });
    // Generic refund stamps a REFUND row (source financial_services) with -3.
    insertTxn({
      type: "REFUND",
      sourceTable: "financial_services",
      sourceId: 1,
      profitUsd: -3,
      amountUsd: -1000,
    });

    const row = service.getByUser(FROM, TO).find((r) => r.user_id === 1);
    // Original gated to 0 (unsettled) AND refund now gated the same way → 0.
    // Pre-fix the refund fell to the ungated ELSE and reported -$3.
    expect(row?.profit_usd).toBe(0);
    expect(row?.revenue_usd).toBe(0);
  });

  it("refunding a SETTLED commission nets getByUser profit to 0", () => {
    db.prepare(
      `INSERT INTO financial_services (id, provider, currency, amount, commission, is_settled, created_at)
       VALUES (1, 'OMT', 'USD', 1000, 3, 1, ?)`,
    ).run(TS);
    insertTxn({
      type: "FINANCIAL_SERVICE",
      sourceTable: "financial_services",
      sourceId: 1,
      profitUsd: 3,
      amountUsd: 1000,
    });
    insertTxn({
      type: "REFUND",
      sourceTable: "financial_services",
      sourceId: 1,
      profitUsd: -3,
      amountUsd: -1000,
    });

    const row = service.getByUser(FROM, TO).find((r) => r.user_id === 1);
    expect(row?.profit_usd).toBe(0); // +3 (settled) + (−3) (settled refund)
  });

  it("attributes a refund's reversal to the ORIGINAL seller, not the refunder", () => {
    db.prepare(`INSERT INTO users (id, username) VALUES (2, 'refunder')`).run();
    insertSale({ id: 1, final: 100, paid: 100, status: "refunded" });
    // Seller = user 1 books the sale (+40).
    const saleTxnId = insertTxn({
      type: "SALE",
      sourceTable: "sales",
      sourceId: 1,
      profitUsd: 40,
      amountUsd: 100,
      userId: 1,
    });
    // Refunder = user 2 clicks refund (−40), reversing the sale.
    insertTxn({
      type: "REFUND",
      sourceTable: "sales",
      sourceId: 1,
      profitUsd: -40,
      amountUsd: -100,
      userId: 2,
      reversesId: saleTxnId,
    });

    const rows = service.getByUser(FROM, TO);
    const seller = rows.find((r) => r.user_id === 1);
    const refunder = rows.find((r) => r.user_id === 2);
    // The reversal lands on the seller → their profit nets to 0 (was +40 pre-fix).
    expect(seller?.profit_usd).toBe(0);
    // The refunder is unaffected (was −40 pre-fix).
    expect(refunder?.profit_usd ?? 0).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (e) Cost/price grid-item sales: mobile bucket (iPick/Katsh) + WHISH_APP items
// ─────────────────────────────────────────────────────────────────────────────

describe("(e) grid-item (cost/price) profit visibility in the summary", () => {
  /**
   * A grid-item sale as FinancialServiceRepository writes it: LBP cost/price
   * row born is_settled = 1, commission = price − cost, and the same margin
   * stamped as profit_lbp on the FINANCIAL_SERVICE transaction.
   */
  function insertGridItem(opts: {
    id: number;
    provider: string;
    price: number;
    cost: number;
  }): void {
    db.prepare(
      `INSERT INTO financial_services (id, provider, currency, amount, price, cost, commission, is_settled, created_at)
       VALUES (?, ?, 'LBP', ?, ?, ?, ?, 1, ?)`,
    ).run(
      opts.id,
      opts.provider,
      opts.price,
      opts.price,
      opts.cost,
      opts.price - opts.cost,
      TS,
    );
    insertTxn({
      type: "FINANCIAL_SERVICE",
      sourceTable: "financial_services",
      sourceId: opts.id,
      profitLbp: opts.price - opts.cost,
    });
  }

  it("counts Katsh AND iPick grid profit in mobile_services and the LBP totals", () => {
    insertGridItem({ id: 1, provider: "Katsh", price: 900_000, cost: 800_000 });
    insertGridItem({ id: 2, provider: "iPick", price: 500_000, cost: 450_000 });

    const summary = service.getSummary(FROM, TO);
    expect(summary.mobile_services.profit_lbp).toBe(150_000);
    expect(summary.mobile_services.revenue_lbp).toBe(1_400_000);
    expect(summary.mobile_services.cost_lbp).toBe(1_250_000);
    expect(summary.mobile_services.count).toBe(2);
    // Mobile providers must NOT leak into the commission bucket (no double count).
    expect(summary.financial_services.commission_lbp).toBe(0);
    expect(summary.totals.gross_profit_lbp).toBe(150_000);
  });

  it("counts a WHISH_APP grid item as realized LBP commission (not pending, not mobile)", () => {
    insertGridItem({
      id: 1,
      provider: "WHISH_APP",
      price: 2_000_000,
      cost: 1_900_000,
    });

    const summary = service.getSummary(FROM, TO);
    expect(summary.financial_services.commission_lbp).toBe(100_000);
    expect(summary.financial_services.revenue_lbp).toBe(2_000_000);
    expect(summary.financial_services.pending_commission_lbp).toBe(0);
    expect(summary.mobile_services.profit_lbp).toBe(0);
    expect(summary.totals.gross_profit_lbp).toBe(100_000);
  });
});

describe("(j) CQ-10 — counterparty discounts in the summary (D1 sign contract)", () => {
  /**
   * CQ-10 wires COUNTERPARTY_DISCOUNT rows into ProfitRepository.
   * getCounterpartyDiscountTotals → ProfitService.getSummary's `discounts`
   * bucket, netted into gross/net profit. This is the sibling frontend
   * agent's exact contract (summary.discounts.{usd,lbp}) — nothing else in
   * this suite creates a COUNTERPARTY_DISCOUNT row, so without this test the
   * query, the assembly, AND the sign convention are all unverified
   * end-to-end (only the ledger-repository unit tests cover the row itself).
   */
  it("a forgiven (given) discount surfaces as NEGATIVE usd/lbp and drops gross/net profit by that amount", () => {
    // Mirrors DebtRepository._postDebtDiscount: forgiving a client's debt is
    // a NEGATIVE profit stamp (D1).
    insertTxn({
      type: "COUNTERPARTY_DISCOUNT",
      sourceTable: "debt_ledger",
      sourceId: 1,
      profitUsd: -30,
      amountUsd: 0,
    });
    // A normal recognized profit source alongside it, so the netting is
    // provably additive rather than the discount being the only row.
    db.prepare(
      `INSERT INTO recharges (id, carrier, currency_code, price, cost, created_at)
       VALUES (1, 'MTC', 'USD', 10, 8, ?)`,
    ).run(TS);
    insertTxn({
      type: "RECHARGE",
      sourceTable: "recharges",
      sourceId: 1,
      profitUsd: 2,
      amountUsd: 10,
    });

    const summary = service.getSummary(FROM, TO);
    expect(summary.discounts.usd).toBeCloseTo(-30, 2);
    expect(summary.discounts.lbp).toBe(0);
    // gross profit = recharge (+2) + discount (-30) = -28
    expect(summary.totals.gross_profit_usd).toBeCloseTo(-28, 2);
    expect(summary.totals.net_profit_usd).toBeCloseTo(-28, 2);
  });

  it("a received (supplier/partner forgives us) discount surfaces as POSITIVE and adds to gross/net profit", () => {
    // Mirrors SupplierRepository._postSupplierDiscount: a supplier forgiving
    // what we owe them is a POSITIVE profit stamp (D1) — a real gain.
    insertTxn({
      type: "COUNTERPARTY_DISCOUNT",
      sourceTable: "supplier_ledger",
      sourceId: 1,
      profitUsd: 15,
      amountUsd: 0,
    });

    const summary = service.getSummary(FROM, TO);
    expect(summary.discounts.usd).toBeCloseTo(15, 2);
    expect(summary.totals.gross_profit_usd).toBeCloseTo(15, 2);
    expect(summary.totals.net_profit_usd).toBeCloseTo(15, 2);
  });

  it("a VOIDED COUNTERPARTY_DISCOUNT row is excluded (status filter, not just type)", () => {
    const id = insertTxn({
      type: "COUNTERPARTY_DISCOUNT",
      sourceTable: "debt_ledger",
      sourceId: 2,
      profitUsd: -50,
      amountUsd: 0,
    });
    db.prepare(`UPDATE transactions SET status = 'VOID' WHERE id = ?`).run(id);

    const summary = service.getSummary(FROM, TO);
    expect(summary.discounts.usd).toBe(0);
    expect(summary.totals.gross_profit_usd).toBe(0);
  });
});
