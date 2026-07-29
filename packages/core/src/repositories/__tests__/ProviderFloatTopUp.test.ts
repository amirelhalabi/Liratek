/**
 * DrawerTopUpRepository.fundSystemDrawer — operator funds the OMT_System /
 * Whish_System spendable float directly (owner-confirmed 2026-07-29 float
 * model). This is the missing direction next to createTopUpFromDrawer, which
 * only ever moves the system drawer's balance OUT to General.
 *
 * Both legs post via insertPaymentRow + applyDrawerDelta (never a raw
 * deductBalance) so the flow stays reversible via the generic void path —
 * proven below. Profit is always 0 (a same-shop cash move, not revenue).
 */

import Database from "better-sqlite3";
import { DrawerTopUpRepository } from "../DrawerTopUpRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE system_float_topups (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_drawer TEXT NOT NULL,
      funding_drawer TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_by INTEGER,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT DEFAULT NULL,
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

    -- Empty on purpose: _cancelDebt (run by every void/refund) queries this
    -- table unconditionally with no existence check.
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
    );

    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 500);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 50_000_000);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT_System', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT_System', 'LBP', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Whish_System', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Whish_System', 'LBP', 0);
  `);

  return db;
}

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

describe("DrawerTopUpRepository.fundSystemDrawer()", () => {
  let db: Database.Database;
  let repo: DrawerTopUpRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    repo = new DrawerTopUpRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  it("(a) happy path USD: funding drawer -100, system float +100, sigma = 0, profit 0", () => {
    const id = repo.fundSystemDrawer(
      {
        targetDrawer: "OMT_System",
        fundingDrawer: "General",
        amount_usd: 100,
        amount_lbp: 0,
      },
      1,
    );

    expect(balance(db, "General", "USD")).toBeCloseTo(400, 2); // 500 - 100
    expect(balance(db, "OMT_System", "USD")).toBeCloseTo(100, 2); // 0 + 100
    // Sigma of drawer deltas is 0: -100 (General) + 100 (OMT_System) = 0.
    expect(balance(db, "General", "USD") + balance(db, "OMT_System", "USD")).toBeCloseTo(
      500,
      2,
    );

    const txn = db
      .prepare("SELECT * FROM transactions WHERE type = 'SYSTEM_FLOAT_TOPUP'")
      .get() as any;
    expect(txn).toBeDefined();
    expect(txn.source_table).toBe("system_float_topups");
    expect(txn.source_id).toBe(id);
    expect(txn.amount_usd).toBeCloseTo(100, 2);
    expect(txn.amount_lbp).toBeCloseTo(0, 2);
    expect(txn.profit_usd).toBe(0);
    expect(txn.profit_lbp).toBe(0);

    const legs = db
      .prepare("SELECT * FROM payments WHERE transaction_id = ? ORDER BY id")
      .all(txn.id) as any[];
    expect(legs).toHaveLength(2);
    expect(legs[0].drawer_name).toBe("General");
    expect(legs[0].amount).toBeCloseTo(-100, 2);
    expect(legs[1].drawer_name).toBe("OMT_System");
    expect(legs[1].amount).toBeCloseTo(100, 2);
  });

  it("(b) happy path LBP: LBP is not silently treated as USD", () => {
    const id = repo.fundSystemDrawer(
      {
        targetDrawer: "Whish_System",
        fundingDrawer: "General",
        amount_usd: 0,
        amount_lbp: 9_000_000,
      },
      1,
    );

    expect(balance(db, "General", "LBP")).toBeCloseTo(41_000_000, 0); // 50M - 9M
    expect(balance(db, "Whish_System", "LBP")).toBeCloseTo(9_000_000, 0);
    // USD legs must NOT be touched by an LBP-only top-up.
    expect(balance(db, "General", "USD")).toBeCloseTo(500, 2);
    expect(balance(db, "Whish_System", "USD")).toBeCloseTo(0, 2);

    const txn = db
      .prepare("SELECT * FROM transactions WHERE type = 'SYSTEM_FLOAT_TOPUP'")
      .get() as any;
    expect(txn.amount_usd).toBeCloseTo(0, 2);
    expect(txn.amount_lbp).toBeCloseTo(9_000_000, 0);

    const legs = db
      .prepare("SELECT * FROM payments WHERE transaction_id = ? ORDER BY id")
      .all(txn.id) as any[];
    expect(legs).toHaveLength(2);
    expect(legs.every((l) => l.currency_code === "LBP")).toBe(true);
    void id;
  });

  it("(c) insufficient funds in the funding drawer -> rejected, nothing moved (rolls back)", () => {
    expect(() =>
      repo.fundSystemDrawer(
        {
          targetDrawer: "OMT_System",
          fundingDrawer: "General",
          amount_usd: 5_000, // only 500 available
          amount_lbp: 0,
        },
        1,
      ),
    ).toThrow(/Insufficient USD balance/);

    expect(balance(db, "General", "USD")).toBeCloseTo(500, 2);
    expect(balance(db, "OMT_System", "USD")).toBeCloseTo(0, 2);
    expect(
      (db.prepare("SELECT COUNT(*) c FROM system_float_topups").get() as any)
        .c,
    ).toBe(0);
    expect(
      (db.prepare("SELECT COUNT(*) c FROM transactions").get() as any).c,
    ).toBe(0);
    expect(
      (db.prepare("SELECT COUNT(*) c FROM payments").get() as any).c,
    ).toBe(0);
  });

  it("(c2) insufficient LBP funds -> rejected, nothing moved even though USD is fine", () => {
    expect(() =>
      repo.fundSystemDrawer(
        {
          targetDrawer: "OMT_System",
          fundingDrawer: "General",
          amount_usd: 50, // plenty available
          amount_lbp: 900_000_000, // way more than 50,000,000 available
        },
        1,
      ),
    ).toThrow(/Insufficient LBP balance/);

    // Nothing moved at all — not even the USD leg that would have succeeded
    // on its own — because the whole db.transaction rolled back.
    expect(balance(db, "General", "USD")).toBeCloseTo(500, 2);
    expect(balance(db, "General", "LBP")).toBeCloseTo(50_000_000, 0);
    expect(balance(db, "OMT_System", "USD")).toBeCloseTo(0, 2);
    expect(
      (db.prepare("SELECT COUNT(*) c FROM transactions").get() as any).c,
    ).toBe(0);
  });

  it("(d) both Whish_System and OMT_System work", () => {
    repo.fundSystemDrawer(
      {
        targetDrawer: "OMT_System",
        fundingDrawer: "General",
        amount_usd: 50,
        amount_lbp: 0,
      },
      1,
    );
    repo.fundSystemDrawer(
      {
        targetDrawer: "Whish_System",
        fundingDrawer: "General",
        amount_usd: 30,
        amount_lbp: 0,
      },
      1,
    );

    expect(balance(db, "OMT_System", "USD")).toBeCloseTo(50, 2);
    expect(balance(db, "Whish_System", "USD")).toBeCloseTo(30, 2);
    expect(balance(db, "General", "USD")).toBeCloseTo(420, 2); // 500 - 50 - 30
  });

  it('(e) an invalid target drawer ("General") is REJECTED — cannot invent money in an arbitrary drawer', () => {
    expect(() =>
      repo.fundSystemDrawer(
        {
          targetDrawer: "General" as any,
          fundingDrawer: "OMT_System",
          amount_usd: 10,
          amount_lbp: 0,
        },
        1,
      ),
    ).toThrow(/Invalid target drawer/);

    expect(
      (db.prepare("SELECT COUNT(*) c FROM transactions").get() as any).c,
    ).toBe(0);
  });

  it('(e2) a typo\'d target drawer ("Omt_system") is REJECTED', () => {
    expect(() =>
      repo.fundSystemDrawer(
        {
          targetDrawer: "Omt_system" as any,
          fundingDrawer: "General",
          amount_usd: 10,
          amount_lbp: 0,
        },
        1,
      ),
    ).toThrow(/Invalid target drawer/);
  });

  it("(g) SELF-FUNDING is REJECTED: fundingDrawer === targetDrawer must not write a self-transfer row", () => {
    expect(() =>
      repo.fundSystemDrawer(
        {
          targetDrawer: "OMT_System",
          fundingDrawer: "OMT_System",
          amount_usd: 200,
          amount_lbp: 0,
        },
        1,
      ),
    ).toThrow(/fund(ing)?[ _]?[Dd]rawer.*(same|itself)|same drawer/i);

    // Balance must be untouched — 200 in, 200 out nets to the same number,
    // but that's exactly the bug: a real transfer that never happened.
    expect(balance(db, "OMT_System", "USD")).toBeCloseTo(0, 2);
    expect(
      (db.prepare("SELECT COUNT(*) c FROM system_float_topups").get() as any)
        .c,
    ).toBe(0);
    expect(
      (db.prepare("SELECT COUNT(*) c FROM transactions").get() as any).c,
    ).toBe(0);
    expect(
      (db.prepare("SELECT COUNT(*) c FROM payments").get() as any).c,
    ).toBe(0);
  });

  it("(h) a non-finite amount_usd (e.g. -Infinity from a caller bypassing Zod) is REJECTED before any row is written", () => {
    expect(() =>
      repo.fundSystemDrawer(
        {
          targetDrawer: "OMT_System",
          fundingDrawer: "General",
          amount_usd: -Infinity,
          amount_lbp: 0,
        },
        1,
      ),
    ).toThrow(/finite/i);

    expect(
      (db.prepare("SELECT COUNT(*) c FROM system_float_topups").get() as any)
        .c,
    ).toBe(0);
    expect(
      (db.prepare("SELECT COUNT(*) c FROM transactions").get() as any).c,
    ).toBe(0);
    expect(
      (db.prepare("SELECT COUNT(*) c FROM payments").get() as any).c,
    ).toBe(0);
    // The balance columns must not have been poisoned either.
    expect(balance(db, "General", "USD")).toBeCloseTo(500, 2);
    expect(balance(db, "OMT_System", "USD")).toBeCloseTo(0, 2);
  });

  it("(h2) a NaN amount is REJECTED before any row is written", () => {
    expect(() =>
      repo.fundSystemDrawer(
        {
          targetDrawer: "OMT_System",
          fundingDrawer: "General",
          amount_usd: NaN,
          amount_lbp: 0,
        },
        1,
      ),
    ).toThrow(/finite/i);

    expect(
      (db.prepare("SELECT COUNT(*) c FROM transactions").get() as any).c,
    ).toBe(0);
  });

  it("(h3) a negative amount is REJECTED before any row is written", () => {
    expect(() =>
      repo.fundSystemDrawer(
        {
          targetDrawer: "OMT_System",
          fundingDrawer: "General",
          amount_usd: -50,
          amount_lbp: 0,
        },
        1,
      ),
    ).toThrow();

    expect(
      (db.prepare("SELECT COUNT(*) c FROM transactions").get() as any).c,
    ).toBe(0);
  });

  it("(h4) an all-zero top-up (both amounts 0) is REJECTED as another no-op row", () => {
    expect(() =>
      repo.fundSystemDrawer(
        {
          targetDrawer: "OMT_System",
          fundingDrawer: "General",
          amount_usd: 0,
          amount_lbp: 0,
        },
        1,
      ),
    ).toThrow();

    expect(
      (db.prepare("SELECT COUNT(*) c FROM system_float_topups").get() as any)
        .c,
    ).toBe(0);
    expect(
      (db.prepare("SELECT COUNT(*) c FROM transactions").get() as any).c,
    ).toBe(0);
  });

  it("(f) REVERSAL: void restores both drawers to their exact pre-transaction values", () => {
    repo.fundSystemDrawer(
      {
        targetDrawer: "OMT_System",
        fundingDrawer: "General",
        amount_usd: 100,
        amount_lbp: 4_000_000,
      },
      1,
    );

    expect(balance(db, "General", "USD")).toBeCloseTo(400, 2);
    expect(balance(db, "General", "LBP")).toBeCloseTo(46_000_000, 0);
    expect(balance(db, "OMT_System", "USD")).toBeCloseTo(100, 2);
    expect(balance(db, "OMT_System", "LBP")).toBeCloseTo(4_000_000, 0);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getTransactionRepository } = require("../TransactionRepository");
    const txnRepo = getTransactionRepository();
    const original = db
      .prepare("SELECT * FROM transactions WHERE type = 'SYSTEM_FLOAT_TOPUP'")
      .get() as any;

    console.log("DEBUG original", original);
    txnRepo.voidTransaction(original.id, 1);
    console.log(
      "DEBUG after void, system_float_topups row:",
      db.prepare("SELECT * FROM system_float_topups WHERE id = ?").get(original.source_id),
    );

    // Back to the exact pre-top-up balances — net effect of create + void is
    // 0 on both drawers, both currencies.
    expect(balance(db, "General", "USD")).toBeCloseTo(500, 2);
    expect(balance(db, "General", "LBP")).toBeCloseTo(50_000_000, 0);
    expect(balance(db, "OMT_System", "USD")).toBeCloseTo(0, 2);
    expect(balance(db, "OMT_System", "LBP")).toBeCloseTo(0, 0);

    const sourceRow = db
      .prepare("SELECT * FROM system_float_topups WHERE id = ?")
      .get(original.source_id) as any;
    expect(sourceRow.is_refunded).toBe(1);

    // Reversing twice must not double-apply — the generic path guards
    // against re-voiding an already-voided transaction.
    expect(() => txnRepo.voidTransaction(original.id, 1)).toThrow();
    expect(balance(db, "General", "USD")).toBeCloseTo(500, 2);
    expect(balance(db, "OMT_System", "USD")).toBeCloseTo(0, 2);
  });
});
