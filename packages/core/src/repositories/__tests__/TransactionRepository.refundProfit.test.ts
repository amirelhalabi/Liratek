/**
 * TransactionRepository — refund carries NEGATED profit (profit-audit fix 1)
 *
 * Pre-fix, `refundTransaction` inserted the REFUND row WITHOUT profit columns
 * (profit 0). Since the original transaction stays ACTIVE and the profit
 * queries sum SALE + REFUND rows, a fully refunded transaction kept its entire
 * profit forever. The fix stamps profit_usd/profit_lbp = −original on the
 * REFUND row so the pair nets to zero, exactly like the per-item refund path
 * (SalesRepository.refundSaleItem) always did.
 *
 * Void is intentionally different: voidTransaction sets the ORIGINAL to VOIDED
 * (excluded from every profit query), so its reversal row must keep profit 0 —
 * a negative stamp there would double-subtract.
 */

import Database from "better-sqlite3";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL
    );

    CREATE TABLE transactions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      type          TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table  TEXT,
      source_id     INTEGER,
      user_id       INTEGER,
      amount_usd    REAL NOT NULL DEFAULT 0,
      amount_lbp    REAL NOT NULL DEFAULT 0,
      profit_usd    REAL NOT NULL DEFAULT 0,
      profit_lbp    REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id     INTEGER,
      client_name   TEXT,
      client_phone  TEXT,
      reverses_id   INTEGER,
      summary       TEXT,
      metadata_json TEXT,
      device_id     TEXT,
      tenant_id     INTEGER DEFAULT 1,
      created_at    TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id     INTEGER,
      method         TEXT NOT NULL,
      drawer_name    TEXT NOT NULL,
      currency_code  TEXT NOT NULL,
      amount         REAL NOT NULL,
      note           TEXT,
      created_by     INTEGER,
      tenant_id      INTEGER NOT NULL DEFAULT 1,
      created_at     TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id     INTEGER NOT NULL DEFAULT 1,
      drawer_name   TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance       REAL NOT NULL DEFAULT 0,
      updated_at    TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance, updated_at) VALUES (1, 'General', 'USD', 500, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance, updated_at) VALUES (1, 'General', 'LBP', 20000000, CURRENT_TIMESTAMP);

    CREATE TABLE recharges (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      carrier     TEXT,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT,
      tenant_id   INTEGER NOT NULL DEFAULT 1
    );
  `);
  db.prepare(`INSERT INTO users (id, username) VALUES (1, 'cashier')`).run();
  return db;
}

function txnRow(db: Database.Database, id: number) {
  return db
    .prepare(
      `SELECT type, status, profit_usd, profit_lbp, amount_usd, reverses_id FROM transactions WHERE id = ?`,
    )
    .get(id) as {
    type: string;
    status: string;
    profit_usd: number;
    profit_lbp: number;
    amount_usd: number;
    reverses_id: number | null;
  };
}

describe("TransactionRepository — refund profit stamp", () => {
  let db: Database.Database;
  let repo: TransactionRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetTransactionRepository();
    repo = new TransactionRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
    resetTenantContext();
  });

  function seedRecharge(profitUsd: number, profitLbp: number): number {
    db.prepare(`INSERT INTO recharges (id, carrier) VALUES (1, 'MTC')`).run();
    const txnId = repo.createTransaction({
      type: "RECHARGE",
      source_table: "recharges",
      source_id: 1,
      user_id: 1,
      amount_usd: 10,
      amount_lbp: 0,
      profit_usd: profitUsd,
      profit_lbp: profitLbp,
      summary: "Recharge: MTC",
    });
    db.prepare(
      `INSERT INTO payments (transaction_id, method, drawer_name, currency_code, amount)
       VALUES (?, 'CASH', 'General', 'USD', 10)`,
    ).run(txnId);
    return txnId;
  }

  it("stamps −profit on the REFUND row so SALE/module + REFUND net to zero", () => {
    const txnId = seedRecharge(2, 0);

    const refundId = repo.refundTransaction(txnId, 1);

    const refund = txnRow(db, refundId);
    expect(refund.type).toBe("REFUND");
    expect(refund.profit_usd).toBe(-2);
    expect(refund.profit_lbp).toBe(0); // −0 stored as 0
    expect(refund.reverses_id).toBe(txnId);

    // Original stays ACTIVE — netting is the refund row's job.
    expect(txnRow(db, txnId).status).toBe("ACTIVE");

    const netProfit = db
      .prepare(`SELECT COALESCE(SUM(profit_usd), 0) AS p FROM transactions`)
      .get() as { p: number };
    expect(netProfit.p).toBe(0);
  });

  it("stamps −profit_lbp for LBP-profit transactions", () => {
    const txnId = seedRecharge(0, 60_000);
    const refundId = repo.refundTransaction(txnId, 1);
    expect(txnRow(db, refundId).profit_lbp).toBe(-60_000);
  });

  it("marks the module source row is_refunded (module queries drop it)", () => {
    const txnId = seedRecharge(2, 0);
    repo.refundTransaction(txnId, 1);
    const src = db
      .prepare(`SELECT is_refunded FROM recharges WHERE id = 1`)
      .get() as { is_refunded: number };
    expect(src.is_refunded).toBe(1);
  });

  it("void reversal keeps profit 0 (original is VOIDED — no double subtract)", () => {
    const txnId = seedRecharge(2, 0);
    const reversalId = repo.voidTransaction(txnId, 1);

    expect(txnRow(db, txnId).status).toBe("VOIDED");
    expect(txnRow(db, reversalId).profit_usd).toBe(0);

    // Sum over ACTIVE rows only (what profit queries see) — also zero.
    const activeProfit = db
      .prepare(
        `SELECT COALESCE(SUM(profit_usd), 0) AS p FROM transactions WHERE status = 'ACTIVE'`,
      )
      .get() as { p: number };
    expect(activeProfit.p).toBe(0);
  });
});
