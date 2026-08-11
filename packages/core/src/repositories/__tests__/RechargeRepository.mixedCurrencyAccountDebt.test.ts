/**
 * RechargeRepository — S7: mixed-currency on-account recharge debt
 * (Payment-Legs Integrity plan, owner-verified bug)
 *
 * Pre-fix, `processRecharge()`'s multi-payment debt branch summed EVERY
 * non-drawer-affecting (CUSTOMER_ACCOUNT) leg's `amount` across BOTH
 * currencies into one `debtAmount` number, then booked the WHOLE sum under
 * whichever debt_ledger column matched the recharge's OWN service currency —
 * a $5 USD account leg + a 450,000 LBP account leg collapsed into "450,005"
 * and landed entirely in ONE column (450,005 in `amount_usd` for a USD
 * recharge). Fix: book PER LEG CURRENCY, mirroring
 * FinancialServiceRepository's multi-leg Service Debt booking.
 *
 * Rule 20 (reversal symmetry): refunding the transaction must net the
 * client's debt to ZERO PER CURRENCY. `TransactionRepository._cancelDebt`
 * negates BOTH `amount_usd`/`amount_lbp` columns of the ORIGINAL row — this
 * only holds if the original row's columns are correct in the first place
 * (a bug in the write path silently breaks the read side of reversal too:
 * negating a wrong number still nets to zero on ITS OWN axis, but the wrong
 * axis was charged to begin with). The failing-first pair below proves both
 * halves: (1) the debt is booked correctly per currency, and (2) refunding
 * it nets both currencies to exactly zero.
 *
 * Per rule 17: both assertions in the first `it` FAIL against the pre-fix
 * code (verified by reintroducing the single-`debtAmount` bug and observing
 * the test fail, then reverting — see the task report for the transcript).
 */

import Database from "better-sqlite3";
import { RechargeRepository } from "../RechargeRepository";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

const CLIENT_ID = 7;

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
    CREATE TABLE users (
      tenant_id INTEGER DEFAULT 1,
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL
    );
    INSERT INTO users (id, username) VALUES (1, 'cashier');

    CREATE TABLE clients (
      tenant_id INTEGER DEFAULT 1,
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name    TEXT NOT NULL,
      phone_number TEXT,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO clients (id, full_name, phone_number) VALUES (${CLIENT_ID}, 'Debt Client', '76000000');

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
      is_refunded            INTEGER DEFAULT 0,
      refunded_at            TEXT,
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
      session_id     INTEGER,
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
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

    CREATE TABLE exchange_rates (
      to_code     TEXT,
      sell_rate   REAL,
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

function debtRows(db: Database.Database): Array<{
  transaction_type: string;
  amount_usd: number;
  amount_lbp: number;
}> {
  return db
    .prepare(
      `SELECT transaction_type, amount_usd, amount_lbp FROM debt_ledger
       WHERE client_id = ? ORDER BY id ASC`,
    )
    .all(CLIENT_ID) as Array<{
    transaction_type: string;
    amount_usd: number;
    amount_lbp: number;
  }>;
}

function clientBalance(db: Database.Database): { usd: number; lbp: number } {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_lbp), 0) AS lbp
       FROM debt_ledger WHERE client_id = ?`,
    )
    .get(CLIENT_ID) as { usd: number; lbp: number };
  return row;
}

describe("RechargeRepository — S7 mixed-currency on-account debt", () => {
  let db: Database.Database;
  let rechargeRepo: RechargeRepository;
  let txnRepo: TransactionRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetTransactionRepository();
    rechargeRepo = new RechargeRepository();
    txnRepo = new TransactionRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  it("books a mixed-currency on-account recharge PER LEG CURRENCY, not summed into one column", () => {
    // $10 recharge, fully on account: $5 USD account leg + 450,000 LBP
    // account leg (= $5 at the stamped 90,000 rate) — reconciles exactly
    // against S2's leg check (price = $10).
    const result = rechargeRepo.processRecharge({
      provider: "MTC",
      type: "CREDIT_TRANSFER",
      amount: 10,
      cost: 8,
      price: 10,
      currency: "USD",
      clientId: CLIENT_ID,
      phoneNumber: "76000000",
      payments: [
        { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 5 },
        { method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: 450000 },
      ],
      userId: 1,
    });

    expect(result.success).toBe(true);

    const debts = debtRows(db);
    expect(debts).toHaveLength(1);
    // Pre-fix: amount_usd would be 450005 (5 + 450000 summed across
    // currencies, booked entirely under the USD column since currency=USD).
    expect(debts[0].amount_usd).toBeCloseTo(5, 2);
    expect(debts[0].amount_lbp).toBeCloseTo(450000, 2);
  });

  it("REVERSAL SYMMETRY (rule 20): refunding the mixed-currency on-account recharge nets debt to ZERO per currency", () => {
    const result = rechargeRepo.processRecharge({
      provider: "MTC",
      type: "CREDIT_TRANSFER",
      amount: 10,
      cost: 8,
      price: 10,
      currency: "USD",
      clientId: CLIENT_ID,
      phoneNumber: "76000000",
      payments: [
        { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 5 },
        { method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: 450000 },
      ],
      userId: 1,
    });
    expect(result.success).toBe(true);
    expect(result.id).toBeGreaterThan(0);

    // Sanity: pre-refund balance matches the correctly-split charge.
    const before = clientBalance(db);
    expect(before.usd).toBeCloseTo(5, 2);
    expect(before.lbp).toBeCloseTo(450000, 2);

    // Find the unified transaction the recharge wrote, then refund it —
    // the entry point the Transactions table / recharge void UI uses.
    const txn = db
      .prepare(
        `SELECT id FROM transactions WHERE source_table = 'recharges' AND source_id = ? AND type = 'RECHARGE'`,
      )
      .get(result.id) as { id: number };

    txnRepo.refundTransaction(txn.id, 1);

    const after = clientBalance(db);
    expect(after.usd).toBeCloseTo(0, 2);
    expect(after.lbp).toBeCloseTo(0, 2);

    // Both a charge row AND a reversal row exist, each correctly split —
    // NOT a single collapsed/miscolumned pair.
    const debts = debtRows(db);
    expect(debts).toHaveLength(2);
    const reversal = debts.find(
      (d) => d.transaction_type === "Refund Reversal",
    );
    expect(reversal?.amount_usd).toBeCloseTo(-5, 2);
    expect(reversal?.amount_lbp).toBeCloseTo(-450000, 2);
  });

  it("control: a single-currency (LBP) on-account recharge still books correctly (no regression)", () => {
    const result = rechargeRepo.processRecharge({
      provider: "MTC",
      type: "CREDIT_TRANSFER",
      amount: 6,
      cost: 5,
      price: 540000,
      currency: "LBP",
      clientId: CLIENT_ID,
      phoneNumber: "76000000",
      payments: [
        { method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: 540000 },
      ],
      userId: 1,
    });
    expect(result.success).toBe(true);

    const debts = debtRows(db);
    expect(debts).toHaveLength(1);
    expect(debts[0].amount_usd).toBe(0);
    expect(debts[0].amount_lbp).toBeCloseTo(540000, 2);
  });
});
