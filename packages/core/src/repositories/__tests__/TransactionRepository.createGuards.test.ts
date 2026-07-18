/**
 * TransactionRepository.createTransaction — record-completeness guards
 *
 * Every unified-transaction row must be self-describing: the exchange rate is
 * stamped centrally (snapshot of the LBP market rate) when the caller doesn't
 * provide one, a blank summary is rejected, and a client_phone without a
 * client_name is rejected (a bare phone number is never a valid customer
 * identity — the CUSTOMER_ACCOUNT model keys on name+phone).
 *
 * Pre-fix, the snapshot lived only in TransactionService.createTransaction,
 * which no production flow calls — every repository hits the repo method
 * directly, so 23 of 35 call sites stamped NULL exchange_rate.
 */

import Database from "better-sqlite3";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository.js";
import { resetRateRepository } from "../RateRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

function createTestDb(withRatesTable = true): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
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
  `);
  if (withRatesTable) {
    db.exec(`
      CREATE TABLE exchange_rates (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        to_code     TEXT NOT NULL,
        market_rate REAL NOT NULL,
        buy_rate    REAL NOT NULL DEFAULT 0,
        sell_rate   REAL NOT NULL DEFAULT 0,
        is_stronger INTEGER NOT NULL DEFAULT 1,
        tenant_id   INTEGER NOT NULL DEFAULT 1,
        updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }
  return db;
}

function seedLbpRate(db: Database.Database, marketRate: number): void {
  db.prepare(
    `INSERT INTO exchange_rates (to_code, market_rate, buy_rate, sell_rate, is_stronger, tenant_id)
     VALUES ('LBP', ?, ?, ?, 1, 1)`,
  ).run(marketRate, marketRate, marketRate);
}

const BASE_INPUT = {
  type: "RECHARGE" as const,
  source_table: "recharges",
  source_id: 1,
  user_id: 1,
  amount_usd: 10,
  amount_lbp: 0,
  summary: "Recharge: MTC",
  metadata_json: { provider: "MTC" },
};

function rateOf(db: Database.Database, id: number): number | null {
  const row = db
    .prepare(`SELECT exchange_rate FROM transactions WHERE id = ?`)
    .get(id) as { exchange_rate: number | null };
  return row.exchange_rate;
}

describe("TransactionRepository.createTransaction — completeness guards", () => {
  let db: Database.Database;
  let repo: TransactionRepository;

  function useDb(database: Database.Database): void {
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = database;
  }

  beforeEach(() => {
    db = createTestDb();
    useDb(db);
    initFixedTenantContext(1);
    resetTransactionRepository();
    resetRateRepository();
    repo = new TransactionRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
    resetRateRepository();
    resetTenantContext();
  });

  describe("exchange_rate central snapshot", () => {
    it("stamps the current LBP market rate when the caller omits exchange_rate", () => {
      seedLbpRate(db, 89_500);
      const id = repo.createTransaction({ ...BASE_INPUT });
      expect(rateOf(db, id)).toBe(89_500);
    });

    it("keeps an explicitly passed exchange_rate untouched", () => {
      seedLbpRate(db, 89_500);
      const id = repo.createTransaction({
        ...BASE_INPUT,
        exchange_rate: 90_000,
      });
      expect(rateOf(db, id)).toBe(90_000);
    });

    it("preserves an explicit null (caller opted out of a rate stamp)", () => {
      seedLbpRate(db, 89_500);
      const id = repo.createTransaction({
        ...BASE_INPUT,
        exchange_rate: null,
      });
      expect(rateOf(db, id)).toBeNull();
    });

    it("falls back to null when no LBP rate is configured", () => {
      const id = repo.createTransaction({ ...BASE_INPUT });
      expect(rateOf(db, id)).toBeNull();
    });

    it("fails soft (null) when the exchange_rates table is missing entirely", () => {
      // Older fixtures / partial schemas must never make writes throw.
      db.close();
      db = createTestDb(false);
      useDb(db);
      resetTransactionRepository();
      resetRateRepository();
      repo = new TransactionRepository();
      const id = repo.createTransaction({ ...BASE_INPUT });
      expect(rateOf(db, id)).toBeNull();
    });
  });

  describe("summary guard", () => {
    it("rejects a blank summary", () => {
      expect(() =>
        repo.createTransaction({ ...BASE_INPUT, summary: "   " }),
      ).toThrow(/summary/i);
    });
  });

  describe("client identity guard", () => {
    it("rejects client_phone without client_name", () => {
      expect(() =>
        repo.createTransaction({
          ...BASE_INPUT,
          client_phone: "70123456",
        }),
      ).toThrow(/client_name/i);
    });

    it("allows client_name alone (walk-in label, e.g. exchange)", () => {
      const id = repo.createTransaction({
        ...BASE_INPUT,
        client_name: "Walk-in Ali",
      });
      expect(id).toBeGreaterThan(0);
    });

    it("allows the full name+phone pair", () => {
      const id = repo.createTransaction({
        ...BASE_INPUT,
        client_name: "Ali",
        client_phone: "70123456",
      });
      expect(id).toBeGreaterThan(0);
    });
  });
});
