/**
 * note 21d — getRecent() must expose whether a transaction has already been
 * refunded, WITHOUT requiring the REFUND row to be loaded on the same
 * page/filter window.
 *
 * The frontend Void/Refund gate (TransactionsViewer) previously only checked
 * `status !== "VOIDED" && type !== "REFUND" && !reverses_id` on the loaded
 * row itself — none of those fields change on the ORIGINAL row when it gets
 * refunded (refundTransaction() deliberately leaves it status=ACTIVE so
 * profit nets across SALE+REFUND — see the class doc near
 * `_markSourceRefunded`). The REFUND row that WOULD reveal the refund lives
 * on a separate row, possibly outside the current page/filter, so the UI
 * can't derive "already refunded" from what it has loaded — it must come
 * from the read model.
 *
 * This test proves `getRecent()` now attaches `reversed_by_id`: the id of
 * the ACTIVE REFUND row whose `reverses_id` points back at this row, or null
 * if it has never been refunded. Failing-first (rule 17): run against the
 * pre-fix `getRecent()` (no `reversed_by_id` in the SELECT) — the column is
 * simply absent/undefined, so the `.toBe(refundId)` assertion fails.
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
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      username  TEXT NOT NULL,
      tenant_id INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE clients (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT,
      tenant_id INTEGER NOT NULL DEFAULT 1
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
      tenant_id     INTEGER NOT NULL DEFAULT 1,
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

    CREATE TABLE customer_session_transactions (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id             INTEGER,
      transaction_type       TEXT,
      transaction_id         INTEGER,
      unified_transaction_id INTEGER,
      tenant_id              INTEGER NOT NULL DEFAULT 1,
      created_at             TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE recharges (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      carrier     TEXT,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT,
      tenant_id   INTEGER NOT NULL DEFAULT 1
    );

    -- _cancelDebt runs unconditionally on every void/refund.
    CREATE TABLE debt_ledger (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id        INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd       REAL NOT NULL DEFAULT 0,
      amount_lbp       REAL NOT NULL DEFAULT 0,
      transaction_id   INTEGER,
      session_id       INTEGER,
      note             TEXT,
      due_date         TEXT,
      created_by       INTEGER,
      tenant_id        INTEGER DEFAULT 1,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);
  `);
  db.prepare(`INSERT INTO users (id, username) VALUES (1, 'cashier')`).run();
  return db;
}

describe("TransactionRepository.getRecent — reversed_by_id (note 21d)", () => {
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

  function seedRecharge(): number {
    db.prepare(`INSERT INTO recharges (id, carrier) VALUES (1, 'MTC')`).run();
    const txnId = repo.createTransaction({
      type: "RECHARGE",
      source_table: "recharges",
      source_id: 1,
      user_id: 1,
      amount_usd: 10,
      amount_lbp: 0,
      summary: "Recharge: MTC",
      metadata_json: { provider: "MTC" },
    });
    db.prepare(
      `INSERT INTO payments (transaction_id, method, drawer_name, currency_code, amount)
       VALUES (?, 'CASH', 'General', 'USD', 10)`,
    ).run(txnId);
    return txnId;
  }

  it("exposes null reversed_by_id on a never-refunded row", () => {
    const txnId = seedRecharge();
    const row = repo.getRecent(10).find((r) => r.id === txnId)!;
    expect(row.reversed_by_id).toBeNull();
  });

  it("exposes the REFUND row's id as reversed_by_id once refunded", () => {
    const txnId = seedRecharge();
    const refundId = repo.refundTransaction(txnId, 1);

    const rows = repo.getRecent(10);
    const original = rows.find((r) => r.id === txnId)!;
    const refund = rows.find((r) => r.id === refundId)!;

    // The original stays ACTIVE (deliberate — profit nets across the pair),
    // so status/reverses_id alone can't tell the UI it's been refunded.
    expect(original.status).toBe("ACTIVE");
    expect(original.reverses_id).toBeNull();
    expect(original.reversed_by_id).toBe(refundId);

    // The REFUND row itself is a reversal (reverses_id set) — never
    // reversed_by_id (a REFUND row can't itself be refunded/voided, see
    // _assertReversible's reverses_id != null guard).
    expect(refund.reversed_by_id).toBeNull();
  });
});
