/**
 * FinancialServiceRepository — Binance (crypto) drawer effect tests
 *
 * Verifies the correct drawer routing for Binance SEND / RECEIVE, where the
 * crypto leg (USDT) and the cash leg (USD) move against DIFFERENT drawers in
 * DIFFERENT currencies. Guards against the LIRA-052 regressions:
 *
 *   SEND  (customer pays cash):
 *     - Binance drawer (USDT): debited by the sent amount
 *     - General drawer (USD):  credited the FULL cash (amount + fee)
 *     - Fee is shop profit, captured implicitly — NO spurious General entry
 *
 *   RECEIVE (shop pays out cash):
 *     - Binance drawer (USDT): credited by the received amount
 *     - General drawer (USD):  debited the payout (amount - fee)
 *     - Fee is shop profit, captured implicitly
 *
 * All tests run against an in-memory SQLite database. DebtService is mocked.
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";

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

    CREATE TABLE debt_ledger (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id        INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd       REAL DEFAULT 0,
      amount_lbp       REAL DEFAULT 0,
      transaction_id   INTEGER,
      note             TEXT,
      created_by       INTEGER,
      due_date         TEXT,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
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
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      provider   TEXT,
      is_active  INTEGER DEFAULT 1,
      is_system  INTEGER DEFAULT 0,
      module_key TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Seed drawer balances (matches the corrected USDT-denominated Binance drawer)
    INSERT INTO drawer_balances VALUES ('General', 'USD',  1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES ('General', 'LBP',     0, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES ('Binance', 'USDT',  500, CURRENT_TIMESTAMP);
  `);

  return db;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seedClient(db: Database.Database): number {
  return Number(
    db
      .prepare("INSERT INTO clients (full_name, phone_number) VALUES (?, ?)")
      .run("Test Client", "0000000000").lastInsertRowid,
  );
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

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("FinancialServiceRepository — Binance crypto drawer effects", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    repo = new FinancialServiceRepository();
    mockAddCredit.mockClear();
  });

  afterEach(() => {
    db.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SEND — customer pays cash, shop sends crypto
  // ═══════════════════════════════════════════════════════════════════════════

  describe("SEND (customer pays $102 cash, sends 100 USDT, $2 fee)", () => {
    function doSend() {
      return repo.createTransaction({
        provider: "BINANCE",
        serviceType: "SEND",
        amount: 100, // USDT
        currency: "USDT",
        commission: 2, // $2 fee (shop profit)
        paidByMethod: "CASH",
      });
    }

    it("debits the Binance drawer (USDT) by the sent amount", () => {
      const before = drawerBalance(db, "Binance", "USDT");
      doSend();
      expect(drawerBalance(db, "Binance", "USDT")).toBeCloseTo(before - 100, 2);
    });

    it("credits the General drawer (USD) the FULL cash paid (amount + fee)", () => {
      const before = drawerBalance(db, "General", "USD");
      doSend();
      // Customer handed over $102 cash → General must gain the full $102
      expect(drawerBalance(db, "General", "USD")).toBeCloseTo(before + 102, 2);
    });

    it("does NOT create a USDT entry on the General drawer (regression guard)", () => {
      doSend();
      // The old bug credited the $2 fee to General in USDT; must be zero now
      expect(drawerBalance(db, "General", "USDT")).toBe(0);
    });

    it("does not touch the General USD drawer beyond the single cash credit", () => {
      doSend();
      const generalRows = db
        .prepare(
          `SELECT amount FROM payments
            WHERE drawer_name = 'General' AND currency_code = 'USD' AND amount <> 0`,
        )
        .all() as Array<{ amount: number }>;
      // Exactly one drawer-moving General row of +102 (no spurious fee row)
      expect(generalRows).toHaveLength(1);
      expect(generalRows[0].amount).toBeCloseTo(102, 2);
    });

    it("realizes the fee as a $2 spread (cash in 102 USD − crypto out 100 USDT)", () => {
      const genBefore = drawerBalance(db, "General", "USD");
      const binBefore = drawerBalance(db, "Binance", "USDT");
      doSend();
      const genDelta = drawerBalance(db, "General", "USD") - genBefore;
      const binDelta = drawerBalance(db, "Binance", "USDT") - binBefore;
      expect(genDelta + binDelta).toBeCloseTo(2, 2); // +102 + (-100) = +2 profit
    });

    it("routes a CUSTOMER_ACCOUNT (on-account) SEND to debt, not the drawer", () => {
      const clientId = seedClient(db);
      const generalBefore = drawerBalance(db, "General", "USD");

      repo.createTransaction({
        provider: "BINANCE",
        serviceType: "SEND",
        amount: 100,
        currency: "USDT",
        commission: 2,
        paidByMethod: "CUSTOMER_ACCOUNT",
        clientId,
        clientName: "Test Client",
        phoneNumber: "0000000000",
      });

      // Binance still debited, but no cash hits General; debt records the $102
      expect(drawerBalance(db, "Binance", "USDT")).toBeCloseTo(400, 2);
      expect(drawerBalance(db, "General", "USD")).toBe(generalBefore);

      const debt = db
        .prepare(
          `SELECT amount_usd FROM debt_ledger WHERE client_id = ? ORDER BY id DESC LIMIT 1`,
        )
        .get(clientId) as { amount_usd: number } | undefined;
      expect(debt?.amount_usd).toBeCloseTo(102, 2);
    });

    it("handles a zero-fee SEND (General gets exactly the principal)", () => {
      const generalBefore = drawerBalance(db, "General", "USD");
      repo.createTransaction({
        provider: "BINANCE",
        serviceType: "SEND",
        amount: 50,
        currency: "USDT",
        commission: 0,
        paidByMethod: "CASH",
      });
      expect(drawerBalance(db, "General", "USD")).toBeCloseTo(
        generalBefore + 50,
        2,
      );
      expect(drawerBalance(db, "Binance", "USDT")).toBeCloseTo(450, 2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // RECEIVE — crypto arrives, shop pays out cash
  // ═══════════════════════════════════════════════════════════════════════════

  describe("RECEIVE (receives 100 USDT, pays out $98 cash, $2 fee)", () => {
    function doReceive(cashoutMethod: "CASH" = "CASH") {
      return repo.createTransaction({
        provider: "BINANCE",
        serviceType: "RECEIVE",
        amount: 100, // USDT
        currency: "USDT",
        commission: 2,
        cashoutMethod,
      });
    }

    it("credits the Binance drawer (USDT) by the received amount", () => {
      const before = drawerBalance(db, "Binance", "USDT");
      doReceive();
      expect(drawerBalance(db, "Binance", "USDT")).toBeCloseTo(before + 100, 2);
    });

    it("debits the General drawer (USD) the payout (amount - fee)", () => {
      const before = drawerBalance(db, "General", "USD");
      doReceive();
      expect(drawerBalance(db, "General", "USD")).toBeCloseTo(before - 98, 2);
    });

    it("does NOT create a USDT entry on the General drawer (regression guard)", () => {
      doReceive();
      expect(drawerBalance(db, "General", "USDT")).toBe(0);
    });

    it("realizes the fee as a $2 spread (crypto in 100 USDT − cash out 98 USD)", () => {
      const genBefore = drawerBalance(db, "General", "USD");
      const binBefore = drawerBalance(db, "Binance", "USDT");
      doReceive();
      const genDelta = drawerBalance(db, "General", "USD") - genBefore; // -98
      const binDelta = drawerBalance(db, "Binance", "USDT") - binBefore; // +100
      expect(genDelta + binDelta).toBeCloseTo(2, 2);
    });

    it("credits the client account on a CUSTOMER_ACCOUNT cashout instead of cash", () => {
      const clientId = seedClient(db);
      const generalBefore = drawerBalance(db, "General", "USD");

      repo.createTransaction({
        provider: "BINANCE",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USDT",
        commission: 2,
        cashoutMethod: "CUSTOMER_ACCOUNT",
        clientId,
        clientName: "Test Client",
        phoneNumber: "0000000000",
      });

      // Binance credited, General untouched, client account credited the payout
      expect(drawerBalance(db, "Binance", "USDT")).toBeCloseTo(600, 2);
      expect(drawerBalance(db, "General", "USD")).toBe(generalBefore);
      expect(mockAddCredit).toHaveBeenCalledTimes(1);
      expect(mockAddCredit).toHaveBeenCalledWith(
        expect.objectContaining({ clientId, amountUsd: 98 }),
      );
    });
  });
});
