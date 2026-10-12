/**
 * LIRA-313 (owner decision 2026-10-12) — supplier Pay / Receive with change.
 *
 * "In any mode, the extra amount paid goes into the account." The Pay /
 * Receive form used to SHOW a "Change to get back" box that the server
 * ignored: recordSupplierCashflow refused OUT legs outright, the page never
 * sent them, and the whole amount was booked — so if the supplier really
 * handed $50 back, the drawer and the supplier's balance were both wrong by
 * $50. Now:
 *   - change legs (direction "OUT") move the drawer OPPOSITE to the flow;
 *   - the ledger books the NET per currency (paid − change handed back);
 *   - change NOT handed back stays on the supplier's balance, which may
 *     cross zero (we pay $150 on $100 owed → the supplier owes us $50);
 *   - voiding nets drawer AND ledger to 0 per currency (rule 20).
 *
 * Rule 17: written after the fix — not proven failing-first. Not run yet
 * (owner asked for write-only on 2026-10-12).
 */

import Database from "better-sqlite3";
import { SupplierRepository } from "../SupplierRepository";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { MIGRATIONS } from "../../db/migrations/index";

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

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL);
    INSERT INTO users (id, username) VALUES (1, 'admin');

    CREATE TABLE suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_name TEXT,
      phone TEXT,
      note TEXT,
      provider TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_system INTEGER NOT NULL DEFAULT 0,
      module_key TEXT,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO suppliers (name, provider) VALUES ('Acme', NULL);

    CREATE TABLE supplier_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL CHECK(entry_type IN ('TOP_UP','SALE_COST','PAYMENT','ADJUSTMENT','SETTLEMENT','CASH_PRIZE','SUPPLIER_PAYS_US')),
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_by INTEGER,
      transaction_id INTEGER,
      is_auto INTEGER NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_at DATETIME,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE supplier_purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      total_usd REAL NOT NULL,
      paid_usd REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_by INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
      reverses_id INTEGER,
      profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0,
      summary TEXT,
      metadata_json TEXT,
      device_id TEXT,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    INSERT INTO drawer_balances (drawer_name, currency_code, balance, updated_at) VALUES ('General', 'USD', 1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance, updated_at) VALUES ('General', 'LBP', 10000000, CURRENT_TIMESTAMP);

    -- _cancelDebt runs unconditionally on every void/refund (module-debt
    -- reversal fix, 2026-07-12) — the fixture needs the table it scans.
    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      transaction_id INTEGER,
      session_id INTEGER,
      note TEXT,
      due_date TEXT,
      created_by INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);
  `);
  return db;
}

const SUPPLIER_ID = 1;

function balanceOf(db: Database.Database, repo: SupplierRepository) {
  const b = repo
    .getSupplierBalances(true)
    .find((x) => x.supplier_id === SUPPLIER_ID);
  return { usd: b?.total_usd ?? 0, lbp: b?.total_lbp ?? 0 };
}

function drawer(db: Database.Database, currency: string): number {
  return (
    db
      .prepare(
        `SELECT balance FROM drawer_balances WHERE drawer_name='General' AND currency_code=?`,
      )
      .get(currency) as { balance: number }
  ).balance;
}

function txnIdForLedger(db: Database.Database, ledgerId: number): number {
  return (
    db
      .prepare(
        `SELECT id FROM transactions WHERE source_table='supplier_ledger' AND source_id=? ORDER BY id LIMIT 1`,
      )
      .get(ledgerId) as { id: number }
  ).id;
}

describe("LIRA-313 supplier cashflow — change legs and overpayment", () => {
  let db: Database.Database;
  let suppliers: SupplierRepository;
  let txns: TransactionRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    resetTransactionRepository();
    suppliers = new SupplierRepository();
    txns = new TransactionRepository();
    // We owe Acme $100.
    suppliers.addLedgerEntry({
      supplier_id: SUPPLIER_ID,
      entry_type: "TOP_UP",
      amount_usd: 100,
      amount_lbp: 0,
      created_by: 1,
    });
  });

  afterEach(() => {
    db.close();
    resetTransactionRepository();
  });

  it("PAY $150 on $100 owed, no change back: the supplier owes us $50", () => {
    const drawerBefore = drawer(db, "USD");
    suppliers.recordSupplierCashflow({
      supplier_id: SUPPLIER_ID,
      direction: "PAY",
      payments: [{ method: "CASH", currency_code: "USD", amount: 150 }],
      created_by: 1,
    });
    expect(balanceOf(db, suppliers).usd).toBeCloseTo(-50, 2);
    expect(drawer(db, "USD")).toBeCloseTo(drawerBefore - 150, 2);
  });

  it("PAY $150 with $50 cash handed back: settles exactly, drawer moves −100", () => {
    const drawerBefore = drawer(db, "USD");
    const flow = suppliers.recordSupplierCashflow({
      supplier_id: SUPPLIER_ID,
      direction: "PAY",
      payments: [
        { method: "CASH", currency_code: "USD", amount: 150 },
        { method: "CASH", currency_code: "USD", amount: 50, direction: "OUT" },
      ],
      created_by: 1,
    });
    expect(balanceOf(db, suppliers).usd).toBeCloseTo(0, 2);
    expect(drawer(db, "USD")).toBeCloseTo(drawerBefore - 100, 2);

    // Two payment rows: −150 paid, +50 change back.
    const rows = db
      .prepare(
        `SELECT amount, note FROM payments WHERE transaction_id = ? ORDER BY id`,
      )
      .all(txnIdForLedger(db, flow.id)) as { amount: number; note: string }[];
    expect(rows.map((r) => r.amount)).toEqual([-150, 50]);
    expect(rows[1].note).toBe("Change returned");
  });

  it("PAY $150 with only $20 handed back: the other $30 stays on the account (supplier owes us $30)", () => {
    suppliers.recordSupplierCashflow({
      supplier_id: SUPPLIER_ID,
      direction: "PAY",
      payments: [
        { method: "CASH", currency_code: "USD", amount: 150 },
        { method: "CASH", currency_code: "USD", amount: 20, direction: "OUT" },
      ],
      created_by: 1,
    });
    expect(balanceOf(db, suppliers).usd).toBeCloseTo(-30, 2);
  });

  it("change in the other currency is booked per currency (no conversion)", () => {
    const lbpBefore = drawer(db, "LBP");
    suppliers.recordSupplierCashflow({
      supplier_id: SUPPLIER_ID,
      direction: "PAY",
      payments: [
        { method: "CASH", currency_code: "USD", amount: 150 },
        {
          method: "CASH",
          currency_code: "LBP",
          amount: 4_450_000,
          direction: "OUT",
        },
      ],
      exchange_rate: 89_000,
      created_by: 1,
    });
    const bal = balanceOf(db, suppliers);
    expect(bal.usd).toBeCloseTo(-50, 2); // 100 − 150
    expect(bal.lbp).toBeCloseTo(4_450_000, 0); // we owe them the LBP they handed back
    expect(drawer(db, "LBP")).toBeCloseTo(lbpBefore + 4_450_000, 0);
  });

  it("RECEIVE $80 when the supplier owes us $50: we now owe them $30", () => {
    suppliers.recordSupplierCashflow({
      supplier_id: SUPPLIER_ID,
      direction: "PAY",
      payments: [{ method: "CASH", currency_code: "USD", amount: 150 }],
      created_by: 1,
    });
    expect(balanceOf(db, suppliers).usd).toBeCloseTo(-50, 2);
    suppliers.recordSupplierCashflow({
      supplier_id: SUPPLIER_ID,
      direction: "RECEIVE",
      payments: [{ method: "CASH", currency_code: "USD", amount: 80 }],
      created_by: 1,
    });
    expect(balanceOf(db, suppliers).usd).toBeCloseTo(30, 2);
  });

  it("RECEIVE with change WE hand back moves the drawer out for the change", () => {
    // Supplier owes us $50 first.
    suppliers.recordSupplierCashflow({
      supplier_id: SUPPLIER_ID,
      direction: "PAY",
      payments: [{ method: "CASH", currency_code: "USD", amount: 150 }],
      created_by: 1,
    });
    const drawerBefore = drawer(db, "USD");
    suppliers.recordSupplierCashflow({
      supplier_id: SUPPLIER_ID,
      direction: "RECEIVE",
      payments: [
        { method: "CASH", currency_code: "USD", amount: 100 },
        { method: "CASH", currency_code: "USD", amount: 50, direction: "OUT" },
      ],
      created_by: 1,
    });
    expect(balanceOf(db, suppliers).usd).toBeCloseTo(0, 2);
    expect(drawer(db, "USD")).toBeCloseTo(drawerBefore + 50, 2);
  });

  it("void of a PAY with change nets drawer, ledger AND purchase coverage to 0 per currency (rule 20)", () => {
    db.prepare(
      `INSERT INTO supplier_purchases (supplier_id, total_usd, paid_usd) VALUES (?, 300, 0)`,
    ).run(SUPPLIER_ID);
    const paidUsd = () =>
      (
        db
          .prepare(
            `SELECT paid_usd FROM supplier_purchases WHERE supplier_id = ?`,
          )
          .get(SUPPLIER_ID) as { paid_usd: number }
      ).paid_usd;
    const usdBefore = drawer(db, "USD");
    const lbpBefore = drawer(db, "LBP");
    const balBefore = balanceOf(db, suppliers);
    const flow = suppliers.recordSupplierCashflow({
      supplier_id: SUPPLIER_ID,
      direction: "PAY",
      payments: [
        { method: "CASH", currency_code: "USD", amount: 150 },
        { method: "CASH", currency_code: "USD", amount: 10, direction: "OUT" },
        {
          method: "CASH",
          currency_code: "LBP",
          amount: 890_000,
          direction: "OUT",
        },
      ],
      exchange_rate: 89_000,
      created_by: 1,
    });
    // $150 paid − $10 − 890,000 LBP ($10) change = $130 of purchases covered.
    expect(paidUsd()).toBeCloseTo(130, 2);
    txns.voidTransaction(txnIdForLedger(db, flow.id), 1);
    // The give-back is the same signed net, not |usd| + |lbp| ($160).
    expect(paidUsd()).toBeCloseTo(0, 2);
    expect(drawer(db, "USD")).toBeCloseTo(usdBefore, 2);
    expect(drawer(db, "LBP")).toBeCloseTo(lbpBefore, 0);
    const balAfter = balanceOf(db, suppliers);
    expect(balAfter.usd).toBeCloseTo(balBefore.usd, 2);
    expect(balAfter.lbp).toBeCloseTo(balBefore.lbp, 0);
  });

  it("rejects change only, or change worth as much as what was paid", () => {
    expect(() =>
      suppliers.recordSupplierCashflow({
        supplier_id: SUPPLIER_ID,
        direction: "PAY",
        payments: [
          { method: "CASH", currency_code: "USD", amount: 5, direction: "OUT" },
        ],
        created_by: 1,
      }),
    ).toThrow(/not only change/i);
    expect(() =>
      suppliers.recordSupplierCashflow({
        supplier_id: SUPPLIER_ID,
        direction: "PAY",
        payments: [
          { method: "CASH", currency_code: "USD", amount: 50 },
          {
            method: "CASH",
            currency_code: "USD",
            amount: 50,
            direction: "OUT",
          },
        ],
        created_by: 1,
      }),
    ).toThrow(/Failed to record supplier cashflow/);
  });

  it("rejects a change leg that moves no drawer", () => {
    expect(() =>
      suppliers.recordSupplierCashflow({
        supplier_id: SUPPLIER_ID,
        direction: "PAY",
        payments: [
          { method: "CASH", currency_code: "USD", amount: 150 },
          {
            method: "CUSTOMER_ACCOUNT",
            currency_code: "USD",
            amount: 50,
            direction: "OUT",
          },
        ],
        created_by: 1,
      }),
    ).toThrow();
  });
});
