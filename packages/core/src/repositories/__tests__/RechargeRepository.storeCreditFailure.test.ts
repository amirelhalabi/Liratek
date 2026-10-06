/**
 * LIRA-258 G13 (POSTING_INTEGRITY_PLAN.md item 2.3, POSTING_MAP.md §7):
 * RechargeRepository credited the customer's account through
 * `DebtService.addCredit`, which CATCHES every error and returns
 * `{ success: false }` — and both call sites ignored the result. So when the
 * credit write failed, the money flow still committed:
 *   - a recharge whose change is kept as store credit (a CUSTOMER_ACCOUNT
 *     OUT leg) kept the full cash in the drawer and the customer silently
 *     lost their change;
 *   - a credit buy-back paid partly to the customer's account took the
 *     credits onto the shop line and paid out the cash leg, but never
 *     credited the account part.
 * Fix: the throwing variant `addCreditOrThrow`, so the whole
 * db.transaction rolls back.
 *
 * The failure is forced at the database level (a BEFORE INSERT trigger on
 * CREDIT_DEPOSIT rows, same pattern as SalesRepository.storeCreditFailure
 * .test.ts) — nothing in the code path is mocked. Fixture copied from
 * RechargeRepository.creditBuyback.test.ts (real DebtService).
 */
import Database from "better-sqlite3";
import {
  RechargeRepository,
  resetRechargeRepository,
} from "../RechargeRepository";
import {
  CarrierLineRepository,
  resetCarrierLineRepository,
} from "../CarrierLineRepository";
import { resetCarrierLineMovementRepository } from "../CarrierLineMovementRepository";
import { resetCarrierLineService } from "../../services/CarrierLineService";
import { resetDebtService } from "../../services/DebtService";
import { resetDebtRepository } from "../DebtRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  snapshotLedgers,
  expectPostings,
} from "../testHelpers/postingAssert";

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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { setDb } = require("../../db/connection");

const FUTURE_EXPIRY = "2099-01-01";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE recharges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      carrier TEXT NOT NULL,
      recharge_type TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      default_price_to_client REAL,
      currency_code TEXT NOT NULL DEFAULT 'USD',
      paid_by TEXT,
      phone_number TEXT,
      client_id INTEGER,
      client_name TEXT,
      note TEXT,
      created_by INTEGER DEFAULT 1,
      edited_by TEXT,
      edited_at DATETIME,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE carrier_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      carrier TEXT NOT NULL CHECK(carrier IN ('alfa','mtc')),
      phone_number TEXT NOT NULL,
      label TEXT,
      credits REAL NOT NULL DEFAULT 0,
      validity_expires_at TEXT,
      days_owed INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_primary INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_carrier_lines_one_primary_per_carrier
      ON carrier_lines(tenant_id, carrier)
      WHERE is_primary = 1;

    CREATE TABLE carrier_line_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      carrier_line_id INTEGER NOT NULL,
      transaction_id INTEGER,
      credits_delta REAL NOT NULL DEFAULT 0,
      validity_days_delta INTEGER NOT NULL DEFAULT 0,
      previous_validity_expires_at TEXT,
      days_owed_delta INTEGER NOT NULL DEFAULT 0,
      previous_days_owed INTEGER NOT NULL DEFAULT 0,
      reason TEXT NOT NULL,
      is_reversed INTEGER NOT NULL DEFAULT 0,
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
      user_id INTEGER,
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
      tenant_id INTEGER DEFAULT 1,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      transaction_id INTEGER,
      session_id INTEGER,
      note TEXT,
      due_date TEXT,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);
  `);
  return db;
}

function balance(
  db: Database.Database,
  drawer: string,
  currency: string,
): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?`,
    )
    .get(drawer, currency) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

function seedDrawer(
  db: Database.Database,
  drawer: string,
  currency: string,
  amount: number,
): void {
  db.prepare(
    `INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, ?, ?, ?)
     ON CONFLICT(tenant_id, drawer_name, currency_code) DO UPDATE SET balance = excluded.balance`,
  ).run(drawer, currency, amount);
}

function seedClient(db: Database.Database, name = "Walk-in"): number {
  const res = db
    .prepare(`INSERT INTO clients (full_name) VALUES (?)`)
    .run(name);
  return Number(res.lastInsertRowid);
}

function rowCounts(db: Database.Database): Record<string, number> {
  const n = (t: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  return {
    recharges: n("recharges"),
    transactions: n("transactions"),
    payments: n("payments"),
    debt_ledger: n("debt_ledger"),
    carrier_line_movements: n("carrier_line_movements"),
  };
}

function failCreditDeposits(db: Database.Database): void {
  db.exec(`
    CREATE TRIGGER fail_credit_deposit BEFORE INSERT ON debt_ledger
    WHEN NEW.transaction_type = 'CREDIT_DEPOSIT'
    BEGIN SELECT RAISE(ABORT, 'boom: credit deposit'); END;
  `);
}

describe("RechargeRepository — a failed customer credit rolls the whole flow back (G13)", () => {
  let db: Database.Database;
  let repo: RechargeRepository;
  let lineRepo: CarrierLineRepository;

  const resetAll = () => {
    resetRechargeRepository();
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
    resetCarrierLineService();
    resetDebtService();
    resetDebtRepository();
    resetTransactionRepository();
  };

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetAll();
    repo = new RechargeRepository();
    lineRepo = new CarrierLineRepository();
    seedDrawer(db, "General", "USD", 500);
    seedDrawer(db, "MTC", "USD", 500);
  });

  afterEach(() => {
    db.close();
    resetTenantContext();
    resetAll();
  });

  // $10 MTC voucher, customer hands $15 cash, keeps $5 change on account.
  const sellVoucherKeepingChange = (clientId: number) =>
    repo.processRecharge({
      provider: "MTC",
      type: "VOUCHER",
      amount: 10,
      cost: 9,
      price: 10,
      currency: "USD",
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 15 },
        {
          method: "CUSTOMER_ACCOUNT",
          currencyCode: "USD",
          amount: 5,
          direction: "OUT",
        },
      ],
      clientId,
      userId: 1,
    });

  it("control: change kept as store credit books a CREDIT_DEPOSIT when nothing fails", () => {
    const clientId = seedClient(db);
    const result = sellVoucherKeepingChange(clientId);
    expect(result.success).toBe(true);
    const credit = db
      .prepare(
        `SELECT amount_usd FROM debt_ledger WHERE client_id = ? AND transaction_type = 'CREDIT_DEPOSIT'`,
      )
      .get(clientId) as { amount_usd: number } | undefined;
    expect(credit?.amount_usd).toBeCloseTo(-5, 2);
  });

  it("change kept as store credit: when the credit write fails, the recharge is refused and NOTHING is posted", () => {
    const clientId = seedClient(db);
    failCreditDeposits(db);
    const before = snapshotLedgers(db);
    const countsBefore = rowCounts(db);

    const result = sellVoucherKeepingChange(clientId);

    expect(result.success).toBe(false);
    expectPostings(before, snapshotLedgers(db), {});
    expect(rowCounts(db)).toEqual(countsBefore);
  });

  it("credit buy-back paid partly to the account: when the credit write fails, NOTHING is posted", () => {
    lineRepo.createLine(
      {
        carrier: "mtc",
        phone_number: "03111111",
        credits: 20,
        validity_expires_at: FUTURE_EXPIRY,
      },
      1,
    );
    const clientId = seedClient(db);
    failCreditDeposits(db);
    const before = snapshotLedgers(db);
    const countsBefore = rowCounts(db);
    const creditsBefore = (
      db.prepare(`SELECT credits FROM carrier_lines`).get() as { credits: number }
    ).credits;

    const result = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_BUYBACK",
      amount: 10,
      cost: 0,
      price: 10,
      currency: "USD",
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 5 },
        { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 5 },
      ],
      clientId,
      userId: 1,
    });

    expect(result.success).toBe(false);
    expectPostings(before, snapshotLedgers(db), {});
    expect(rowCounts(db)).toEqual(countsBefore);
    expect(
      (db.prepare(`SELECT credits FROM carrier_lines`).get() as { credits: number })
        .credits,
    ).toBe(creditsBefore);
  });
});
