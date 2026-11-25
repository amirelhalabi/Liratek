/**
 * LIRA-404 — the euro takes its rate from the online feed, not Settings.
 *
 *  1. Migration v235 removes every EUR `exchange_rates` row; down restores
 *     the old default for tenants that have EUR as a currency.
 *  2. A fresh database (create_db.sql + migrations) and a new web shop
 *     (`TenantRepository.seedConfig`) carry no EUR rate row, but EUR is
 *     still a currency.
 *  3. Euros already held keep their cost: lots opened while the row existed
 *     are consumed FIFO after it is gone, with the right realized profit, in
 *     both selling directions (USD → EUR direct, LBP → EUR via USD); buying
 *     more (EUR → USD, EUR → LBP) still opens lots at the trade's own value.
 *     The oversell slice now books $0 (no market rate on the server — same
 *     as GBP; spec open question 2).
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS, runMigrations } from "../db/migrations/index";
import { TenantRepository } from "../repositories/TenantRepository";
import {
  ExchangeRepository,
  type CreateExchangeData,
} from "../repositories/ExchangeRepository";
import { getExchangeLotRepository } from "../repositories/ExchangeLotRepository";
import { ExchangeLotService } from "../services/ExchangeLotService";
import {
  setupExchangeDb,
  teardownExchangeDb,
} from "../repositories/testHelpers/exchangeCustomerPaysDb";

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../electron-app/create_db.sql"),
  "utf-8",
);

function eurRateRows(db: Database.Database, tenantId?: number): number {
  const sql =
    tenantId === undefined
      ? `SELECT COUNT(*) AS c FROM exchange_rates WHERE to_code = 'EUR'`
      : `SELECT COUNT(*) AS c FROM exchange_rates WHERE to_code = 'EUR' AND tenant_id = ?`;
  const stmt = db.prepare(sql);
  const row = (tenantId === undefined ? stmt.get() : stmt.get(tenantId)) as {
    c: number;
  };
  return row.c;
}

describe("LIRA-404 migration v235 — EUR leaves Settings rates", () => {
  const v235 = () => MIGRATIONS.find((m) => m.version === 235);

  it("exists", () => {
    expect(v235()?.name).toBe("eur_rate_from_feed");
  });

  it("a fresh database (create_db.sql + migrations) has no EUR rate row but keeps EUR as a currency and LBP's rate", () => {
    const db = new Database(":memory:");
    db.exec(CREATE_DB_SQL);
    runMigrations(db);
    expect(eurRateRows(db)).toBe(0);
    expect(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM exchange_rates WHERE to_code = 'LBP'`,
          )
          .get() as { c: number }
      ).c,
    ).toBe(1);
    expect(
      (
        db
          .prepare(`SELECT COUNT(*) AS c FROM currencies WHERE code = 'EUR'`)
          .get() as { c: number }
      ).c,
    ).toBe(1);
    db.close();
  });

  it("up deletes every tenant's EUR row (custom values included) and leaves LBP; down restores the default", () => {
    const db = new Database(":memory:");
    db.exec(CREATE_DB_SQL);
    db.pragma("foreign_keys = OFF");
    runMigrations(db);
    db.prepare(
      `INSERT INTO tenants (id, name, slug, status) VALUES (7, 'Other', 'other', 'active')`,
    ).run();
    db.prepare(
      `INSERT OR IGNORE INTO currencies (tenant_id, code, name, symbol, decimal_places, is_active) VALUES (7, 'EUR', 'Euro', '€', 2, 1)`,
    ).run();
    const ins = db.prepare(
      `INSERT OR REPLACE INTO exchange_rates (tenant_id, to_code, market_rate, buy_rate, sell_rate, is_stronger) VALUES (?, 'EUR', ?, ?, ?, -1)`,
    );
    ins.run(1, 1.17, 1.15, 1.19);
    ins.run(7, 1.21, 1.2, 1.22);

    const m = v235();
    expect(m).toBeDefined();
    m!.up(db);
    expect(eurRateRows(db)).toBe(0);
    expect(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM exchange_rates WHERE to_code = 'LBP'`,
          )
          .get() as { c: number }
      ).c,
    ).toBeGreaterThan(0);

    m!.down!(db);
    const restored = db
      .prepare(
        `SELECT tenant_id, market_rate, buy_rate, sell_rate, is_stronger FROM exchange_rates WHERE to_code = 'EUR' ORDER BY tenant_id`,
      )
      .all();
    expect(restored).toEqual([
      {
        tenant_id: 1,
        market_rate: 1.18,
        buy_rate: 1.16,
        sell_rate: 1.2,
        is_stronger: -1,
      },
      {
        tenant_id: 7,
        market_rate: 1.18,
        buy_rate: 1.16,
        sell_rate: 1.2,
        is_stronger: -1,
      },
    ]);
    db.close();
  });
});

describe("LIRA-404 new shop seed", () => {
  it("seedConfig gives a new shop LBP's rate only, while EUR stays a currency with its modules", () => {
    const db = new Database(":memory:");
    db.exec(CREATE_DB_SQL);
    db.pragma("foreign_keys = OFF");
    db.prepare(
      `INSERT INTO tenants (id, name, slug, status) VALUES (5, 'Test', 'test', 'active')`,
    ).run();
    new TenantRepository(db).seedConfig(5, "Test");

    expect(eurRateRows(db, 5)).toBe(0);
    expect(
      db
        .prepare(
          `SELECT to_code FROM exchange_rates WHERE tenant_id = 5 ORDER BY to_code`,
        )
        .all(),
    ).toEqual([{ to_code: "LBP" }]);
    expect(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM currencies WHERE tenant_id = 5 AND code = 'EUR'`,
          )
          .get() as { c: number }
      ).c,
    ).toBe(1);
    expect(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM currency_modules WHERE tenant_id = 5 AND currency_code = 'EUR'`,
          )
          .get() as { c: number }
      ).c,
    ).toBeGreaterThan(0);
    db.close();
  });
});

describe("LIRA-404 — euros already held keep their cost after the EUR row is removed", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = setupExchangeDb(); // seeds the EUR row (1.18 / 1.16 / 1.20) like a shop before v235
  });
  afterEach(() => teardownExchangeDb(db));

  const create = (data: CreateExchangeData) =>
    new ExchangeRepository().createTransaction(data);

  const openLots = () =>
    db
      .prepare(
        `SELECT remaining_qty AS qty, unit_cost_usd AS cost FROM exchange_lots WHERE currency_code = 'EUR' AND remaining_qty > 1e-9 AND is_voided = 0 ORDER BY id`,
      )
      .all() as Array<{ qty: number; cost: number }>;

  const removeEurRow = () =>
    db.prepare(`DELETE FROM exchange_rates WHERE to_code = 'EUR'`).run();

  it("buys before removal open lots at cost; sells after removal consume them FIFO with the right realized profit; oversell books $0 on the uncovered part", () => {
    // ── While the Settings row exists: the shop buys euros (opens lots) ──
    create({
      fromCurrency: "EUR",
      toCurrency: "USD",
      amountIn: 100,
      amountOut: 116,
      leg1Rate: 1.16,
      leg1MarketRate: 1.18,
      leg1ProfitUsd: 2,
      totalProfitUsd: 2,
    });
    create({
      fromCurrency: "EUR",
      toCurrency: "LBP",
      amountIn: 100,
      amountOut: 10_324_000, // 100 × 1.16 × 89,000
      leg1Rate: 1.16,
      leg1MarketRate: 1.18,
      leg1ProfitUsd: 0,
      leg2Rate: 89_000,
      leg2MarketRate: 89_500,
      leg2ProfitUsd: 0,
      viaCurrency: "USD",
      totalProfitUsd: 0,
    });
    const before = openLots();
    expect(before).toHaveLength(2);
    for (const lot of before) {
      expect(lot.qty).toBeCloseTo(100, 6);
      expect(lot.cost).toBeCloseTo(1.16, 6);
    }

    // ── v235 removes the row ──
    removeEurRow();
    expect(eurRateRows(db)).toBe(0);
    // cost untouched by the removal
    expect(openLots()).toEqual(before);

    // ── Sell 50 € for $61 (USD → EUR direct): 50 × (1.22 − 1.16) = 3.00 ──
    const sell1 = create({
      fromCurrency: "USD",
      toCurrency: "EUR",
      amountIn: 61,
      amountOut: 50,
      leg1Rate: 1.22,
      leg1MarketRate: 1.22,
      leg1ProfitUsd: 0,
      totalProfitUsd: 0,
    });
    expect(sell1.realizedProfitUsd).toBeCloseTo(3, 6);
    expect(sell1.lotCoveredQty).toBeCloseTo(50, 6);
    expect(sell1.lotMarketQty ?? 0).toBeCloseTo(0, 6);

    // ── Sell 100 € for LBP (LBP → EUR via USD, anchored on LBP's row):
    //    USD notional = 10,740,000 / 89,500 = 120 → 1.20/€;
    //    100 × (1.20 − 1.16) = 4.00, spanning both lots FIFO ──
    const sell2 = create({
      fromCurrency: "LBP",
      toCurrency: "EUR",
      amountIn: 10_740_000,
      amountOut: 100,
      leg1Rate: 89_500,
      leg1MarketRate: 89_500,
      leg1ProfitUsd: 0,
      leg2Rate: 1.2,
      leg2MarketRate: 1.2,
      leg2ProfitUsd: 0,
      viaCurrency: "USD",
      totalProfitUsd: 0,
    });
    expect(sell2.realizedProfitUsd).toBeCloseTo(4, 6);
    expect(sell2.lotCoveredQty).toBeCloseTo(100, 6);
    const left = openLots();
    expect(left).toHaveLength(1);
    expect(left[0].qty).toBeCloseTo(50, 6);
    expect(left[0].cost).toBeCloseTo(1.16, 6);

    // ── Oversell 60 € for $75 (1.25/€): 50 covered → 50 × 0.09 = 4.50;
    //    10 uncovered at the proceeds basis (no market row) → $0 ──
    const sell3 = create({
      fromCurrency: "USD",
      toCurrency: "EUR",
      amountIn: 75,
      amountOut: 60,
      leg1Rate: 1.25,
      leg1MarketRate: 1.25,
      leg1ProfitUsd: 0,
      totalProfitUsd: 0,
    });
    expect(sell3.lotCoveredQty).toBeCloseTo(50, 6);
    expect(sell3.lotMarketQty).toBeCloseTo(10, 6);
    expect(sell3.realizedProfitUsd).toBeCloseTo(4.5, 6);
    expect(openLots()).toHaveLength(0);
  });

  it("buying euros after removal still opens lots at the trade's own value (EUR → USD and EUR → LBP)", () => {
    removeEurRow();
    create({
      fromCurrency: "EUR",
      toCurrency: "USD",
      amountIn: 40,
      amountOut: 46,
      leg1Rate: 1.15,
      leg1MarketRate: 1.15,
      leg1ProfitUsd: 0,
      totalProfitUsd: 0,
    });
    create({
      fromCurrency: "EUR",
      toCurrency: "LBP",
      amountIn: 10,
      amountOut: 1_026_000, // 10 × 1.14 × 90,000
      leg1Rate: 1.14,
      leg1MarketRate: 1.14,
      leg1ProfitUsd: 0,
      leg2Rate: 90_000,
      leg2MarketRate: 89_500,
      leg2ProfitUsd: 0,
      viaCurrency: "USD",
      totalProfitUsd: 0,
    });
    const lots = openLots();
    expect(lots).toHaveLength(2);
    expect(lots[0].cost).toBeCloseTo(1.15, 6);
    expect(lots[1].cost).toBeCloseTo(1.14, 6);
  });

  it("Open Positions: with no EUR row the server leaves Market and Unrealized blank (the screen fills them from the feed)", () => {
    create({
      fromCurrency: "EUR",
      toCurrency: "USD",
      amountIn: 100,
      amountOut: 116,
      leg1Rate: 1.16,
      leg1MarketRate: 1.18,
      leg1ProfitUsd: 0,
      totalProfitUsd: 0,
    });
    const service = new ExchangeLotService(getExchangeLotRepository());
    const withRow = service
      .getPositions()
      .find((p) => p.currency_code === "EUR");
    expect(withRow?.current_market_unit_usd).toBeCloseTo(1.18, 6);
    expect(withRow?.unrealized_profit_usd).toBeCloseTo(2, 6);

    removeEurRow();
    const noRow = service.getPositions().find((p) => p.currency_code === "EUR");
    expect(noRow?.open_qty).toBeCloseTo(100, 6);
    expect(noRow?.avg_unit_cost_usd).toBeCloseTo(1.16, 6);
    expect(noRow?.current_market_unit_usd).toBeNull();
    expect(noRow?.unrealized_profit_usd).toBeNull();
  });
});
