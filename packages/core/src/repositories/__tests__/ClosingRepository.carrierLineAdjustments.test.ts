/**
 * LIRA-252 wave 2 — `ClosingRepository.getCarrierLineAdjustments`: the read
 * side for `CarrierLineRepository.postCarrierDrawerAdjustment`'s new
 * `CARRIER_LINE_ADJUSTMENT` transactions. Core-only; this feeds a LATER
 * Checkpoint-Timeline UI wave, not wired to any transport here.
 *
 * Proven failing-first (rule 17): run against the pre-wave-2 repository,
 * every test below failed at compile time — `getCarrierLineAdjustments` did
 * not exist on `ClosingRepository` at all (`repo.getCarrierLineAdjustments
 * is not a function` / a TS error against the pre-fix API), which is the
 * accepted failing-first shape per this ticket's own instructions. The
 * method below is the fix.
 */

import Database from "better-sqlite3";
import {
  ClosingRepository,
  resetClosingRepository,
} from "../ClosingRepository.js";
import { resetTransactionRepository } from "../TransactionRepository.js";
import { runWithTenant } from "../../db/tenantContext.js";
import { TRANSACTION_TYPES } from "../../constants/transactionTypes.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      username  TEXT
    );

    CREATE TABLE transactions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id     INTEGER DEFAULT 1,
      type          TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table  TEXT NOT NULL,
      source_id     INTEGER NOT NULL,
      user_id       INTEGER NOT NULL,
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
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.prepare(
    `INSERT INTO users (id, tenant_id, username) VALUES (1, 1, 'cashier1'), (2, 1, 'cashier2')`,
  ).run();
  return db;
}

function seedAdjustment(
  db: Database.Database,
  opts: {
    userId: number;
    amountUsd: number;
    drawerName: "MTC" | "Alfa";
    reason: string;
    createdAt: string;
  },
): void {
  db.prepare(
    `INSERT INTO transactions
       (tenant_id, type, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, summary, metadata_json, created_at)
     VALUES (1, ?, 'carrier_lines', 1, ?, ?, 0, 0, 0, ?, ?, ?)`,
  ).run(
    TRANSACTION_TYPES.CARRIER_LINE_ADJUSTMENT,
    opts.userId,
    opts.amountUsd,
    `Line adjustment — ${opts.drawerName}`,
    JSON.stringify({
      carrier: opts.drawerName === "MTC" ? "mtc" : "alfa",
      phone_number: "03111111",
      drawer_name: opts.drawerName,
      reason: opts.reason,
      is_auto: false,
    }),
    opts.createdAt,
  );
}

describe("ClosingRepository.getCarrierLineAdjustments (LIRA-252 wave 2)", () => {
  let db: Database.Database;
  let repo: ClosingRepository;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ =
      db;
    resetClosingRepository();
    resetTransactionRepository();
    repo = new ClosingRepository();
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>)
      .__LIRATEK_TEST_DB__;
    db.close();
    resetClosingRepository();
    resetTransactionRepository();
  });

  it("returns adjustments within the date range, newest first, with the user joined", () => {
    seedAdjustment(db, {
      userId: 1,
      amountUsd: 500,
      drawerName: "MTC",
      reason: "created",
      createdAt: "2026-10-02 09:00:00",
    });
    seedAdjustment(db, {
      userId: 2,
      amountUsd: -50,
      drawerName: "MTC",
      reason: "quick-update",
      createdAt: "2026-10-02 11:00:00",
    });

    const rows = runWithTenant(1, () =>
      repo.getCarrierLineAdjustments({
        date_from: "2026-10-02",
        date_to: "2026-10-02",
      }),
    );

    expect(rows).toHaveLength(2);
    // Newest first.
    expect(rows[0].amount_usd).toBe(-50);
    expect(rows[0].user_name).toBe("cashier2");
    expect(rows[1].amount_usd).toBe(500);
    expect(rows[1].user_name).toBe("cashier1");
  });

  it("excludes adjustments outside the date range", () => {
    seedAdjustment(db, {
      userId: 1,
      amountUsd: 500,
      drawerName: "MTC",
      reason: "created",
      createdAt: "2026-09-20 09:00:00",
    });

    const rows = runWithTenant(1, () =>
      repo.getCarrierLineAdjustments({
        date_from: "2026-10-01",
        date_to: "2026-10-02",
      }),
    );

    expect(rows).toHaveLength(0);
  });

  it("filters by drawer_name via the metadata_json link", () => {
    seedAdjustment(db, {
      userId: 1,
      amountUsd: 500,
      drawerName: "MTC",
      reason: "created",
      createdAt: "2026-10-02 09:00:00",
    });
    seedAdjustment(db, {
      userId: 1,
      amountUsd: 200,
      drawerName: "Alfa",
      reason: "created",
      createdAt: "2026-10-02 09:30:00",
    });

    const mtcOnly = runWithTenant(1, () =>
      repo.getCarrierLineAdjustments({
        date_from: "2026-10-02",
        date_to: "2026-10-02",
        drawer_name: "MTC",
      }),
    );

    expect(mtcOnly).toHaveLength(1);
    expect(mtcOnly[0].amount_usd).toBe(500);
  });

  it("excludes transactions of any OTHER type, even on the same date", () => {
    db.prepare(
      `INSERT INTO transactions
         (tenant_id, type, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, created_at)
       VALUES (1, 'CHECKPOINT', 'daily_closings', 1, 1, 0, 0, 0, 0, '2026-10-02 09:00:00')`,
    ).run();

    const rows = runWithTenant(1, () =>
      repo.getCarrierLineAdjustments({
        date_from: "2026-10-02",
        date_to: "2026-10-02",
      }),
    );

    expect(rows).toHaveLength(0);
  });

  it("defaults date_from/date_to to today (clientDay()) when omitted", () => {
    // No explicit dates passed — relies on clientDay() resolving to the
    // real server-local today, so seed at "now" via the SQLite default.
    db.prepare(
      `INSERT INTO transactions
         (tenant_id, type, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, created_at)
       VALUES (1, ?, 'carrier_lines', 1, 1, 10, 0, 0, 0, CURRENT_TIMESTAMP)`,
    ).run(TRANSACTION_TYPES.CARRIER_LINE_ADJUSTMENT);

    const rows = runWithTenant(1, () => repo.getCarrierLineAdjustments());

    expect(rows).toHaveLength(1);
  });
});
