/**
 * NOT RUN — proven at the end-of-batch gate (owner process rule, 2026-09-24
 * batch: build first, verify once at the end).
 *
 * LIRA-201b (owner note #11-B) — session group display, core half.
 *
 * Pre-fix behaviour (`_attachPaymentLegs`, before this change): a session
 * member with no own customer-cash legs INHERITED the whole basket's pooled
 * legs into its own `row.payments` — so every member of a session printed
 * the identical pooled in/out, the "duplicate summary" the owner reported
 * (a -400,000 LBP loto prize row and a 1,280,000 LBP ticket row both showing
 * the same pooled legs). Rule 17: these tests must FAIL on that pre-fix
 * code — reverting the `for (const row of rows)` loop in `_attachPaymentLegs`
 * back to its old `row.payments = own?.length ? own : (session ?
 * basketLegsBySession.get(...) : [])` form (and dropping the
 * `session_payments`/`session_account_payments` assignment) reproduces it:
 * `payments` on a legless member equals the pooled legs instead of `[]`, and
 * `session_payments` is `undefined` throughout.
 *
 * Post-fix contract: `payments` is ALWAYS the row's own legs only (empty
 * array when it has none); the pooled basket legs are exposed on
 * `session_payments`/`session_account_payments` instead, attached to EVERY
 * row of the session so the Transactions viewer can pick whichever member is
 * currently visible (after sort/filter/the LIMIT window) to carry the
 * once-only session-group header — see TransactionsViewer.tsx.
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

    CREATE TABLE customer_session_transactions (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id             INTEGER,
      transaction_type       TEXT,
      transaction_id         INTEGER,
      unified_transaction_id INTEGER,
      tenant_id              INTEGER NOT NULL DEFAULT 1,
      created_at             TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE debt_ledger (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id        INTEGER,
      transaction_type TEXT,
      amount_usd       REAL NOT NULL DEFAULT 0,
      amount_lbp       REAL NOT NULL DEFAULT 0,
      transaction_id   INTEGER,
      session_id       INTEGER,
      note             TEXT,
      created_by       INTEGER,
      tenant_id        INTEGER NOT NULL DEFAULT 1,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);
  `);

  db.prepare(`INSERT INTO users (id, username) VALUES (1, 'cashier')`).run();

  return db;
}

function insertSessionTxn(
  db: Database.Database,
  opts: { id: number; type?: string; summary?: string; sessionId: number },
): void {
  db.prepare(
    `INSERT INTO transactions (id, type, status, user_id, summary, created_at)
     VALUES (?, ?, 'ACTIVE', 1, ?, ?)`,
  ).run(
    opts.id,
    opts.type ?? "SALE",
    opts.summary ?? null,
    `2026-09-24 10:0${opts.id}:00`,
  );
  db.prepare(
    `INSERT INTO customer_session_transactions (session_id, unified_transaction_id)
     VALUES (?, ?)`,
  ).run(opts.sessionId, opts.id);
}

/** A basket-level payment leg: session_id set, transaction_id NULL — the ONE
 *  pooled payment `SessionPaymentService.recordBasketPayment` posts per
 *  session checkout. */
function insertBasketPayment(
  db: Database.Database,
  sessionId: number,
  method: string,
  currency: string,
  amount: number,
): void {
  db.prepare(
    `INSERT INTO payments (session_id, method, drawer_name, currency_code, amount)
     VALUES (?, ?, 'General', ?, ?)`,
  ).run(sessionId, method, currency, amount);
}

/** A member's OWN payment leg (transaction_id set) — e.g. a cost-flow leg
 *  independent of the basket's pooled customer cash. */
function insertOwnPayment(
  db: Database.Database,
  txnId: number,
  method: string,
  currency: string,
  amount: number,
): void {
  db.prepare(
    `INSERT INTO payments (transaction_id, method, drawer_name, currency_code, amount)
     VALUES (?, ?, 'General', ?, ?)`,
  ).run(txnId, method, currency, amount);
}

function insertSessionDebt(
  db: Database.Database,
  opts: { txnId: number; sessionId: number; usd?: number; lbp?: number },
): void {
  db.prepare(
    `INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, transaction_id, session_id)
     VALUES (1, 'Session Debt', ?, ?, ?, ?)`,
  ).run(opts.usd ?? 0, opts.lbp ?? 0, opts.txnId, opts.sessionId);
}

describe("TransactionRepository.getRecent — session group legs (LIRA-201b)", () => {
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

  it("a session member with NO own legs gets an EMPTY payments array, not the pooled basket legs", () => {
    insertSessionTxn(db, { id: 1, type: "LOTO_CASH_PRIZE", sessionId: 7 });
    insertSessionTxn(db, { id: 2, type: "SALE", sessionId: 7 });
    insertBasketPayment(db, 7, "CASH", "USD", 50);

    const rows = repo.getRecent(10);
    const prizeRow = rows.find((r) => r.id === 1)!;
    const saleRow = rows.find((r) => r.id === 2)!;

    // Pre-fix: both of these would equal the pooled [{CASH, USD, 50}] leg —
    // the exact "duplicate summary" bug the owner reported.
    expect(prizeRow.payments).toEqual([]);
    expect(saleRow.payments).toEqual([]);
  });

  it("EVERY member of the session carries the SAME pooled legs on session_payments, regardless of which one has own legs", () => {
    insertSessionTxn(db, { id: 1, type: "LOTO_CASH_PRIZE", sessionId: 7 });
    insertSessionTxn(db, { id: 2, type: "SALE", sessionId: 7 });
    insertBasketPayment(db, 7, "CASH", "USD", 50);
    insertBasketPayment(db, 7, "CASH", "USD", -40); // change returned (OUT)

    const rows = repo.getRecent(10);
    const prizeRow = rows.find((r) => r.id === 1)!;
    const saleRow = rows.find((r) => r.id === 2)!;

    expect(prizeRow.session_payments).toHaveLength(2);
    expect(saleRow.session_payments).toHaveLength(2);
    expect(prizeRow.session_payments).toEqual(saleRow.session_payments);
    expect(
      (prizeRow.session_payments ?? []).map((l) => ({
        direction: l.direction,
        amount: l.amount,
      })),
    ).toEqual(
      expect.arrayContaining([
        { direction: "in", amount: 50 },
        { direction: "out", amount: 40 },
      ]),
    );
  });

  it("a member WITH its own leg keeps it on `payments` AND still carries the pooled session_payments (both fields coexist)", () => {
    // e.g. a basket item that itself posted a cost-flow leg independent of
    // the pooled customer cash.
    insertSessionTxn(db, { id: 1, type: "SALE", sessionId: 7 });
    insertOwnPayment(db, 1, "CASH", "USD", 12);
    insertBasketPayment(db, 7, "CASH", "USD", 50);

    const row = repo.getRecent(10).find((r) => r.id === 1)!;
    expect(row.payments).toHaveLength(1);
    expect(row.payments[0]).toMatchObject({ amount: 12, method: "CASH" });
    expect(row.session_payments).toHaveLength(1);
    expect(row.session_payments![0]).toMatchObject({ amount: 50 });
  });

  it("session_account_payments pools the basket's on-account charge once, absent from every member's own account_payments", () => {
    insertSessionTxn(db, { id: 1, type: "LOTO_CASH_PRIZE", sessionId: 7 });
    insertSessionTxn(db, { id: 2, type: "SALE", sessionId: 7 });
    insertSessionDebt(db, { txnId: 2, sessionId: 7, lbp: 900_000 });

    const rows = repo.getRecent(10);
    const prizeRow = rows.find((r) => r.id === 1)!;
    const saleRow = rows.find((r) => r.id === 2)!;

    expect(prizeRow.account_payments ?? []).toHaveLength(0);
    expect(saleRow.account_payments ?? []).toHaveLength(0);
    expect(prizeRow.session_account_payments).toHaveLength(1);
    expect(saleRow.session_account_payments).toEqual(
      prizeRow.session_account_payments,
    );
  });

  it("a row with no session_id is unaffected: no session_payments field at all, own payments unchanged", () => {
    db.prepare(
      `INSERT INTO transactions (id, type, status, user_id, created_at)
       VALUES (1, 'SALE', 'ACTIVE', 1, '2026-09-24 10:00:00')`,
    ).run();
    insertOwnPayment(db, 1, "CASH", "USD", 20);

    const row = repo.getRecent(10).find((r) => r.id === 1)!;
    expect(row.payments).toHaveLength(1);
    expect(row.session_payments).toBeUndefined();
    expect(row.session_account_payments).toBeUndefined();
  });
});
