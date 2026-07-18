/**
 * CQ-10 — Debt ledger discounts / write-offs.
 *
 * A client's CUSTOMER_ACCOUNT-charged service (a 'Service Debt' row) can be
 * settled part cash + part FORGIVEN ("owed X, paid Y, discount Z"), bundled
 * with a repayment (DebtRepository.addRepayment's `discount` param) or posted
 * standalone (writeOffDebt / DebtService.writeOffDebt). Either way, the
 * discount MUST apply the SAME FIFO coverage a cash repayment gets — a paper
 * adjustment that skips coverage leaves the client's debt looking settled
 * while ProfitRepository's notDebtPending gate stays stuck forever (the
 * exact trap this ticket exists to close).
 *
 * These assertions are constructed to FAIL on code that posts the discount
 * ledger row without applying _markSalesPaidFIFO/_coverServiceDebtsFIFO
 * (rule 17) — verified manually by temporarily neutering that call and
 * re-running (see PR notes); the suite as committed exercises the FIXED code.
 */

import Database from "better-sqlite3";
import { DebtRepository } from "../DebtRepository";
import { DebtService } from "../../services/DebtService";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { counterpartyMetadataSchema } from "../../validators/counterparty";

const RATE = 90_000;

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL);
    INSERT INTO users (id, username) VALUES (1, 'admin');

    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO clients (id, full_name) VALUES (1, 'Discount Client');

    CREATE TABLE financial_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      service_type TEXT DEFAULT 'BILL',
      amount REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      refunded_at DATETIME,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
    INSERT INTO drawer_balances (drawer_name, currency_code, balance, updated_at) VALUES ('General', 'USD', 0, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance, updated_at) VALUES ('General', 'LBP', 0, CURRENT_TIMESTAMP);

    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      transaction_id INTEGER,
      note TEXT,
      due_date TEXT,
      created_by INTEGER,
      edited_by TEXT,
      edited_at DATETIME,
      session_id INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_refunded INTEGER DEFAULT 0,
      covered_usd REAL NOT NULL DEFAULT 0,
      covered_lbp REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      final_amount_usd REAL NOT NULL DEFAULT 0,
      paid_usd REAL NOT NULL DEFAULT 0,
      paid_lbp REAL DEFAULT 0,
      exchange_rate_snapshot REAL DEFAULT 0,
      status TEXT DEFAULT 'completed',
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE exchange_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_code TEXT NOT NULL DEFAULT 'USD',
      to_code TEXT NOT NULL,
      market_rate REAL NOT NULL,
      buy_rate REAL NOT NULL,
      sell_rate REAL NOT NULL,
      is_stronger INTEGER NOT NULL DEFAULT 1,
      tenant_id INTEGER DEFAULT 1
    );
    INSERT INTO exchange_rates (to_code, market_rate, buy_rate, sell_rate, is_stronger)
    VALUES ('LBP', ${RATE}, ${RATE}, ${RATE}, 1);
  `);
  return db;
}

/**
 * Seed a CUSTOMER_ACCOUNT-charged 'Custom Service Debt' the way the app
 * does: a module transaction → debt_ledger row whose transaction_id points
 * at the unified transaction (DBT-1 scenario — the same FIFO gate
 * 'Service Debt' uses). Deliberately NOT 'Service Debt' + an OMT/WHISH
 * provider: that combination triggers addRepayment's system-drawer ROUTING
 * (RESERVE → OMT_System/Whish_System), which is a different, unrelated
 * feature this test doesn't want to entangle with the drawer-movement
 * assertion below.
 */
function seedServiceDebt(
  db: Database.Database,
  clientId: number,
  amountUsd: number,
): number {
  const txn = db
    .prepare(
      `INSERT INTO transactions (type, source_table, source_id, user_id, amount_usd, client_id)
       VALUES ('CUSTOM_SERVICE', 'custom_services', 1, 1, ?, ?)`,
    )
    .run(amountUsd, clientId);
  db.prepare(
    `INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, transaction_id, created_by)
     VALUES (?, 'Custom Service Debt', ?, ?, 1)`,
  ).run(clientId, amountUsd, txn.lastInsertRowid);
  return Number(txn.lastInsertRowid);
}

function clientLedgerSum(db: Database.Database, clientId: number) {
  return db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_lbp), 0) AS lbp
       FROM debt_ledger WHERE client_id = ?`,
    )
    .get(clientId) as { usd: number; lbp: number };
}

function serviceDebtRow(db: Database.Database, clientId: number) {
  return db
    .prepare(
      `SELECT amount_usd, covered_usd FROM debt_ledger
       WHERE client_id = ? AND transaction_type = 'Custom Service Debt'`,
    )
    .get(clientId) as { amount_usd: number; covered_usd: number };
}

function discountTxn(db: Database.Database) {
  return db
    .prepare(
      `SELECT * FROM transactions WHERE type = 'COUNTERPARTY_DISCOUNT' ORDER BY id DESC LIMIT 1`,
    )
    .get() as {
    amount_usd: number;
    amount_lbp: number;
    profit_usd: number;
    profit_lbp: number;
    metadata_json: string;
    status: string;
  };
}

function drawerBalance(db: Database.Database, drawer: string, ccy: string) {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?`,
    )
    .get(drawer, ccy) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

describe("CQ-10 — DebtRepository discount/write-off", () => {
  let db: Database.Database;
  let repo: DebtRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    resetTransactionRepository();
    repo = new DebtRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
  });

  describe("bundled with a repayment (owed $100, paid $60, discount $40)", () => {
    beforeEach(() => {
      seedServiceDebt(db, 1, 100);
    });

    it("nets the client's debt_ledger to exactly 0", () => {
      repo.addRepayment({
        client_id: 1,
        amount_usd: 60,
        amount_lbp: 0,
        created_by: 1,
        discount: { amount_usd: 40, amount_lbp: 0, reason: "goodwill" },
      });
      const sum = clientLedgerSum(db, 1);
      expect(sum.usd).toBeCloseTo(0, 2);
      expect(sum.lbp).toBeCloseTo(0, 2);
    });

    it("fully covers the Service Debt row — the recognition gate (notDebtPending) opens", () => {
      repo.addRepayment({
        client_id: 1,
        amount_usd: 60,
        amount_lbp: 0,
        created_by: 1,
        discount: { amount_usd: 40, amount_lbp: 0 },
      });
      const row = serviceDebtRow(db, 1);
      // notDebtPending's exact predicate: covered_usd >= amount_usd - 0.005
      expect(row.covered_usd).toBeGreaterThanOrEqual(row.amount_usd - 0.005);
    });

    it("posts ONE COUNTERPARTY_DISCOUNT transaction: amount 0, profit = -discount, valid counterparty metadata", () => {
      repo.addRepayment({
        client_id: 1,
        amount_usd: 60,
        amount_lbp: 0,
        created_by: 1,
        discount: { amount_usd: 40, amount_lbp: 0, reason: "goodwill" },
      });
      const txn = discountTxn(db);
      expect(txn.amount_usd).toBe(0);
      expect(txn.amount_lbp).toBe(0);
      expect(txn.profit_usd).toBeCloseTo(-40, 2);
      expect(txn.profit_lbp).toBe(0);
      expect(txn.status).toBe("ACTIVE");

      const meta = JSON.parse(txn.metadata_json);
      const parsed = counterpartyMetadataSchema.parse(meta.counterparty);
      expect(parsed.kind).toBe("client");
      expect(parsed.flow).toBe("IN");
      expect(parsed.discount?.amount_usd).toBeCloseTo(40, 2);
    });

    it("moves the drawer ONLY by the cash part ($60), never the discount", () => {
      repo.addRepayment({
        client_id: 1,
        amount_usd: 60,
        amount_lbp: 0,
        created_by: 1,
        discount: { amount_usd: 40, amount_lbp: 0 },
      });
      expect(drawerBalance(db, "General", "USD")).toBeCloseTo(60, 2);
    });
  });

  describe("standalone write-off (repository level)", () => {
    it("posts a 'Debt Discount' ledger row (negative) + COUNTERPARTY_DISCOUNT txn, and covers an outstanding charge", () => {
      seedServiceDebt(db, 1, 25);
      const result = repo.writeOffDebt({
        client_id: 1,
        amount_usd: 25,
        amount_lbp: 0,
        reason: "full forgiveness",
        created_by: 1,
      });
      expect(result.id).toBeGreaterThan(0);

      const ledgerRow = db
        .prepare(
          `SELECT amount_usd FROM debt_ledger WHERE client_id = 1 AND transaction_type = 'Debt Discount'`,
        )
        .get() as { amount_usd: number };
      expect(ledgerRow.amount_usd).toBeCloseTo(-25, 2);

      expect(clientLedgerSum(db, 1).usd).toBeCloseTo(0, 2);

      const row = serviceDebtRow(db, 1);
      expect(row.covered_usd).toBeGreaterThanOrEqual(row.amount_usd - 0.005);

      // No cash moved by a pure write-off.
      expect(drawerBalance(db, "General", "USD")).toBeCloseTo(0, 2);
    });
  });

  describe("DebtService.writeOffDebt — per-currency balance guard", () => {
    let service: DebtService;

    beforeEach(() => {
      service = new DebtService(repo);
    });

    it("rejects a write-off that exceeds the client's USD debt", () => {
      seedServiceDebt(db, 1, 30);
      const result = service.writeOffDebt({
        clientId: 1,
        amountUSD: 30.5,
        amountLBP: 0,
        userId: 1,
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/exceeds/i);
      // No row written on rejection.
      expect(clientLedgerSum(db, 1).usd).toBeCloseTo(30, 2);
    });

    it("rejects a write-off when the client has no outstanding debt", () => {
      const result = service.writeOffDebt({
        clientId: 1,
        amountUSD: 10,
        amountLBP: 0,
        userId: 1,
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/no outstanding debt/i);
    });

    it("accepts a write-off within the outstanding debt", () => {
      seedServiceDebt(db, 1, 30);
      const result = service.writeOffDebt({
        clientId: 1,
        amountUSD: 30,
        amountLBP: 0,
        userId: 1,
      });
      expect(result.success).toBe(true);
      expect(clientLedgerSum(db, 1).usd).toBeCloseTo(0, 2);
    });
  });
});
