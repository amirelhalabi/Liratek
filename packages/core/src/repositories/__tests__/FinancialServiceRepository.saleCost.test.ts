/**
 * FinancialServiceRepository — Sale-cost supplier ledger (LIRA-061)
 *
 * Regression coverage for the bug where a SALE through a cost/price provider
 * (Katsh / iPick, and the SEND side of Whish App / OMT App) auto-wrote a
 * `TOP_UP` entry into the supplier ledger — indistinguishable from a manual
 * supplier top-up, and never reconcilable through the Settle tab.
 *
 * After the fix:
 *   1. Cost/price-flow SEND books a distinctly-labeled `SALE_COST` ledger entry
 *      (never `TOP_UP`), with the same positive balance sign so the owed balance
 *      stays mathematically correct (no double counting).
 *   2. These rows surface in getUnsettledBySupplier() projected so the Settle tab
 *      nets correctly (amount = cost, commission = 0), and settleTransactions()
 *      nets the SALE_COST entry to zero.
 *   3. A cumulative-balance pay-down (PAYMENT) also reconciles them.
 *
 * All tests run against an in-memory SQLite database. DebtService is mocked.
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import { SupplierRepository } from "../SupplierRepository";

// ─── Mock DB connection (shared by all sub-repositories) ─────────────────────

jest.mock("../../db/connection", () => {
  let _db: Database.Database | null = null;
  return {
    getDatabase: () => {
      if (!_db) throw new Error("Test DB not initialized");
      return _db;
    },
    setDb: (db: Database.Database) => {
      _db = db;
    },
  };
});

// ─── Mock DebtService (CUSTOMER_ACCOUNT cashout / on-account only) ────────────

const mockAddCredit = jest.fn();
jest.mock("../../services/DebtService", () => ({
  getDebtService: () => ({ addCredit: mockAddCredit }),
  resetDebtService: jest.fn(),
}));

// ─── In-memory schema ────────────────────────────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE users (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO users (id, username) VALUES (1, 'admin');

    CREATE TABLE clients (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name    TEXT NOT NULL,
      phone_number TEXT,
      balance_usd  REAL DEFAULT 0,
      balance_lbp  REAL DEFAULT 0,
      notes        TEXT,
      whatsapp_opt_in INTEGER DEFAULT 0,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE financial_services (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      provider              TEXT NOT NULL,
      service_type          TEXT NOT NULL,
      amount                REAL NOT NULL,
      currency              TEXT DEFAULT 'USD' NOT NULL,
      commission            REAL DEFAULT 0,
      cost                  REAL DEFAULT 0,
      price                 REAL DEFAULT 0,
      paid_by               TEXT DEFAULT 'CASH',
      client_id             INTEGER REFERENCES clients(id),
      client_name           TEXT,
      reference_number      TEXT,
      phone_number          TEXT,
      omt_service_type      TEXT,
      omt_fee               REAL DEFAULT 0,
      whish_fee             REAL DEFAULT 0,
      profit_rate           REAL,
      pay_fee               INTEGER DEFAULT 0,
      payment_method_fee    REAL DEFAULT 0,
      payment_method_fee_rate REAL,
      item_key              TEXT,
      note                  TEXT,
      sender_name           TEXT,
      sender_phone          TEXT,
      receiver_name         TEXT,
      receiver_phone        TEXT,
      sender_client_id      INTEGER,
      receiver_client_id    INTEGER,
      is_settled            INTEGER NOT NULL DEFAULT 1,
      settled_at            TEXT,
      settlement_id         INTEGER,
      created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by            INTEGER,
      edited_by             TEXT,
      edited_at             TEXT,
      paid_amount           REAL DEFAULT NULL,
      paid_currency         TEXT DEFAULT NULL,
      partner_id            INTEGER,
      partner_mode          TEXT
    );

    CREATE TABLE transactions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      type         TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id    INTEGER NOT NULL,
      user_id      INTEGER NOT NULL DEFAULT 1,
      amount_usd   REAL NOT NULL DEFAULT 0,
      amount_lbp   REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id    INTEGER,
      client_name  TEXT,
      client_phone TEXT,
      reverses_id  INTEGER,
      profit_usd   REAL NOT NULL DEFAULT 0,
      profit_lbp   REAL NOT NULL DEFAULT 0,
      summary      TEXT,
      metadata_json TEXT,
      device_id    TEXT,
      transaction_time DATETIME,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      method         TEXT NOT NULL,
      drawer_name    TEXT NOT NULL,
      currency_code  TEXT NOT NULL,
      amount         REAL NOT NULL,
      note           TEXT,
      created_by     INTEGER,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      drawer_name   TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance       REAL NOT NULL DEFAULT 0,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (drawer_name, currency_code)
    );

    CREATE TABLE suppliers (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      contact_name TEXT,
      phone        TEXT,
      note         TEXT,
      is_active    INTEGER NOT NULL DEFAULT 1,
      module_key   TEXT,
      provider     TEXT,
      is_system    INTEGER NOT NULL DEFAULT 0,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- supplier_ledger WITH the post-v99 CHECK that includes SALE_COST
    CREATE TABLE supplier_ledger (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id   INTEGER NOT NULL,
      entry_type    TEXT NOT NULL CHECK(entry_type IN ('TOP_UP','SALE_COST','PAYMENT','ADJUSTMENT','SETTLEMENT','CASH_PRIZE')),
      amount_usd    REAL NOT NULL DEFAULT 0,
      amount_lbp    REAL NOT NULL DEFAULT 0,
      note          TEXT,
      created_by    INTEGER,
      transaction_id INTEGER,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Provider drawers for the cost/price flow
    INSERT INTO drawer_balances VALUES ('General', 'USD',  1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES ('General', 'LBP',     0, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES ('Katsh',   'USD',   500, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES ('Katsh',   'LBP',     0, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES ('iPick',   'USD',   500, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES ('iPick',   'LBP',     0, CURRENT_TIMESTAMP);
  `);

  return db;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seedSupplier(db: Database.Database, provider: string): number {
  return Number(
    db
      .prepare(
        "INSERT INTO suppliers (name, provider, is_active, is_system) VALUES (?, ?, 1, 1)",
      )
      .run(`${provider} Supplier`, provider).lastInsertRowid,
  );
}

function ledgerRows(
  db: Database.Database,
  supplierId: number,
): Array<{
  entry_type: string;
  amount_usd: number;
  amount_lbp: number;
  note: string | null;
}> {
  return db
    .prepare(
      "SELECT entry_type, amount_usd, amount_lbp, note FROM supplier_ledger WHERE supplier_id = ? ORDER BY id ASC",
    )
    .all(supplierId) as Array<{
    entry_type: string;
    amount_usd: number;
    amount_lbp: number;
    note: string | null;
  }>;
}

function balanceUsd(db: Database.Database, supplierId: number): number {
  const row = db
    .prepare(
      "SELECT COALESCE(SUM(amount_usd), 0) AS total FROM supplier_ledger WHERE supplier_id = ?",
    )
    .get(supplierId) as { total: number };
  return row.total;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("FinancialServiceRepository — cost/price SEND books SALE_COST (LIRA-061)", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;
  let supplierRepo: SupplierRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    repo = new FinancialServiceRepository();
    supplierRepo = new SupplierRepository();
    mockAddCredit.mockClear();
  });

  afterEach(() => {
    db.close();
  });

  // ── Katsh SEND ───────────────────────────────────────────────────────────

  it("Katsh SEND books a SALE_COST ledger entry (not TOP_UP)", () => {
    const supplierId = seedSupplier(db, "Katsh");

    // cost $90 from Katsh balance, price $100 to customer → $10 profit
    repo.createTransaction({
      provider: "Katsh",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 0,
      cost: 90,
      price: 100,
      paidByMethod: "CASH",
    });

    const rows = ledgerRows(db, supplierId);
    expect(rows).toHaveLength(1);
    expect(rows[0].entry_type).toBe("SALE_COST");
    // NEVER the old TOP_UP label
    expect(rows[0].entry_type).not.toBe("TOP_UP");
  });

  it("SALE_COST amount equals the sale cost and increases what's owed (positive sign)", () => {
    const supplierId = seedSupplier(db, "Katsh");

    repo.createTransaction({
      provider: "Katsh",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 0,
      cost: 90,
      price: 100,
      paidByMethod: "CASH",
    });

    const rows = ledgerRows(db, supplierId);
    expect(rows[0].amount_usd).toBeCloseTo(90, 2); // owes the COST, not the price/amount
    expect(rows[0].amount_lbp).toBe(0);
    // Owed balance increases by exactly the cost — no double counting
    expect(balanceUsd(db, supplierId)).toBeCloseTo(90, 2);
  });

  // ── iPick SEND ───────────────────────────────────────────────────────────

  it("iPick SEND also books a SALE_COST entry for its cost", () => {
    const supplierId = seedSupplier(db, "iPick");

    repo.createTransaction({
      provider: "iPick",
      serviceType: "SEND",
      amount: 50,
      currency: "USD",
      commission: 0,
      cost: 45,
      price: 50,
      paidByMethod: "CASH",
    });

    const rows = ledgerRows(db, supplierId);
    expect(rows).toHaveLength(1);
    expect(rows[0].entry_type).toBe("SALE_COST");
    expect(rows[0].amount_usd).toBeCloseTo(45, 2);
    expect(balanceUsd(db, supplierId)).toBeCloseTo(45, 2);
  });

  it("an LBP cost/price SEND records the cost in amount_lbp", () => {
    const supplierId = seedSupplier(db, "Katsh");

    repo.createTransaction({
      provider: "Katsh",
      serviceType: "SEND",
      amount: 1_000_000,
      currency: "LBP",
      commission: 0,
      cost: 900_000,
      price: 1_000_000,
      paidByMethod: "CASH",
    });

    const rows = ledgerRows(db, supplierId);
    expect(rows[0].entry_type).toBe("SALE_COST");
    expect(rows[0].amount_lbp).toBeCloseTo(900_000, 0);
    expect(rows[0].amount_usd).toBe(0);
  });

  // ── getUnsettledBySupplier surfaces the sale-cost row ──────────────────────

  it("surfaces the cost/price SEND in getUnsettledBySupplier projected as amount=cost, commission=0", () => {
    seedSupplier(db, "Katsh");

    repo.createTransaction({
      provider: "Katsh",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 0,
      cost: 90,
      price: 100,
      paidByMethod: "CASH",
    });

    const unsettled = repo.getUnsettledBySupplier("Katsh");
    expect(unsettled).toHaveLength(1);
    // Projected so the Settle tab's "owed = amount + commission, net = owed - commission"
    // resolves to net = cost = 90.
    expect(unsettled[0].amount).toBeCloseTo(90, 2);
    expect(unsettled[0].commission).toBe(0);
    expect(unsettled[0].cost).toBeCloseTo(90, 2);
    expect(unsettled[0].service_type).toBe("SEND");
  });

  it("does NOT surface a settled sale-cost row again (settlement_id stamped)", () => {
    seedSupplier(db, "Katsh");

    repo.createTransaction({
      provider: "Katsh",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 0,
      cost: 90,
      price: 100,
      paidByMethod: "CASH",
    });

    // Manually stamp settlement_id to simulate it being settled
    db.prepare(
      "UPDATE financial_services SET settlement_id = 999 WHERE provider = 'Katsh'",
    ).run();

    expect(repo.getUnsettledBySupplier("Katsh")).toHaveLength(0);
  });
});

// ─── Settle / pay-down path ─────────────────────────────────────────────────

describe("Sale-cost reconciliation paths (LIRA-061)", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;
  let supplierRepo: SupplierRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    repo = new FinancialServiceRepository();
    supplierRepo = new SupplierRepository();
    mockAddCredit.mockClear();
  });

  afterEach(() => {
    db.close();
  });

  it("per-transaction settle nets the SALE_COST entry to zero and stamps settlement_id", () => {
    const supplierId = seedSupplier(db, "Katsh");

    repo.createTransaction({
      provider: "Katsh",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 0,
      cost: 90,
      price: 100,
      paidByMethod: "CASH",
    });

    // Owed before settling = +90
    expect(balanceUsd(db, supplierId)).toBeCloseTo(90, 2);

    const unsettled = repo.getUnsettledBySupplier("Katsh");
    expect(unsettled).toHaveLength(1);
    const fsId = unsettled[0].id;

    // Settle: net pay = cost = 90, no commission
    supplierRepo.settleTransactions({
      supplier_id: supplierId,
      financial_service_ids: [fsId],
      amount_usd: 90,
      amount_lbp: 0,
      commission_usd: 0,
      commission_lbp: 0,
      drawer_name: "General",
      created_by: 1,
      note: "Settle Katsh sale cost",
    });

    // SETTLEMENT (-90) nets the SALE_COST (+90) to zero
    expect(balanceUsd(db, supplierId)).toBeCloseTo(0, 4);

    // financial_services row now carries a settlement_id and won't resurface
    const fs = db
      .prepare(
        "SELECT is_settled, settlement_id FROM financial_services WHERE id = ?",
      )
      .get(fsId) as { is_settled: number; settlement_id: number | null };
    expect(fs.settlement_id).not.toBeNull();
    expect(repo.getUnsettledBySupplier("Katsh")).toHaveLength(0);
  });

  it("cumulative-balance pay-down (PAYMENT) reconciles the SALE_COST balance to zero", () => {
    const supplierId = seedSupplier(db, "iPick");

    repo.createTransaction({
      provider: "iPick",
      serviceType: "SEND",
      amount: 60,
      currency: "USD",
      commission: 0,
      cost: 55,
      price: 60,
      paidByMethod: "CASH",
    });

    expect(balanceUsd(db, supplierId)).toBeCloseTo(55, 2);

    // Pay the supplier $55 out of the iPick drawer
    supplierRepo.addLedgerEntry({
      supplier_id: supplierId,
      entry_type: "PAYMENT",
      amount_usd: 55,
      amount_lbp: 0,
      drawer_name: "iPick",
      created_by: 1,
      note: "Pay down iPick sale costs",
    });

    // PAYMENT stored as -55 → balance nets to zero
    expect(balanceUsd(db, supplierId)).toBeCloseTo(0, 4);

    const payment = db
      .prepare(
        "SELECT amount_usd FROM supplier_ledger WHERE supplier_id = ? AND entry_type = 'PAYMENT'",
      )
      .get(supplierId) as { amount_usd: number };
    expect(payment.amount_usd).toBeCloseTo(-55, 2);
  });

  it("multiple sale costs accumulate then settle together with no double counting", () => {
    const supplierId = seedSupplier(db, "Katsh");

    repo.createTransaction({
      provider: "Katsh",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 0,
      cost: 90,
      price: 100,
      paidByMethod: "CASH",
    });
    repo.createTransaction({
      provider: "Katsh",
      serviceType: "SEND",
      amount: 30,
      currency: "USD",
      commission: 0,
      cost: 25,
      price: 30,
      paidByMethod: "CASH",
    });

    // Owed = 90 + 25 = 115
    expect(balanceUsd(db, supplierId)).toBeCloseTo(115, 2);

    const unsettled = repo.getUnsettledBySupplier("Katsh");
    expect(unsettled).toHaveLength(2);
    const ids = unsettled.map((u) => u.id);
    const netPay = unsettled.reduce((s, u) => s + u.amount, 0); // 90 + 25

    supplierRepo.settleTransactions({
      supplier_id: supplierId,
      financial_service_ids: ids,
      amount_usd: netPay,
      amount_lbp: 0,
      commission_usd: 0,
      commission_lbp: 0,
      drawer_name: "General",
      created_by: 1,
    });

    expect(balanceUsd(db, supplierId)).toBeCloseTo(0, 4);
    expect(repo.getUnsettledBySupplier("Katsh")).toHaveLength(0);
  });
});
