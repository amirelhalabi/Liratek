/**
 * RechargeRepository — S2 hard-reject leg reconciliation, wired in
 * (Payment-Legs Integrity plan, Wave 7 / Phase 2)
 *
 * Proves `processRecharge()` rejects a mismatched leg set atomically (no
 * recharge row, no transaction row, no drawer movement) and reconciles a
 * correct one, mirroring FinancialServiceRepository.legReconciliation.test.ts.
 */

import Database from "better-sqlite3";
import { RechargeRepository } from "../RechargeRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { resetTransactionRepository } from "../TransactionRepository";

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

jest.mock("../../services/DebtService", () => ({
  getDebtService: () => ({ addCredit: jest.fn() }),
  resetDebtService: jest.fn(),
}));

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE recharges (
      tenant_id INTEGER DEFAULT 1,
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      carrier                TEXT NOT NULL,
      recharge_type          TEXT NOT NULL,
      amount                 REAL NOT NULL,
      cost                   REAL NOT NULL DEFAULT 0,
      price                  REAL NOT NULL DEFAULT 0,
      default_price_to_client REAL,
      currency_code          TEXT DEFAULT 'USD',
      paid_by                TEXT DEFAULT 'CASH',
      phone_number           TEXT,
      client_id              INTEGER,
      client_name            TEXT,
      note                   TEXT,
      created_by             INTEGER DEFAULT 1,
      created_at             DATETIME DEFAULT CURRENT_TIMESTAMP,
      edited_by              TEXT,
      edited_at              TEXT
    );

    CREATE TABLE transactions (
      tenant_id INTEGER DEFAULT 1,
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
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      tenant_id INTEGER DEFAULT 1,
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
      tenant_id INTEGER DEFAULT 1,
      drawer_name   TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance       REAL NOT NULL DEFAULT 0,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

    CREATE TABLE clients (
      tenant_id INTEGER DEFAULT 1,
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name    TEXT NOT NULL,
      phone_number TEXT,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE debt_ledger (
      tenant_id INTEGER DEFAULT 1,
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id        INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd       REAL NOT NULL DEFAULT 0,
      amount_lbp       REAL NOT NULL DEFAULT 0,
      transaction_id   INTEGER,
      note             TEXT,
      due_date         TEXT,
      created_by       INTEGER,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE exchange_rates (
      to_code    TEXT,
      sell_rate  REAL,
      market_rate REAL
    );
    INSERT INTO exchange_rates (to_code, sell_rate) VALUES ('LBP', 90000);

    INSERT INTO drawer_balances VALUES (1, 'MTC',     'USD', 1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Alfa',    'USD', 1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General', 'USD', 5000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General', 'LBP', 500000000, CURRENT_TIMESTAMP);
  `);

  return db;
}

function drawerBalance(
  db: Database.Database,
  drawer: string,
  currency: string,
): number {
  const row = db
    .prepare(
      "SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?",
    )
    .get(drawer, currency) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

function counts(db: Database.Database): {
  recharges: number;
  transactions: number;
  payments: number;
  debtLedger: number;
} {
  const one = (table: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number })
      .n;
  return {
    recharges: one("recharges"),
    transactions: one("transactions"),
    payments: one("payments"),
    debtLedger: one("debt_ledger"),
  };
}

describe("RechargeRepository — S2 leg reconciliation wiring", () => {
  let db: Database.Database;
  let repo: RechargeRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetTransactionRepository();
    repo = new RechargeRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  it("REJECTS a single LBP leg short of the recharge price — atomic, nothing persists", () => {
    const before = counts(db);
    const mtcBefore = drawerBalance(db, "MTC", "USD");
    const genLbpBefore = drawerBalance(db, "General", "LBP");

    const result = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_TRANSFER",
      amount: 6,
      cost: 5.0,
      price: 6.0,
      currency: "USD",
      phoneNumber: "03000099",
      payments: [{ method: "CASH", currencyCode: "LBP", amount: 90000 }], // $1, not $6
      userId: 1,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/do not reconcile/);

    // Atomic: nothing persisted at all, no drawer moved.
    expect(counts(db)).toEqual(before);
    expect(drawerBalance(db, "MTC", "USD")).toBe(mtcBefore);
    expect(drawerBalance(db, "General", "LBP")).toBe(genLbpBefore);
  });

  it("control: the correct LBP leg (price converted at the stamped rate) reconciles and persists", () => {
    const before = counts(db);
    const result = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_TRANSFER",
      amount: 6,
      cost: 5.0,
      price: 6.0,
      currency: "USD",
      phoneNumber: "03000098",
      payments: [{ method: "CASH", currencyCode: "LBP", amount: 540000 }], // $6 at rate 90,000
      userId: 1,
    });

    expect(result.success).toBe(true);
    expect(counts(db).transactions).toBe(before.transactions + 1);
    expect(drawerBalance(db, "General", "LBP")).toBe(500000000 + 540000);
  });

  it("no legs at all (paid_by_method fallback): never checked", () => {
    const result = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_TRANSFER",
      amount: 3,
      cost: 2.5,
      price: 3.0,
      paid_by_method: "CASH",
      phoneNumber: "03000097",
      userId: 1,
    });
    expect(result.success).toBe(true);
  });

  it("deferPayment: mismatched legs are ignored — the session basket owns the customer-cash side", () => {
    const result = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_TRANSFER",
      amount: 6,
      cost: 5.0,
      price: 6.0,
      currency: "USD",
      phoneNumber: "03000096",
      deferPayment: true,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 0.01 }],
      userId: 1,
    });
    expect(result.success).toBe(true);
  });
});
