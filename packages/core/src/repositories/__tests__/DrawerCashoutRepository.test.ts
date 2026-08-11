/**
 * DrawerCashoutRepository — Cash Out (mirrors Drawer Top-Up with the sign
 * flipped): the owner pulls physical cash OUT of the General drawer for a
 * reason that is neither a business expense (must not touch net_profit) nor
 * a drawer-to-drawer transfer.
 *
 * Covers (rule 15 delta/identity assertions, rule 17 failing-first guards):
 *   - insufficient-funds guard rejects BEFORE any write (single currency)
 *   - mixed-currency guard: USD sufficient / LBP short still writes nothing
 *     (proves the whole db.transaction rolled back, not a partial per-currency
 *     write)
 *   - happy path: balances move by exactly the cashout amount, a negative
 *     payments row per currency, a DRAWER_CASHOUT transaction row with
 *     negative amount_usd/amount_lbp
 *   - journal-rebuild identity: ClosingRepository.recalculateDrawerBalances()
 *     reconstructs the SAME balances from the signed payments journal
 */

import Database from "better-sqlite3";
import { DrawerCashoutRepository } from "../DrawerCashoutRepository";
import { ClosingRepository } from "../ClosingRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

// ─── In-memory schema ─────────────────────────────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE drawer_cashouts (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      notes TEXT NOT NULL,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER DEFAULT 1,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
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
      profit_usd REAL,
      profit_lbp REAL,
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
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id     INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Empty on purpose: only queried by the void/refund path, not exercised here.
    CREATE TABLE debt_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      transaction_type TEXT,
      amount_usd REAL,
      amount_lbp REAL,
      transaction_id INTEGER,
      note TEXT,
      created_by INTEGER,
      covered_usd REAL DEFAULT 0,
      covered_lbp REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      due_date DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , refunded_at TEXT DEFAULT NULL);
  `);

  return db;
}

// ─── Mock the connection module ────────────────────────────────────────────────

jest.mock("../../db/connection", () => {
  let _db: Database.Database | null = null;
  return {
    getDatabase: () => {
      if (!_db) throw new Error("DB not initialized");
      return _db;
    },
    setDb: (db: Database.Database) => {
      _db = db;
    },
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function balance(
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

function seedBalance(
  db: Database.Database,
  drawer: string,
  currency: string,
  amount: number,
): void {
  db.prepare(
    `INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, ?, ?, ?)`,
  ).run(drawer, currency, amount);
}

/**
 * Seeds an opening balance THROUGH the payments journal (not a bare
 * drawer_balances row) — required for the journal-rebuild identity test:
 * ClosingRepository.recalculateDrawerBalances() derives balance = SUM(amount)
 * over `payments`, so a balance seeded outside that journal (seedBalance
 * above) would NOT survive a rebuild and the test would fail for the wrong
 * reason (missing opening entry, not a real cashout-posting bug).
 */
function seedOpeningBalanceViaJournal(
  db: Database.Database,
  drawer: string,
  currency: string,
  amount: number,
): void {
  db.prepare(
    `INSERT INTO payments (tenant_id, transaction_id, method, drawer_name, currency_code, amount, note, created_at)
     VALUES (1, NULL, 'CASH', ?, ?, ?, 'Opening balance (test seed)', CURRENT_TIMESTAMP)`,
  ).run(drawer, currency, amount);
  db.prepare(
    `INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance)
     VALUES (1, ?, ?, ?)
     ON CONFLICT(tenant_id, drawer_name, currency_code) DO UPDATE SET balance = excluded.balance`,
  ).run(drawer, currency, amount);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function paymentsRows(db: Database.Database): any[] {
  return db.prepare("SELECT * FROM payments").all() as any[];
}

function cashoutRowCount(db: Database.Database): number {
  return (
    db.prepare("SELECT COUNT(*) c FROM drawer_cashouts").get() as {
      c: number;
    }
  ).c;
}

function transactionRowCount(db: Database.Database): number {
  return (
    db.prepare("SELECT COUNT(*) c FROM transactions").get() as { c: number }
  ).c;
}

describe("DrawerCashoutRepository.createCashout()", () => {
  let db: Database.Database;
  let repo: DrawerCashoutRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    repo = new DrawerCashoutRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  describe("insufficient-funds guard", () => {
    it("throws and writes NOTHING when the requested USD exceeds the General balance", () => {
      seedBalance(db, "General", "USD", 100);

      expect(() =>
        repo.createCashout(
          { amount_usd: 150, amount_lbp: 0, notes: "test" },
          1,
        ),
      ).toThrow(/Insufficient funds/);

      expect(cashoutRowCount(db)).toBe(0);
      expect(transactionRowCount(db)).toBe(0);
      expect(paymentsRows(db)).toHaveLength(0);
      expect(balance(db, "General", "USD")).toBe(100);
    });

    it("throws the exact insufficient-funds message shape for USD", () => {
      seedBalance(db, "General", "USD", 100);

      expect(() =>
        repo.createCashout(
          { amount_usd: 150, amount_lbp: 0, notes: "test" },
          1,
        ),
      ).toThrow(
        "Insufficient funds in General drawer: requested $150.00 USD, available $100.00 USD",
      );
    });

    it("throws the exact insufficient-funds message shape for LBP", () => {
      seedBalance(db, "General", "LBP", 1_000_000);

      expect(() =>
        repo.createCashout(
          { amount_usd: 0, amount_lbp: 2_000_000, notes: "test" },
          1,
        ),
      ).toThrow(
        "Insufficient funds in General drawer: requested 2,000,000 LBP, available 1,000,000 LBP",
      );
    });

    it("treats a missing drawer_balances row as balance 0", () => {
      // No General/USD row seeded at all.
      expect(() =>
        repo.createCashout({ amount_usd: 1, amount_lbp: 0, notes: "test" }, 1),
      ).toThrow(/available \$0\.00 USD/);
      expect(cashoutRowCount(db)).toBe(0);
    });

    it("mixed-currency: USD sufficient but LBP short still writes NOTHING (whole transaction rolls back)", () => {
      seedBalance(db, "General", "USD", 100);
      seedBalance(db, "General", "LBP", 1_000_000);

      expect(() =>
        repo.createCashout(
          { amount_usd: 50, amount_lbp: 5_000_000, notes: "test" },
          1,
        ),
      ).toThrow(/Insufficient funds/);

      expect(cashoutRowCount(db)).toBe(0);
      expect(transactionRowCount(db)).toBe(0);
      expect(paymentsRows(db)).toHaveLength(0);
      // Balances are untouched — not even the USD leg that would have been OK alone.
      expect(balance(db, "General", "USD")).toBe(100);
      expect(balance(db, "General", "LBP")).toBe(1_000_000);
    });
  });

  describe("happy path", () => {
    it("debits General by exactly the cashout amount in both currencies", () => {
      seedBalance(db, "General", "USD", 100);
      seedBalance(db, "General", "LBP", 5_000_000);

      const id = repo.createCashout(
        { amount_usd: 60, amount_lbp: 2_000_000, notes: "Owner personal use" },
        1,
      );

      expect(id).toBeGreaterThan(0);
      expect(balance(db, "General", "USD")).toBeCloseTo(40, 5);
      expect(balance(db, "General", "LBP")).toBeCloseTo(3_000_000, 5);

      const payments = paymentsRows(db);
      expect(payments).toHaveLength(2);

      const usdLeg = payments.find((p) => p.currency_code === "USD");
      expect(usdLeg).toBeDefined();
      expect(usdLeg.amount).toBeCloseTo(-60, 5);
      expect(usdLeg.method).toBe("CASH");
      expect(usdLeg.drawer_name).toBe("General");

      const lbpLeg = payments.find((p) => p.currency_code === "LBP");
      expect(lbpLeg).toBeDefined();
      expect(lbpLeg.amount).toBeCloseTo(-2_000_000, 5);
      expect(lbpLeg.method).toBe("CASH");
      expect(lbpLeg.drawer_name).toBe("General");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const txn = db.prepare("SELECT * FROM transactions").get() as any;
      expect(txn.type).toBe("DRAWER_CASHOUT");
      expect(txn.source_table).toBe("drawer_cashouts");
      expect(txn.source_id).toBe(id);
      expect(txn.amount_usd).toBeCloseTo(-60, 5);
      expect(txn.amount_lbp).toBeCloseTo(-2_000_000, 5);
    });

    it("posts only a USD leg when amount_lbp is 0", () => {
      seedBalance(db, "General", "USD", 100);

      repo.createCashout({ amount_usd: 25, amount_lbp: 0, notes: "test" }, 1);

      expect(balance(db, "General", "USD")).toBeCloseTo(75, 5);
      expect(balance(db, "General", "LBP")).toBe(0);
      expect(paymentsRows(db)).toHaveLength(1);
    });
  });

  describe("journal-rebuild identity", () => {
    it("recalculateDrawerBalances() reconstructs the SAME General balances from the signed payments journal", () => {
      seedOpeningBalanceViaJournal(db, "General", "USD", 100);
      seedOpeningBalanceViaJournal(db, "General", "LBP", 5_000_000);

      repo.createCashout(
        { amount_usd: 60, amount_lbp: 2_000_000, notes: "Owner personal use" },
        1,
      );

      const beforeUsd = balance(db, "General", "USD");
      const beforeLbp = balance(db, "General", "LBP");

      const closingRepo = new ClosingRepository();
      const result = closingRepo.recalculateDrawerBalances();
      expect(result.success).toBe(true);

      expect(balance(db, "General", "USD")).toBeCloseTo(beforeUsd, 5);
      expect(balance(db, "General", "LBP")).toBeCloseTo(beforeLbp, 5);
    });
  });
});
