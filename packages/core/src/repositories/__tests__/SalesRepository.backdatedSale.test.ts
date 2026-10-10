/**
 * LIRA-298 — a backdated POS sale lands on its chosen day.
 *
 * The cashier can override the sale time at checkout (`CheckoutModal.tsx`
 * sends `transaction_time`, an ISO datetime). The main defect was at the
 * transport edge — `saleProcessSchema` had no `transaction_time` key, so Zod
 * stripped it on BOTH transports (see
 * `validators/__tests__/saleProcess.transactionTime.schema.test.ts`, the
 * backend route test and the IPC handler test). This file pins what the
 * repository does once the field reaches it:
 *
 *   - `sales.created_at` and the unified SALE `transactions.created_at` are
 *     the chosen time — so Sales lists, the Transactions table, Profits
 *     (`getSalesProfit` buckets by `s.created_at`) and the cash-flow-by-date
 *     report (`getCashFlowByDate` buckets sale legs by `t.created_at`) all
 *     put the sale on that day;
 *   - the `payments` rows keep the real posting time, like every other
 *     module (no writer passes `createdAt` to `insertPaymentRow`): the
 *     dashboard's "cash collected today" deliberately counts a leg on the day
 *     it actually posted, the same moment the running drawer balance moved.
 *
 * Rule 17 status:
 *   - "new backdated sale" — NOT proven failing-first: the repository already
 *     honoured `transaction_time` for a NEW sale; only the schema dropped it.
 *   - "completing a resumed draft" — written first and run against the
 *     unfixed code: the UPDATE branch never touched `created_at`, so the sale
 *     (and therefore its Profits day) stayed on the day the draft was saved
 *     while only the transactions row moved. Recorded in the LIRA-298 report.
 *   - "saving a DRAFT with a custom time" — written first and run against the
 *     first fix (which stamped the time on every save): failed with
 *     `Expected: not "2026-10-05T09:00:00.000Z"`. The repository now applies
 *     the time to `sales.created_at` only when the sale is completed.
 */

import Database from "better-sqlite3";
import { SalesRepository } from "../SalesRepository.js";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository.js";
import { ProfitRepository } from "../ProfitRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

// 09:00 UTC = 12:00 Beirut — the same calendar day in every zone from
// UTC−9 to UTC+14, so the assertions do not depend on the runner's TZ.
const BACKDATED = "2026-10-05T09:00:00.000Z";
const DAY = "2026-10-05";
const DRAFT_SAVED_AT = "2026-10-01 09:00:00";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL
    );

    CREATE TABLE clients (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name       TEXT NOT NULL,
      phone_number    TEXT,
      whatsapp_opt_in INTEGER DEFAULT 0,
      tenant_id       INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at      TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE products (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      name           TEXT NOT NULL,
      cost_price_usd REAL NOT NULL DEFAULT 0,
      stock_quantity INTEGER NOT NULL DEFAULT 0,
      warranty_months INTEGER,
      tenant_id      INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE sales (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id              INTEGER,
      total_amount_usd       REAL NOT NULL DEFAULT 0,
      discount_usd           REAL NOT NULL DEFAULT 0,
      final_amount_usd       REAL NOT NULL DEFAULT 0,
      paid_usd               REAL NOT NULL DEFAULT 0,
      paid_lbp               REAL NOT NULL DEFAULT 0,
      change_given_usd       REAL NOT NULL DEFAULT 0,
      change_given_lbp       REAL NOT NULL DEFAULT 0,
      exchange_rate_snapshot REAL,
      drawer_name            TEXT DEFAULT 'General',
      status                 TEXT NOT NULL DEFAULT 'completed',
      note                   TEXT,
      edited_by              TEXT,
      edited_at              TEXT,
      tenant_id              INTEGER NOT NULL DEFAULT 1,
      created_at             TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at             TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE sale_items (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id                 INTEGER NOT NULL,
      product_id              INTEGER,
      quantity                INTEGER NOT NULL DEFAULT 1,
      sold_price_usd          REAL NOT NULL DEFAULT 0,
      cost_price_snapshot_usd REAL NOT NULL DEFAULT 0,
      imei                    TEXT,
      warranty_until          TEXT,
      is_refunded             INTEGER NOT NULL DEFAULT 0,
      refunded_quantity       INTEGER NOT NULL DEFAULT 0,
      tenant_id               INTEGER NOT NULL DEFAULT 1
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

    CREATE TABLE debt_ledger (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id        INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd       REAL NOT NULL DEFAULT 0,
      amount_lbp       REAL,
      transaction_id   INTEGER,
      note             TEXT,
      due_date         TEXT,
      created_by       INTEGER,
      tenant_id        INTEGER NOT NULL DEFAULT 1,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

    -- See CLAUDE.md "Test schemas silently void whole files" — SalesRepository
    -- unconditionally touches these two tables even for products with no
    -- batch history.
    CREATE TABLE product_stock_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      product_id INTEGER NOT NULL,
      supplier_id INTEGER,
      quantity INTEGER NOT NULL,
      quantity_remaining INTEGER NOT NULL,
      unit_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      books_debt INTEGER NOT NULL DEFAULT 0,
      ledger_entry_id INTEGER,
      transaction_id INTEGER,
      is_opening INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE stock_batch_consumptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      batch_id INTEGER NOT NULL,
      sale_item_id INTEGER,
      custom_service_id INTEGER,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      unit_cost_usd DECIMAL(10,2) NOT NULL,
      reason TEXT NOT NULL DEFAULT 'SALE',
      is_restored INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      maintenance_part_id INTEGER
    );
  `);
  // ProfitRepository.getSalesProfit's recognition weight reads it.
  db.exec(`
    CREATE TABLE partner_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      partner_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      reference_table TEXT,
      reference_id INTEGER,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      direction TEXT NOT NULL,
      notes TEXT,
      user_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      covered_amount REAL NOT NULL DEFAULT 0
    );
  `);
  db.prepare(`INSERT INTO users (id, username) VALUES (1, 'cashier')`).run();
  db.prepare(
    `INSERT INTO products (id, name, cost_price_usd, stock_quantity)
     VALUES (1, 'Phone case', 3, 10)`,
  ).run();
  return db;
}

function saleRow(db: Database.Database, saleId: number) {
  return db
    .prepare(`SELECT created_at FROM sales WHERE id = ?`)
    .get(saleId) as { created_at: string };
}

function saleTxn(db: Database.Database, saleId: number) {
  return db
    .prepare(
      `SELECT id, created_at, profit_usd FROM transactions
        WHERE source_table = 'sales' AND source_id = ? AND type = 'SALE'`,
    )
    .get(saleId) as { id: number; created_at: string; profit_usd: number };
}

function paymentCreatedAt(db: Database.Database, txnId: number): string[] {
  return (
    db
      .prepare(`SELECT created_at FROM payments WHERE transaction_id = ?`)
      .all(txnId) as { created_at: string }[]
  ).map((r) => r.created_at);
}

const sqliteNowDay = (db: Database.Database): string =>
  (db.prepare(`SELECT DATE('now') AS d`).get() as { d: string }).d;

describe("LIRA-298 — a backdated sale lands on its chosen day", () => {
  let db: Database.Database;
  let repo: SalesRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetTransactionRepository();
    repo = new SalesRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
    resetTenantContext();
  });

  const SALE = {
    client_id: null,
    items: [{ product_id: 1, quantity: 1, price: 8 }],
    total_amount: 8,
    discount: 0,
    final_amount: 8,
    payment_usd: 8,
    payment_lbp: 0,
    exchange_rate: 90_000,
  };

  function expectOnChosenDay(saleId: number): void {
    expect(saleRow(db, saleId).created_at).toBe(BACKDATED);
    const txn = saleTxn(db, saleId);
    expect(txn.created_at).toBe(BACKDATED);
    // Profit: item margin $8 − $3 cost = $5, on the chosen day only.
    expect(txn.profit_usd).toBeCloseTo(5);
    const profits = new ProfitRepository();
    expect(
      profits.getSalesProfit(`${DAY} 00:00:00`, `${DAY} 23:59:59`).profit_usd,
    ).toBeCloseTo(5);
    const today = sqliteNowDay(db);
    expect(
      profits.getSalesProfit(`${today} 00:00:00`, `${today} 23:59:59`)
        .profit_usd,
    ).toBeCloseTo(0);
    // Drawer movement by business date: the $8 cash leg is on the chosen day.
    const flow = getTransactionRepository().getCashFlowByDate(DAY, DAY);
    expect(flow).toEqual([
      expect.objectContaining({ date: DAY, currency_code: "USD", total_in: 8 }),
    ]);
    // The payment row itself keeps its real posting time (codebase-wide
    // convention, see header) — today, not the backdated day.
    const legs = paymentCreatedAt(db, txn.id);
    expect(legs).toHaveLength(1);
    expect(legs[0]!.slice(0, 10)).toBe(today);
  }

  it("a new backdated sale: sale, transaction, profit and cash flow are on the chosen day", () => {
    const res = repo.processSale(
      { ...SALE, status: "completed", transaction_time: BACKDATED },
      1,
    );
    expect(res.success).toBe(true);
    expectOnChosenDay(res.id!);
  });

  it("completing a resumed draft with a backdated time moves the sale to the chosen day", () => {
    const draft = repo.processSale({ ...SALE, status: "draft" }, 1);
    expect(draft.success).toBe(true);
    const saleId = draft.id!;
    // The draft was saved on an earlier day.
    db.prepare(`UPDATE sales SET created_at = ? WHERE id = ?`).run(
      DRAFT_SAVED_AT,
      saleId,
    );

    const done = repo.processSale(
      {
        ...SALE,
        id: saleId,
        status: "completed",
        transaction_time: BACKDATED,
      },
      1,
    );
    expect(done.success).toBe(true);
    expectOnChosenDay(saleId);
  });

  it("saving a DRAFT with a custom time does not backdate it — only completion applies the time", () => {
    // The checkout's custom time is plain component state: resuming a draft
    // starts it empty. Had the draft save stamped `sales.created_at`, a
    // draft saved with a custom time and completed later WITHOUT one would
    // land in Sales/Profits on the custom day while its transactions row
    // says "now" — the very split LIRA-298 fixes.
    const draft = repo.processSale(
      { ...SALE, status: "draft", transaction_time: BACKDATED },
      1,
    );
    expect(draft.success).toBe(true);
    const saleId = draft.id!;
    expect(saleRow(db, saleId).created_at).not.toBe(BACKDATED);

    // Re-save of the same draft with the time: still not applied.
    repo.processSale(
      { ...SALE, id: saleId, status: "draft", transaction_time: BACKDATED },
      1,
    );
    expect(saleRow(db, saleId).created_at).not.toBe(BACKDATED);

    // Completing with the time applies it everywhere.
    repo.processSale(
      { ...SALE, id: saleId, status: "completed", transaction_time: BACKDATED },
      1,
    );
    expectOnChosenDay(saleId);
  });

  // Pre-existing behaviour, unchanged by LIRA-298 (NOT a statement of intent):
  // a draft completed later without a custom time keeps the draft's day on
  // the sale (Sales/Profits) while its transactions row is dated at
  // completion. Recorded as a follow-up in current_sprint.md.
  it("completing a resumed draft WITHOUT a backdated time keeps the draft's own date", () => {
    const draft = repo.processSale({ ...SALE, status: "draft" }, 1);
    const saleId = draft.id!;
    db.prepare(`UPDATE sales SET created_at = ? WHERE id = ?`).run(
      DRAFT_SAVED_AT,
      saleId,
    );
    repo.processSale({ ...SALE, id: saleId, status: "completed" }, 1);
    expect(saleRow(db, saleId).created_at).toBe(DRAFT_SAVED_AT);
  });
});
