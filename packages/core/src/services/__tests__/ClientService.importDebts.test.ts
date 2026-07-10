/**
 * ClientService — Excel debt import (B2: totals inflation)
 *
 * The import had two inflation/corruption vectors:
 *   1. NO dedup — re-importing the same file (a normal flow: users retry after
 *      fixing phones in the cleanup modal) inserted every entry again for
 *      existing clients, multiplying the ledger and the dashboard totals.
 *   2. Imported dates were stored as ISO strings ('...T...Z'), which sort
 *      above every CURRENT_TIMESTAMP row of the same day (A6 ordering bug).
 *
 * After the fix: an entry identical to a pre-existing row (client, type,
 * amounts, note, normalized date) is skipped and counted in duplicatesSkipped;
 * within-file identical rows still import (pre-check runs against rows that
 * existed BEFORE the import); created_at is stored SQLite-format.
 */

import Database from "better-sqlite3";
import { ClientService } from "../ClientService";
import { ClientRepository } from "../../repositories/ClientRepository";
import { resetDebtRepository } from "../../repositories/DebtRepository";
import { resetTransactionRepository } from "../../repositories/TransactionRepository";

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

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL);
    INSERT INTO users (id, username) VALUES (1, 'admin');

    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      notes TEXT,
      is_deleted INTEGER DEFAULT 0,
      whatsapp_opt_in INTEGER DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE exchange_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      to_code TEXT,
      market_rate REAL,
      buy_rate REAL,
      sell_rate REAL,
      is_stronger INTEGER DEFAULT 0
    );
  `);
  return db;
}

const FIXTURE = [
  {
    name: "B2 Fixture Client",
    phone: "70123456",
    entries: [
      {
        date: "2024-01-05T00:00:00.000Z",
        amount_usd: 100,
        amount_lbp: 0,
        description: "phone repair",
        type: "debt" as const,
      },
      {
        date: "2024-02-10T00:00:00.000Z",
        amount_usd: 0,
        amount_lbp: 1_500_000,
        description: "groceries",
        type: "debt" as const,
      },
      {
        date: "2024-03-01T00:00:00.000Z",
        amount_usd: 40,
        amount_lbp: 0,
        description: "cash payment",
        type: "payment" as const,
      },
    ],
  },
];

function ledgerTotals(db: Database.Database) {
  return db
    .prepare(
      `SELECT COUNT(*) as rows, COALESCE(SUM(amount_usd),0) as usd, COALESCE(SUM(amount_lbp),0) as lbp
         FROM debt_ledger`,
    )
    .get() as { rows: number; usd: number; lbp: number };
}

describe("ClientService.importClientsWithDebts — idempotent totals (B2)", () => {
  let db: Database.Database;
  let service: ClientService;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    resetDebtRepository();
    resetTransactionRepository();
    service = new ClientService(new ClientRepository());
  });

  afterEach(() => {
    db.close();
    resetDebtRepository();
    resetTransactionRepository();
  });

  it("first import books exactly the fixture sums", () => {
    const r = service.importClientsWithDebts(FIXTURE, 1);

    expect(r.clientsCreated).toBe(1);
    expect(r.entriesImported).toBe(3);
    expect(r.duplicatesSkipped).toBe(0);

    const t = ledgerTotals(db);
    expect(t.rows).toBe(3);
    expect(t.usd).toBeCloseTo(100 - 40, 2); // debt − payment
    expect(t.lbp).toBeCloseTo(1_500_000, 2);
  });

  it("re-importing the SAME file changes NOTHING — the inflation bug", () => {
    service.importClientsWithDebts(FIXTURE, 1);
    const afterFirst = ledgerTotals(db);

    // Pre-B2 this doubled every entry (and tripled on the third attempt…):
    // dashboard totals inflated with every retry of the import flow.
    const r2 = service.importClientsWithDebts(FIXTURE, 1);

    expect(r2.entriesImported).toBe(0);
    expect(r2.duplicatesSkipped).toBe(3);
    expect(ledgerTotals(db)).toEqual(afterFirst);
  });

  it("a file with two IDENTICAL rows imports both (within-file repeats are real)", () => {
    const twin = {
      date: "2024-05-05T00:00:00.000Z",
      amount_usd: 50,
      amount_lbp: 0,
      description: "card",
      type: "debt" as const,
    };
    const r = service.importClientsWithDebts(
      [{ name: "Twin Rows", phone: "71999999", entries: [twin, { ...twin }] }],
      1,
    );

    expect(r.entriesImported).toBe(2);
    expect(r.duplicatesSkipped).toBe(0);
    expect(ledgerTotals(db).usd).toBeCloseTo(100, 2);
  });

  it("re-importing a file with two IDENTICAL rows skips exactly both (multiset)", () => {
    // Customer took 2 Alfa cards at 600,000 LBP on the same day.
    const alfa = {
      date: "2024-06-01T00:00:00.000Z",
      amount_usd: 0,
      amount_lbp: 600_000,
      description: "alfa card",
      type: "debt" as const,
    };
    const file = [
      { name: "Alfa Twins", phone: "71888888", entries: [alfa, { ...alfa }] },
    ];

    const first = service.importClientsWithDebts(file, 1);
    expect(first.entriesImported).toBe(2);
    expect(ledgerTotals(db).lbp).toBeCloseTo(1_200_000, 2);

    // Full re-import: both copies already exist → both skipped, totals frozen.
    const second = service.importClientsWithDebts(file, 1);
    expect(second.entriesImported).toBe(0);
    expect(second.duplicatesSkipped).toBe(2);
    expect(ledgerTotals(db).lbp).toBeCloseTo(1_200_000, 2);
  });

  it("partial re-import: 1 of 2 identical rows in DB → imports exactly the missing one", () => {
    const alfa = {
      date: "2024-06-01T00:00:00.000Z",
      amount_usd: 0,
      amount_lbp: 600_000,
      description: "alfa card",
      type: "debt" as const,
    };
    // First import got interrupted after ONE of the two identical entries.
    service.importClientsWithDebts(
      [{ name: "Alfa Partial", phone: "71777777", entries: [alfa] }],
      1,
    );
    expect(ledgerTotals(db).lbp).toBeCloseTo(600_000, 2);

    // Retry with the FULL file (2 identical rows): a boolean exists-check
    // would skip both and under-import; the count-based budget imports the
    // missing one and skips the one that already exists.
    const retry = service.importClientsWithDebts(
      [
        {
          name: "Alfa Partial",
          phone: "71777777",
          entries: [alfa, { ...alfa }],
        },
      ],
      1,
    );
    expect(retry.entriesImported).toBe(1);
    expect(retry.duplicatesSkipped).toBe(1);
    expect(ledgerTotals(db).lbp).toBeCloseTo(1_200_000, 2);
  });

  it("stores imported dates in CURRENT_TIMESTAMP format, not ISO (A6)", () => {
    service.importClientsWithDebts(FIXTURE, 1);

    const rows = db
      .prepare(`SELECT created_at FROM debt_ledger`)
      .all() as Array<{ created_at: string }>;
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    }
  });
});
