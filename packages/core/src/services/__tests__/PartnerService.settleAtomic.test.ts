/**
 * LIRA-258 / POSTING_INTEGRITY_PLAN batch 2, gap G11 (partner half,
 * docs/POSTING_MAP.md §7): PartnerService.settle() and
 * recordPartnerTransaction() wrote the partner_ledger row (which applies FIFO
 * settlement coverage) and THEN the money movement / audit transaction as
 * separate, independently-committed steps. A failure in the second step left
 * an orphan ledger row with coverage already applied — the partner's balance
 * and deferred profit moved with no drawer movement and no transactions row.
 *
 * Guard: force the second step to throw and assert NOTHING was written — no
 * ledger delta in any ledger, no new partner_ledger / transactions /
 * payments row, and the FOR_POS row's covered_amount unchanged.
 */

import Database from "better-sqlite3";
import { PartnerRepository } from "../../repositories/PartnerRepository";
import { PartnerService } from "../PartnerService";
import { resetTransactionRepository } from "../../repositories/TransactionRepository";
import {
  snapshotLedgers,
  expectPostings,
} from "../../repositories/testHelpers/postingAssert";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL);
    INSERT INTO users (id, username) VALUES (1, 'admin');

    CREATE TABLE partners (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      name               TEXT NOT NULL UNIQUE,
      phone              TEXT,
      notes              TEXT,
      is_active          INTEGER NOT NULL DEFAULT 1,
      system_association TEXT,
      tenant_id          INTEGER DEFAULT 1,
      created_at         TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at         TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO partners (id, name) VALUES (1, 'Atomic Partner');

    CREATE TABLE partner_ledger (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id        INTEGER NOT NULL REFERENCES partners(id),
      transaction_type  TEXT,
      reference_table   TEXT,
      reference_id      INTEGER,
      amount            REAL NOT NULL,
      currency          TEXT NOT NULL DEFAULT 'USD',
      direction         TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      notes             TEXT,
      user_id           INTEGER,
      settlement_method TEXT,
      tenant_id         INTEGER DEFAULT 1,
      created_at        TEXT DEFAULT CURRENT_TIMESTAMP,
      covered_amount    REAL NOT NULL DEFAULT 0
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
      profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      reverses_id INTEGER,
      device_id TEXT,
      summary TEXT,
      metadata_json TEXT,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id     INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
  `);
  return db;
}

function seedForPos(db: Database.Database, partnerId: number, amount: number) {
  db.prepare(
    `INSERT INTO partner_ledger (partner_id, transaction_type, reference_table, reference_id, amount, currency, direction, user_id)
     VALUES (?, 'FOR_POS', 'sales', 1, ?, 'USD', 'DEBIT', 1)`,
  ).run(partnerId, amount);
}

function counts(db: Database.Database) {
  const n = (t: string) =>
    (db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c;
  return {
    partner_ledger: n("partner_ledger"),
    transactions: n("transactions"),
    payments: n("payments"),
    covered: (
      db
        .prepare(
          `SELECT COALESCE(SUM(covered_amount), 0) AS c FROM partner_ledger WHERE transaction_type = 'FOR_POS'`,
        )
        .get() as { c: number }
    ).c,
  };
}

const boom = () => {
  throw new Error("simulated money-movement failure");
};

describe("PartnerService — ledger row + money movement are atomic (G11)", () => {
  let db: Database.Database;
  let repo: PartnerRepository;
  let service: PartnerService;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    resetTransactionRepository();
    repo = new PartnerRepository();
    service = new PartnerService(repo);
    // Partner owes the shop $100 (FOR_POS DEBIT) so a settlement is CREDIT
    // and applies FIFO coverage to this row.
    seedForPos(db, 1, 100);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
  });

  function expectNothingWritten(run: () => unknown) {
    const before = snapshotLedgers(db);
    const beforeCounts = counts(db);
    expect(run).toThrow("simulated money-movement failure");
    expectPostings(before, snapshotLedgers(db), {});
    expect(counts(db)).toEqual(beforeCounts);
  }

  it("settle(): a throwing recordSettlementMoneyMovement leaves no ledger row and no coverage", () => {
    jest.spyOn(repo, "recordSettlementMoneyMovement").mockImplementation(boom);
    expectNothingWritten(() =>
      service.settle({
        partnerId: 1,
        amount: 60,
        currency: "USD",
        settlementMethod: "CASH",
        userId: 1,
      }),
    );
  });

  it("settle(): a throwing bundled-discount step rolls back the settlement too", () => {
    jest.spyOn(repo, "recordDiscount").mockImplementation(boom);
    expectNothingWritten(() =>
      service.settle({
        partnerId: 1,
        amount: 60,
        currency: "USD",
        settlementMethod: "CASH",
        userId: 1,
        discount: { amount_usd: 10, amount_lbp: 0, reason: "goodwill" },
      }),
    );
  });

  it("recordPartnerTransaction(moveCash): a throwing money movement leaves no ledger row and no coverage", () => {
    jest.spyOn(repo, "recordSettlementMoneyMovement").mockImplementation(boom);
    expectNothingWritten(() =>
      service.recordPartnerTransaction({
        partnerId: 1,
        amount: 40,
        currency: "USD",
        direction: "CREDIT",
        userId: 1,
        moveCash: true,
      }),
    );
  });

  it("recordPartnerTransaction(paper): a throwing adjustment transaction leaves no ledger row", () => {
    jest.spyOn(repo, "recordAdjustmentTransaction").mockImplementation(boom);
    expectNothingWritten(() =>
      service.recordPartnerTransaction({
        partnerId: 1,
        amount: 40,
        currency: "USD",
        direction: "CREDIT",
        userId: 1,
      }),
    );
  });

  it("happy path still commits: settle() writes the ledger row, coverage and drawer", () => {
    const before = snapshotLedgers(db);
    service.settle({
      partnerId: 1,
      amount: 60,
      currency: "USD",
      settlementMethod: "CASH",
      userId: 1,
    });
    expectPostings(before, snapshotLedgers(db), {
      partner: { "1|USD": -60 },
      drawers: { "General|USD": 60 },
    });
    expect(counts(db).covered).toBe(60);
  });
});
