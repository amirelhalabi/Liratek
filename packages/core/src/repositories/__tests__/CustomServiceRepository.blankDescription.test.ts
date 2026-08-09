/**
 * CustomServiceRepository — blank description summary/notes (owner-reported,
 * dangling colon)
 *
 * `createService` builds `summary: \`Custom Service: ${data.description}\`}`
 * and reuses the same template for `noteText`, stamped onto every
 * payment/drawer note. Since description became optional (owner's own
 * change to `packages/core/src/validators/customService.ts`), a blank
 * description produced the literal `"Custom Service: "` — a dangling colon
 * that isn't caught by `TransactionRepository.createTransaction`'s
 * empty-summary guard because `"Custom Service: ".trim()` is
 * `"Custom Service:"`, non-empty. The same template doubles up as the
 * payment/drawer note, producing a doubled space
 * (`"Custom Service:  (price inflow)"`).
 *
 * Fix: the label degrades to the bare `"Custom Service"` (no colon, no
 * trailing space) whenever the (trimmed) description is empty, and a
 * non-empty description still produces the byte-identical
 * `"Custom Service: <description>"` as before.
 *
 * NOTE (FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §2, 2026-08-09): this test
 * used to read the "(cost outflow)" payment note as its proof point. §2
 * FINAL SPEC removed that leg entirely (cost never moves cash) — the same
 * `noteText` template is still exercised via the "(price inflow)" leg that
 * the CASH/drawer-affecting branch posts for the price, so the helper below
 * now reads that note instead. The underlying bug/fix (dangling colon,
 * doubled space) is about `noteText` itself, not about which leg carries it.
 */

import Database from "better-sqlite3";
import { CustomServiceRepository } from "../CustomServiceRepository";
import { resetTransactionRepository } from "../TransactionRepository";

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
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      description TEXT NOT NULL,
      cost_usd REAL DEFAULT 0,
      cost_lbp REAL DEFAULT 0,
      price_usd REAL DEFAULT 0,
      price_lbp REAL DEFAULT 0,
      paid_by TEXT DEFAULT 'CASH',
      status TEXT DEFAULT 'completed',
      client_id INTEGER,
      client_name TEXT,
      phone_number TEXT,
      note TEXT,
      category TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
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

    -- tenant_id joins the PRIMARY KEY (multi-tenant retrofit v123 — matches
    -- production's per-tenant drawer_balances rebuild).
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
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      transaction_id INTEGER,
      note TEXT,
      due_date TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

function summaryOf(db: Database.Database): string | null {
  return (
    db
      .prepare(
        `SELECT summary FROM transactions WHERE source_table = 'custom_services' ORDER BY id DESC LIMIT 1`,
      )
      .get() as { summary: string | null }
  ).summary;
}

function priceInflowNote(db: Database.Database): string {
  return (
    db
      .prepare(
        `SELECT note FROM payments WHERE note LIKE '%(price inflow)%' ORDER BY id DESC LIMIT 1`,
      )
      .get() as { note: string }
  ).note;
}

describe("CustomServiceRepository — blank description summary/notes", () => {
  let db: Database.Database;
  let repo: CustomServiceRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    resetTransactionRepository();
    repo = new CustomServiceRepository();
  });

  afterEach(() => {
    db.close();
    resetTransactionRepository();
  });

  it("blank description -> summary is exactly 'Custom Service' (no colon, no trailing space)", () => {
    const res = repo.createService(
      {
        description: "",
        cost_usd: 1,
        cost_lbp: 0,
        price_usd: 5,
        price_lbp: 0,
        paid_by: "CASH",
        status: "completed",
      },
      1,
    );
    expect(res.success).toBe(true);

    expect(summaryOf(db)).toBe("Custom Service");

    // Derived payment/drawer note (price inflow) must not double the space
    // that the dangling colon used to leave behind.
    const note = priceInflowNote(db);
    expect(note).toBe("Custom Service (price inflow)");
    expect(note).not.toContain("  ");
    expect(note).not.toContain(":");
  });

  it("whitespace-only description behaves the same as blank", () => {
    const res = repo.createService(
      {
        description: "   ",
        cost_usd: 1,
        cost_lbp: 0,
        price_usd: 5,
        price_lbp: 0,
        paid_by: "CASH",
        status: "completed",
      },
      1,
    );
    expect(res.success).toBe(true);

    expect(summaryOf(db)).toBe("Custom Service");

    const note = priceInflowNote(db);
    expect(note).toBe("Custom Service (price inflow)");
    expect(note).not.toContain("  ");
    expect(note).not.toContain(":");
  });

  it("non-empty description -> summary unchanged, byte-identical to today", () => {
    const res = repo.createService(
      {
        description: "Phone repair",
        cost_usd: 1,
        cost_lbp: 0,
        price_usd: 5,
        price_lbp: 0,
        paid_by: "CASH",
        status: "completed",
      },
      1,
    );
    expect(res.success).toBe(true);

    expect(summaryOf(db)).toBe("Custom Service: Phone repair");

    const note = priceInflowNote(db);
    expect(note).toBe("Custom Service: Phone repair (price inflow)");
  });
});
