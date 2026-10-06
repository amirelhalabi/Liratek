/**
 * Exchange payout keep-change on the Profits page (owner decision
 * 2026-10-06, refining G29/D9).
 *
 * When a cashier hands over $101 against $101.12 owed and keeps $0.12, the
 * kept cents are NOT exchange margin. The owner wants them on the Profits
 * page's "Kept change (other)" line — the Overview "Other / Kept Change"
 * card's `summary.kept_change` row, and the additive `kept_change_usd` on the
 * By Module EXCHANGE row (the same convention recharges/financial services
 * use for their kept change) — while the Exchange row shows only the pure
 * exchange margin. The period TOTAL must not move, on any tab.
 *
 * Contract pinned here (real create_db.sql schema, real writer, real
 * ProfitService/ProfitRepository read surfaces):
 *   - Overview: exchange.profit_usd = margin; kept_change.usd includes 0.12;
 *     gross = margin + 0.12;
 *   - By Module: EXCHANGE row profit_usd = margin, kept_change_usd = 0.12;
 *   - By Date and By Cashier totals = margin + 0.12 (unchanged);
 *   - EXCHANGE drill-down rows sum to the margin only;
 *   - a lot-tracked acquire leg (Q8 zeroes leg1) still yields kept 0.12 on
 *     the kept line and $0 on the Exchange row (ordering-safe);
 *   - refund (swap-back) nets the Exchange row, the kept line AND the totals
 *     to 0 (rule 20).
 */
import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext.js";
import {
  ExchangeRepository,
  type CreateExchangeData,
} from "../ExchangeRepository.js";
import { ProfitRepository } from "../ProfitRepository.js";
import { getTransactionRepository } from "../TransactionRepository.js";
import { ProfitService } from "../../services/ProfitService.js";

const SCHEMA = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "..", "..", "electron-app", "create_db.sql"),
  "utf-8",
);

let db: Database.Database;
let TODAY = "";

function fresh(): void {
  db = new Database(":memory:");
  db.exec(SCHEMA);
  db.pragma("foreign_keys = OFF");
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  TODAY = (db.prepare(`SELECT date('now','localtime') AS d`).get() as { d: string }).d;
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db?.close();
});

const t = <T>(fn: () => T): T => runWithTenant(1, fn);
const r2 = (x: number | null | undefined) => Math.round(((x ?? 0) as number) * 100) / 100;

function seedRates(): void {
  db.prepare(
    `INSERT OR REPLACE INTO exchange_rates (tenant_id, to_code, market_rate, buy_rate, sell_rate, is_stronger) VALUES (1, 'LBP', 89500, 89000, 90000, 1)`,
  ).run();
  db.prepare(
    `INSERT OR REPLACE INTO exchange_rates (tenant_id, to_code, market_rate, buy_rate, sell_rate, is_stronger) VALUES (1, 'EUR', 1.18, 1.16, 1.2, -1)`,
  ).run();
}

/** Owner example: 9,000,000 LBP -> USD at 89,000 -> $101.12 owed. */
const MARGIN = 9_000_000 / 89_000 - 9_000_000 / 89_500; // 0.5649...
const OWNER_TX: CreateExchangeData = {
  fromCurrency: "LBP",
  toCurrency: "USD",
  amountIn: 9_000_000,
  amountOut: 101.12,
  leg1Rate: 89_000,
  leg1MarketRate: 89_500,
  leg1ProfitUsd: MARGIN,
  totalProfitUsd: MARGIN,
  tender_exchange_rate: 89_000,
  payments: [{ method: "CASH", currencyCode: "USD", amount: 101 }],
  kept_change_usd: 0.12,
  kept_change_lbp: 0,
};

interface Snapshot {
  exchangeRow: number;
  keptLine: number;
  gross: number;
  byModuleExchangeProfit: number;
  byModuleExchangeKept: number;
  byModuleTotal: number;
  byDateTotal: number;
  byUserTotal: number;
  drillDownTotal: number;
}

function snapshot(): Snapshot {
  const ps = new ProfitService(new ProfitRepository());
  const summary = ps.getSummary(TODAY, TODAY);
  const modules = ps.getByModule(TODAY, TODAY);
  const ex = modules.find((m) => m.module === "EXCHANGE");
  const byModuleTotal = modules.reduce(
    (s, m) => s + m.profit_usd + (m.kept_change_usd ?? 0),
    0,
  );
  const byDateTotal = ps
    .getByDate(TODAY, TODAY)
    .reduce((s, d) => s + d.profit_usd, 0);
  const byUserTotal = ps
    .getByUser(TODAY, TODAY)
    .reduce((s, u) => s + u.profit_usd, 0);
  const detail = new ProfitRepository().getExchangeDetail(
    `${TODAY} 00:00:00`,
    `${TODAY} 23:59:59`,
  );
  return {
    exchangeRow: summary.exchange.profit_usd,
    keptLine: summary.kept_change.usd,
    gross: summary.totals.gross_profit_usd,
    byModuleExchangeProfit: ex?.profit_usd ?? 0,
    byModuleExchangeKept: ex?.kept_change_usd ?? 0,
    byModuleTotal,
    byDateTotal,
    byUserTotal,
    drillDownTotal: detail.reduce((s, d) => s + d.profit_usd, 0),
  };
}

function unifiedId(exchangeId: number): number {
  return (
    db
      .prepare(
        `SELECT id FROM transactions WHERE source_table = 'exchange_transactions' AND source_id = ? AND type = 'EXCHANGE'`,
      )
      .get(exchangeId) as { id: number }
  ).id;
}

describe("Profits page — exchange kept change shows on the Kept change line, not the Exchange row", () => {
  beforeEach(fresh);

  it("owner example: Exchange row = margin only, Kept change (other) = $0.12, total = margin + 0.12 on every tab", () => {
    t(() => {
      seedRates();
      new ExchangeRepository().createTransaction(OWNER_TX);
      const s = snapshot();

      expect(r2(s.exchangeRow)).toBe(r2(MARGIN));
      expect(r2(s.keptLine)).toBe(0.12);
      expect(r2(s.gross)).toBe(r2(MARGIN + 0.12));

      expect(r2(s.byModuleExchangeProfit)).toBe(r2(MARGIN));
      expect(r2(s.byModuleExchangeKept)).toBe(0.12);
      expect(r2(s.byModuleTotal)).toBe(r2(MARGIN + 0.12));

      expect(r2(s.byDateTotal)).toBe(r2(MARGIN + 0.12));
      expect(r2(s.byUserTotal)).toBe(r2(MARGIN + 0.12));
      expect(r2(s.drillDownTotal)).toBe(r2(MARGIN));
    });
  });

  it("exchange paid in full carries no kept change (kept line stays 0)", () => {
    t(() => {
      seedRates();
      new ExchangeRepository().createTransaction({
        ...OWNER_TX,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 101.12 }],
        kept_change_usd: 0,
      });
      const s = snapshot();
      expect(r2(s.exchangeRow)).toBe(r2(MARGIN));
      expect(r2(s.keptLine)).toBe(0);
      expect(r2(s.gross)).toBe(r2(MARGIN));
    });
  });

  it("lot-tracked acquire leg (EUR -> USD, Q8 zeroes leg1): Exchange row $0, kept line $0.12", () => {
    t(() => {
      seedRates();
      new ExchangeRepository().createTransaction({
        fromCurrency: "EUR",
        toCurrency: "USD",
        amountIn: 100,
        amountOut: 116.12,
        leg1Rate: 1.1612,
        leg1MarketRate: 1.18,
        leg1ProfitUsd: 2, // replaced by 0 on the acquire leg (Q8)
        totalProfitUsd: 2,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 116 }],
        kept_change_usd: 0.12,
      });
      const s = snapshot();
      expect(r2(s.exchangeRow)).toBe(0);
      expect(r2(s.keptLine)).toBe(0.12);
      expect(r2(s.gross)).toBe(0.12);
      expect(r2(s.byDateTotal)).toBe(0.12);
      expect(r2(s.byUserTotal)).toBe(0.12);
    });
  });

  it("LBP payout: kept LBP is shown on the kept line at its USD value (totals unchanged)", () => {
    t(() => {
      seedRates();
      new ExchangeRepository().createTransaction({
        fromCurrency: "USD",
        toCurrency: "LBP",
        amountIn: 100,
        amountOut: 8_912_345,
        leg1Rate: 89_123.45,
        leg1MarketRate: 89_500,
        leg1ProfitUsd: 0,
        totalProfitUsd: 0,
        tender_exchange_rate: 89_000,
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 8_900_000 }],
        kept_change_lbp: 12_345,
      });
      const s = snapshot();
      expect(r2(s.exchangeRow)).toBe(0);
      expect(r2(s.keptLine)).toBe(r2(12_345 / 89_000));
      expect(r2(s.gross)).toBe(r2(12_345 / 89_000));
    });
  });

  it("refund (swap-back) nets the Exchange row, the kept line and every total to 0 (rule 20)", () => {
    t(() => {
      seedRates();
      const before = snapshot();
      const { id } = new ExchangeRepository().createTransaction(OWNER_TX);
      getTransactionRepository().refundTransaction(unifiedId(id), 1);
      const after = snapshot();
      for (const key of Object.keys(before) as (keyof Snapshot)[]) {
        expect([key, r2(after[key] - before[key])]).toEqual([key, 0]);
      }
    });
  });
});
