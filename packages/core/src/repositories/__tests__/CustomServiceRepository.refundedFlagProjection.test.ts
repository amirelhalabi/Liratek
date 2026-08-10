/**
 * CustomServiceRepository — refunded-flag projection (LIRA-130)
 *
 * Owner report: a for-partner custom service ("7welet syria 100$", cost
 * $100 / price $110) was refunded. The `transactions` table is correct
 * (original marked REFUNDED, plus a REFUND row) — `_markSourceRefunded`
 * (TransactionRepository.ts) DOES write `custom_services.is_refunded = 1`
 * and `refunded_at`, because `custom_services` is in its supported-tables
 * whitelist. But `CustomServiceRepository.getColumns()` never selected
 * either column, so the Custom Services history (which reads through
 * `getAll()`/`getById()`, shared by both the IPC handler and the REST route
 * via `CustomServiceService.getServices()`) silently dropped the flag and
 * showed a refunded service as an ordinary live row.
 *
 * This is the real end-to-end proof: create a service, refund it through
 * the SAME generic path the Transactions page uses
 * (`TransactionRepository.refundTransaction`, mirroring
 * `CustomServiceRepository.stock.test.ts`'s "GENERIC Transactions-table
 * path" scaffold), then read it back through `getAll()`/`getById()` and
 * assert the flag survives the round trip. `getColumns()` is a single
 * shared method — this test also proves BOTH read methods, which is
 * everything the IPC handler (`custom-services:list`/`custom-services:get`)
 * and the REST routes (`GET /api/custom-services`, `GET
 * /api/custom-services/:id`) call, so a single fix here reaches both
 * transports identically (rule 19).
 *
 * Rule 17 (failing-first): reverting `getColumns()` to omit
 * `is_refunded, refunded_at` (the pre-fix column list) makes both
 * "projects is_refunded" assertions below fail with
 * `received: undefined` — confirmed manually before writing this comment,
 * then reverted. See the task report for the exact captured output.
 *
 * Presentation-only guard: also asserts the refund does NOT change any
 * money value on the row (cost/price/profit untouched) — this fix touches
 * only what is SELECTed, never what is written or how much.
 */

import Database from "better-sqlite3";
import { CustomServiceRepository } from "../CustomServiceRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

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

    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE custom_services (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL,
      cost_usd REAL NOT NULL DEFAULT 0,
      cost_lbp REAL NOT NULL DEFAULT 0,
      price_usd REAL NOT NULL DEFAULT 0,
      price_lbp REAL NOT NULL DEFAULT 0,
      profit_usd REAL,
      profit_lbp REAL,
      paid_by TEXT NOT NULL DEFAULT 'CASH',
      status TEXT NOT NULL DEFAULT 'completed',
      client_id INTEGER,
      client_name TEXT,
      phone_number TEXT,
      note TEXT,
      category TEXT,
      created_by INTEGER,
      edited_by TEXT,
      edited_at DATETIME,
      is_refunded INTEGER DEFAULT 0,
      refunded_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      product_id INTEGER
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
      session_id INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER NOT NULL DEFAULT 1,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    INSERT INTO drawer_balances VALUES (1, 'General', 'USD', 500, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General', 'LBP', 20000000, CURRENT_TIMESTAMP);

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
  `);
  return db;
}

describe("CustomServiceRepository — is_refunded/refunded_at projection (LIRA-130)", () => {
  let db: Database.Database;
  let repo: CustomServiceRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetTransactionRepository();
    repo = new CustomServiceRepository();
  });

  afterEach(() => {
    resetTenantContext();
    resetTransactionRepository();
    db.close();
  });

  it("getAll()/getById() report is_refunded=0 and refunded_at=null on a live (never-refunded) service", () => {
    const res = repo.createService(
      {
        description: "SIM activation",
        cost_usd: 3,
        cost_lbp: 0,
        price_usd: 5,
        price_lbp: 0,
        paid_by: "CASH",
        status: "completed",
      },
      1,
    );
    expect(res.success).toBe(true);

    const fromGetAll = repo.getAll().find((r) => r.id === res.id);
    expect(fromGetAll?.is_refunded).toBe(0);
    expect(fromGetAll?.refunded_at).toBeNull();

    const fromGetById = repo.getById(res.id!);
    expect(fromGetById?.is_refunded).toBe(0);
    expect(fromGetById?.refunded_at).toBeNull();
  });

  it("getAll()/getById() surface is_refunded=1 + a refunded_at timestamp after the GENERIC refund path runs — and no money value on the row changes (presentation-only)", () => {
    // Reproduces the owner's exact report: a for-partner-style service with
    // cost $100 / price $110 (kept plain CASH here — partner mode is
    // orthogonal to the read-path bug being proven).
    const res = repo.createService(
      {
        description: "7welet syria 100$",
        cost_usd: 100,
        cost_lbp: 0,
        price_usd: 110,
        price_lbp: 0,
        paid_by: "CASH",
        status: "completed",
      },
      1,
    );
    expect(res.success).toBe(true);

    const before = repo.getById(res.id!);
    expect(before?.is_refunded).toBe(0);

    const txn = db
      .prepare(
        `SELECT id FROM transactions WHERE source_table = 'custom_services' AND source_id = ?`,
      )
      .get(res.id) as { id: number };

    // The Transactions page's void/refund action calls this directly — it
    // never goes through CustomServiceRepository.deleteService.
    getTransactionRepository().refundTransaction(txn.id, 1);

    const afterAll = repo.getAll().find((r) => r.id === res.id);
    expect(afterAll?.is_refunded).toBe(1);
    expect(afterAll?.refunded_at).not.toBeNull();
    expect(typeof afterAll?.refunded_at).toBe("string");

    const afterById = repo.getById(res.id!);
    expect(afterById?.is_refunded).toBe(1);
    expect(afterById?.refunded_at).not.toBeNull();

    // Presentation-only: the refund must not touch the row's money fields.
    // profit_usd/profit_lbp are the GENERATED (price - cost) column — this
    // is the second symptom the ticket names ("still shows profit $10"),
    // proven here to be a display-layer decision, not a data bug: the raw
    // stored value legitimately never changes.
    expect(afterById?.cost_usd).toBe(before?.cost_usd);
    expect(afterById?.price_usd).toBe(before?.price_usd);
    expect(afterById?.profit_usd).toBe(before?.profit_usd);
  });
});
