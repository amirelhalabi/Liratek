/**
 * `crossPairHasUsdAnchor` <-> `ExchangeRepository._crossUsdNotional` parity
 * (adversarial review of the Exchange Lot Settlement feature, rule 14).
 *
 * `crossPairHasUsdAnchor` (utils/lotMarketRate.ts) is a pure, DB-free
 * predicate that `ExchangeLotService.previewSettlement` calls (it has no
 * exchange row to run `_crossUsdNotional` against) to decide, BEFORE submit,
 * whether a cross pair has a USD anchor to route through. It exists only
 * because it must agree with `_crossUsdNotional`'s actual null-vs-non-null
 * answer — a preview that disagrees with submit would show a realized-profit
 * figure the server then silently discards (or vice versa, hide one that
 * submit would have computed).
 *
 * This test proves that agreement across all 4 presence combinations of
 * "does fromCurrency have a configured exchange_rates row" x "does
 * toCurrency have one" for a cross pair where NEITHER side is LBP (the LBP
 * anchor branch is trivial — both functions return true/non-null
 * unconditionally in that case, with no row-presence combinations to vary).
 */

import Database from "better-sqlite3";
import {
  ExchangeRepository,
  type CreateExchangeData,
} from "../../repositories/ExchangeRepository";
import { crossPairHasUsdAnchor } from "../lotMarketRate";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

type PrivateCrossUsdNotional = {
  _crossUsdNotional(data: CreateExchangeData): number | null;
};

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE exchange_rates (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id   INTEGER DEFAULT 1,
      to_code     TEXT    NOT NULL,
      market_rate REAL    NOT NULL,
      buy_rate    REAL    NOT NULL,
      sell_rate   REAL    NOT NULL,
      is_stronger INTEGER NOT NULL DEFAULT 1 CHECK(is_stronger IN (1, -1)),
      updated_at  TEXT    DEFAULT (datetime('now')),
      UNIQUE (tenant_id, to_code)
    );
  `);
  return db;
}

jest.mock("../../db/connection", () => {
  let _db: Database.Database | null = null;
  return {
    getDatabase: () => {
      if (!_db) throw new Error("DB not initialized");
      return _db;
    },
    setDb: (db: Database.Database) => {
      _db = db;
    },
  };
});

function seedRate(
  db: Database.Database,
  toCode: string,
  isStronger: 1 | -1,
): void {
  db.prepare(
    `INSERT INTO exchange_rates (tenant_id, to_code, market_rate, buy_rate, sell_rate, is_stronger) VALUES (1, ?, 1.2, 1.18, 1.22, ?)`,
  ).run(toCode, isStronger);
}

const FROM_CCY = "EUR";
const TO_CCY = "GBP";

function crossData(): CreateExchangeData {
  return {
    fromCurrency: FROM_CCY,
    toCurrency: TO_CCY,
    amountIn: 800,
    amountOut: 500,
    leg1Rate: 1.25,
    leg1MarketRate: 1.18,
    leg1ProfitUsd: 0,
    leg2Rate: 2.0,
    leg2MarketRate: 1.28,
    leg2ProfitUsd: 0,
    viaCurrency: "USD",
    totalProfitUsd: 0,
  };
}

describe("crossPairHasUsdAnchor <-> ExchangeRepository._crossUsdNotional parity", () => {
  let db: Database.Database;
  let repo: ExchangeRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    repo = new ExchangeRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  function callCrossUsdNotional(): number | null {
    return (repo as unknown as PrivateCrossUsdNotional)._crossUsdNotional(
      crossData(),
    );
  }

  /** Same existence check RateRepository.findByCode's query answers — the
   *  predicate takes this as an injected function rather than reading the
   *  DB itself (see lotMarketRate.ts's doc on why). */
  function rateRowExists(code: string): boolean {
    return (
      db
        .prepare(
          `SELECT 1 FROM exchange_rates WHERE to_code = ? AND tenant_id = 1`,
        )
        .get(code) !== undefined
    );
  }

  function callPredicate(): boolean {
    return crossPairHasUsdAnchor(FROM_CCY, TO_CCY, rateRowExists);
  }

  it("both sides have a rate row: both anchor", () => {
    seedRate(db, FROM_CCY, -1);
    seedRate(db, TO_CCY, -1);
    expect(callCrossUsdNotional()).not.toBeNull();
    expect(callPredicate()).toBe(true);
  });

  it("only fromCurrency has a rate row: both anchor (via the FROM side)", () => {
    seedRate(db, FROM_CCY, -1);
    expect(callCrossUsdNotional()).not.toBeNull();
    expect(callPredicate()).toBe(true);
  });

  it("only toCurrency has a rate row: both anchor (via the TO side)", () => {
    seedRate(db, TO_CCY, -1);
    expect(callCrossUsdNotional()).not.toBeNull();
    expect(callPredicate()).toBe(true);
  });

  it("neither side has a rate row: both report NO anchor", () => {
    expect(callCrossUsdNotional()).toBeNull();
    expect(callPredicate()).toBe(false);
  });
});
