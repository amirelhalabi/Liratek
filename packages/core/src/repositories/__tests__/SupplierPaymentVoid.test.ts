/**
 * Supplier-payment void/refund reversal (from the B6b adversarial validation)
 *
 * Voiding/refunding a SUPPLIER_PAYMENT transaction reversed the cash drawer
 * but left its supplier_ledger row counting toward the supplier balance
 * forever — the balance permanently understated the shop's debt.
 *
 * Fix (flag-the-original): migration v120 adds is_refunded/refunded_at to
 * supplier_ledger; _markSourceRefunded soft-voids the ledger row; every
 * balance/pool aggregate excludes flagged rows; recordSupplierCashflow PAY's
 * FIFO purchase coverage is un-applied. Types whose side effects the generic
 * reversal cannot undo (LOTO*, SUPPLIER_SETTLEMENT, RECHARGE_TOPUP, REFUND)
 * are gated at the repository. Every case here FAILS on pre-fix code (rule 17).
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

describe("supplier-payment void/refund reversal", () => {
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
  });

  afterEach(() => {
    db.close();
    resetTransactionRepository();
  });

  it("voiding a manual supplier payment restores the balance, the drawer, and flags the ledger row", () => {
    // Shop owes Acme $100 (opening TOP_UP), then pays $60 cash.
    suppliers.addLedgerEntry({
      supplier_id: SUPPLIER_ID,
      entry_type: "TOP_UP",
      amount_usd: 100,
      amount_lbp: 0,
      created_by: 1,
    });
    const paid = suppliers.addLedgerEntry({
      supplier_id: SUPPLIER_ID,
      entry_type: "PAYMENT",
      amount_usd: 60,
      amount_lbp: 0,
      drawer_name: "General",
      created_by: 1,
    });
    expect(balanceOf(db, suppliers).usd).toBeCloseTo(40, 2); // 100 − 60
    const drawerAfterPay = drawer(db, "USD"); // 1000 − 60 = 940

    // note 14 — thin-summary enrichment: supplier name appended after the
    // existing "Supplier Payment: $X + Y LBP" prefix (prefix stays intact).
    const paidTxn = db
      .prepare(`SELECT summary FROM transactions WHERE id = ?`)
      .get(txnIdForLedger(db, paid.id)) as { summary: string };
    expect(paidTxn.summary.startsWith("Supplier Payment: $60 + 0 LBP")).toBe(
      true,
    );
    expect(paidTxn.summary).toContain("Acme");

    txns.voidTransaction(txnIdForLedger(db, paid.id), 1);

    // Pre-fix: drawer restored but balance stayed 40 — understating the debt.
    expect(balanceOf(db, suppliers).usd).toBeCloseTo(100, 2);
    expect(drawer(db, "USD")).toBeCloseTo(drawerAfterPay + 60, 2);
    const row = db
      .prepare(`SELECT is_refunded FROM supplier_ledger WHERE id = ?`)
      .get(paid.id) as { is_refunded: number };
    expect(row.is_refunded).toBe(1);
  });

  it("a voided manual payment leaves the FIFO settle pools (send_pool drops back to 0)", () => {
    const paid = suppliers.addLedgerEntry({
      supplier_id: SUPPLIER_ID,
      entry_type: "PAYMENT",
      amount_usd: 75,
      amount_lbp: 0,
      drawer_name: "General",
      created_by: 1,
    });
    expect(suppliers.getManualPaymentPools(SUPPLIER_ID).send_pool_usd).toBe(75);

    txns.voidTransaction(txnIdForLedger(db, paid.id), 1);

    // Pre-fix: the dead payment kept inflating the send pool.
    expect(suppliers.getManualPaymentPools(SUPPLIER_ID).send_pool_usd).toBe(0);
  });

  it("voiding a cashflow PAY gives back the FIFO purchase coverage it consumed", () => {
    db.prepare(
      `INSERT INTO supplier_purchases (supplier_id, total_usd, paid_usd) VALUES (?, 200, 0)`,
    ).run(SUPPLIER_ID);

    const flow = suppliers.recordSupplierCashflow({
      supplier_id: SUPPLIER_ID,
      direction: "PAY",
      payments: [{ method: "CASH", currency_code: "USD", amount: 50 }],
      created_by: 1,
    });
    const paidUsd = () =>
      (
        db
          .prepare(
            `SELECT paid_usd FROM supplier_purchases WHERE supplier_id = ?`,
          )
          .get(SUPPLIER_ID) as { paid_usd: number }
      ).paid_usd;
    expect(paidUsd()).toBeCloseTo(50, 2);

    txns.voidTransaction(txnIdForLedger(db, flow.id), 1);

    // Pre-fix: coverage stayed applied though the payment was voided.
    expect(paidUsd()).toBeCloseTo(0, 2);
  });

  it("refundTransaction flags the ledger row too (same soft-void path)", () => {
    const paid = suppliers.addLedgerEntry({
      supplier_id: SUPPLIER_ID,
      entry_type: "PAYMENT",
      amount_usd: 30,
      amount_lbp: 0,
      drawer_name: "General",
      created_by: 1,
    });
    txns.refundTransaction(txnIdForLedger(db, paid.id), 1);
    expect(balanceOf(db, suppliers).usd).toBeCloseTo(0, 2); // −30 excluded
    const row = db
      .prepare(`SELECT is_refunded FROM supplier_ledger WHERE id = ?`)
      .get(paid.id) as { is_refunded: number };
    expect(row.is_refunded).toBe(1);
  });

  it("gates non-reversible types: LOTO_CASH_PRIZE / RECHARGE_TOPUP / REFUND throw", () => {
    const insertTxn = (type: string): number =>
      Number(
        db
          .prepare(
            `INSERT INTO transactions (type, status, source_table, source_id, user_id, amount_lbp)
             VALUES (?, 'ACTIVE', 'x', 1, 1, 1000)`,
          )
          .run(type).lastInsertRowid,
      );

    // LIRA-085: SUPPLIER_SETTLEMENT moved OUT of NON_REVERSIBLE_TRANSACTION_TYPES
    // — a dedicated reversal owner now exists
    // (TransactionRepository._reverseSupplierSettlement). See
    // TransactionRepository.supplierSettlementReversal.test.ts for its
    // create+reverse+nets-to-0 coverage.
    //
    // 2026-07-28: LOTO (ticket sales) moved OUT of this set too — a dedicated
    // guard/reversal pair now owns it (_assertLotoTicketVoidable /
    // _reverseLotoSupplierLedger, see TransactionRepository.ts), gated on
    // source_table === "loto_tickets" (this fixture's insertTxn uses a bare
    // "x" source_table, so even a "LOTO" row here would no longer throw —
    // it's dropped rather than kept, to avoid asserting a false negative).
    // LOTO_CASH_PRIZE has no reversal owner and stays non-reversible, so it
    // keeps this loop's "still-gated Loto type" coverage.
    for (const type of ["LOTO_CASH_PRIZE", "RECHARGE_TOPUP", "REFUND"]) {
      const id = insertTxn(type);
      // Pre-fix: both calls happily reversed the drawers.
      expect(() => txns.voidTransaction(id, 1)).toThrow(/cannot be voided/);
      expect(() => txns.refundTransaction(id, 1)).toThrow(/cannot be voided/);
    }
  });

  it("refuses to reverse a reversal, and to void after a refund", () => {
    const paid = suppliers.addLedgerEntry({
      supplier_id: SUPPLIER_ID,
      entry_type: "PAYMENT",
      amount_usd: 20,
      amount_lbp: 0,
      drawer_name: "General",
      created_by: 1,
    });
    const originalId = txnIdForLedger(db, paid.id);
    const refundId = txns.refundTransaction(originalId, 1);

    // Pre-fix: voiding the ACTIVE original after its refund double-reversed cash.
    expect(() => txns.voidTransaction(originalId, 1)).toThrow(
      /already been refunded/,
    );
    // Pre-fix: the REFUND row itself was reversible again.
    expect(() => txns.voidTransaction(refundId, 1)).toThrow(
      /cannot be voided|reversal/,
    );
  });

  it("migration v120 adds the soft-void columns", () => {
    const v120 = MIGRATIONS.find((m) => m.version === 120)!;
    expect(v120).toBeDefined();
    const legacy = new Database(":memory:");
    legacy.exec(
      `CREATE TABLE supplier_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_id INTEGER, entry_type TEXT, amount_usd REAL, amount_lbp REAL, note TEXT, created_by INTEGER, transaction_id INTEGER, is_auto INTEGER DEFAULT 0, created_at DATETIME)`,
    );
    v120.up(legacy);
    const cols = (
      legacy.prepare(`PRAGMA table_info(supplier_ledger)`).all() as Array<{
        name: string;
      }>
    ).map((c) => c.name);
    expect(cols).toContain("is_refunded");
    expect(cols).toContain("refunded_at");
    v120.down!(legacy);
    const colsAfter = (
      legacy.prepare(`PRAGMA table_info(supplier_ledger)`).all() as Array<{
        name: string;
      }>
    ).map((c) => c.name);
    expect(colsAfter).not.toContain("is_refunded");
    legacy.close();
  });
});
