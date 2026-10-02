/**
 * LIRA-185 — Profits accuracy audit, module: EXCHANGE.
 *
 * Each `describe` below is one lead from the September audit
 * (scratchpad/profitaudit/exchange.json), re-run by EXECUTION against the
 * real `electron-app/create_db.sql` schema with the real writers
 * (`ExchangeRepository.createTransaction`, `PartnerRepository.addLedgerEntry`)
 * and the real read surfaces (`ProfitRepository`/`ProfitService`,
 * `ClosingService.getDailyStatsSnapshot`, `SalesService
 * .getNetProfitLast30Days`, `ExchangeLotService.previewSettlement`).
 *
 * Leads 3 and 4 are preview-vs-stamp divergences whose wrong half lives in
 * the React page (`frontend/src/features/exchange/pages/Exchange/index.tsx`),
 * which core jest cannot render. The tests here pin the server-side
 * (authoritative) numbers and the preview service's answer to the exact
 * inputs the page sends; the failing-first guard for the page itself belongs
 * in the frontend suite.
 */
import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext.js";
import { ExchangeRepository } from "../ExchangeRepository.js";
import { PartnerRepository } from "../PartnerRepository.js";
import { ProfitRepository } from "../ProfitRepository.js";
import { ClosingRepository } from "../ClosingRepository.js";
import { ProfitService } from "../../services/ProfitService.js";
import { ClosingService } from "../../services/ClosingService.js";
import { SalesService } from "../../services/SalesService.js";
import { ExchangeLotService } from "../../services/ExchangeLotService.js";
import { exchangeSubmitSchema } from "../../validators/exchange.js";

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

function seedRate(code: string, market: number, buy: number, sell: number, isStronger: 1 | -1): void {
  db.prepare(
    `INSERT OR REPLACE INTO exchange_rates (tenant_id, to_code, market_rate, buy_rate, sell_rate, is_stronger) VALUES (1, ?, ?, ?, ?, ?)`,
  ).run(code, market, buy, sell, isStronger);
}

interface ExRow {
  amount_in: number;
  amount_out: number;
  profit_usd: number | null;
  leg1_profit_usd: number | null;
  leg2_profit_usd: number | null;
}
function exRow(id: number): ExRow {
  return db.prepare(`SELECT * FROM exchange_transactions WHERE id = ?`).get(id) as ExRow;
}
/** HistoryModal.tsx:387-390 — the History "Profit" cell, transcribed. */
function historyProfit(row: ExRow): number | null {
  return row.leg1_profit_usd !== null || row.leg2_profit_usd !== null
    ? (row.leg1_profit_usd ?? 0) + (row.leg2_profit_usd ?? 0)
    : row.profit_usd;
}

// Lead-1 worked example: LBP buy 89,000 / market 89,500 / sell 90,000.
const P_A = (9_000_000 * 500) / 89_500 ** 2; // 0.56178...
const P_B = (100 * 500) / 89_500; // 0.55865...

function bookLead1Pair(repo: ExchangeRepository): void {
  repo.createTransaction({
    fromCurrency: "LBP",
    toCurrency: "USD",
    amountIn: 9_000_000,
    amountOut: 100,
    leg1Rate: 90_000,
    leg1MarketRate: 89_500,
    leg1ProfitUsd: P_A,
    totalProfitUsd: P_A,
  });
  repo.createTransaction({
    fromCurrency: "USD",
    toCurrency: "LBP",
    amountIn: 100,
    amountOut: 8_900_000,
    leg1Rate: 89_000,
    leg1MarketRate: 89_500,
    leg1ProfitUsd: P_B,
    totalProfitUsd: P_B,
  });
}

describe("LIRA-185 exchange — lead 1: revenue_usd sums amount_in in from_currency", () => {
  beforeEach(fresh);

  it("Profits revenue for $100 LBP->USD + $100 USD->LBP is $200, not $9,000,100", () => {
    t(() => {
      seedRate("LBP", 89_500, 89_000, 90_000, 1);
      bookLead1Pair(new ExchangeRepository());
      const pr = new ProfitRepository();
      const ps = new ProfitService(pr);
      const totals = pr.getExchangeTotals(`${TODAY} 00:00:00`, `${TODAY} 23:59:59`);
      const mod = ps.getByModule(TODAY, TODAY).find((m) => m.module === "EXCHANGE");
      const summary = ps.getSummary(TODAY, TODAY);
      const byDate = ps.getByDate(TODAY, TODAY);

      expect(r2(totals.revenue_usd)).toBe(200);
      expect(r2(totals.profit_usd)).toBe(r2(P_A + P_B)); // 1.12
      expect(r2(mod?.revenue_usd)).toBe(200);
      expect(r2(mod?.cost_usd)).toBe(r2(200 - (P_A + P_B)));
      expect(r2(summary.totals.gross_revenue_usd)).toBe(200);
      expect(r2(byDate.reduce((s, d) => s + d.revenue_usd, 0))).toBe(200);
    });
  });
});

describe("LIRA-185 exchange — lead 2: for-partner profit, Profits vs Closing vs History", () => {
  beforeEach(fresh);

  it("half-settled for-partner LBP->USD: Profits and Closing both recognise 50%", () => {
    t(() => {
      seedRate("LBP", 89_500, 89_000, 90_000, 1);
      const partners = new PartnerRepository();
      const partner = partners.create({ name: "Audit Partner" } as never);
      const { id } = new ExchangeRepository().createTransaction({
        fromCurrency: "LBP",
        toCurrency: "USD",
        amountIn: 9_000_000,
        amountOut: 100,
        leg1Rate: 90_000,
        leg1MarketRate: 89_500,
        leg1ProfitUsd: P_A,
        totalProfitUsd: P_A,
        partnerId: partner.id,
        partnerMode: "FOR",
      });
      partners.addLedgerEntry({
        partner_id: partner.id,
        transaction_type: "SETTLEMENT",
        amount: 4_500_000,
        currency: "LBP",
        direction: "CREDIT",
      });
      const forRow = db
        .prepare(`SELECT amount, covered_amount FROM partner_ledger WHERE transaction_type = 'FOR_EXCHANGE'`)
        .get() as { amount: number; covered_amount: number };
      expect(forRow.amount).toBe(9_000_000);
      expect(forRow.covered_amount).toBe(4_500_000);

      const pr = new ProfitRepository();
      const profits = pr.getExchangeTotals(`${TODAY} 00:00:00`, `${TODAY} 23:59:59`).profit_usd;
      const closing = new ClosingService(new ClosingRepository(), new ProfitService(pr))
        .getDailyStatsSnapshot({ day: TODAY }, { includeProfit: true }).totalProfitUSD;

      expect(r2(profits)).toBe(r2(P_A * 0.5)); // 0.28
      expect(r2(closing)).toBe(r2(P_A * 0.5)); // 0.28 — was $0.00 per the lead
      // History is the per-transaction record, gross by construction.
      expect(r2(historyProfit(exRow(id)))).toBe(r2(P_A)); // 0.56
    });
  });
});

describe("LIRA-185 exchange — lead 3: cross exotic->exotic with no USD anchor", () => {
  beforeEach(fresh);

  it("server keeps the client leg-1 override profit; preview service reports NO_RATE_ANCHOR", () => {
    t(() => {
      // GBP -> AED via USD, neither has an exchange_rates row (feed-only).
      // Operator overrides leg 1 to 1.20 USD/GBP against market 1.30.
      const { id } = new ExchangeRepository().createTransaction({
        fromCurrency: "GBP",
        toCurrency: "AED",
        amountIn: 1000,
        amountOut: 4404, // 1200 USD x 3.67
        leg1Rate: 1.2,
        leg1MarketRate: 1.3,
        leg1ProfitUsd: 100,
        leg2Rate: 3.67,
        leg2MarketRate: 3.67,
        leg2ProfitUsd: 0,
        viaCurrency: "USD",
        totalProfitUsd: 100,
      });
      const row = exRow(id);
      expect(row.leg1_profit_usd).toBe(100);
      expect(row.profit_usd).toBe(100);
      const unified = db
        .prepare(`SELECT profit_usd FROM transactions WHERE source_table='exchange_transactions' AND source_id=?`)
        .get(id) as { profit_usd: number };
      expect(unified.profit_usd).toBe(100);
      expect(db.prepare(`SELECT COUNT(*) c FROM exchange_lots`).get()).toEqual({ c: 0 });
      expect(r2(new ProfitRepository().getExchangeTotals(`${TODAY} 00:00:00`, `${TODAY} 23:59:59`).profit_usd)).toBe(100);

      const preview = new ExchangeLotService().previewSettlement({
        currencyCode: "AED",
        qty: 4404,
        unitProceedsUsd: 1200 / 4404,
        fromCurrency: "GBP",
      });
      expect(preview).toMatchObject({ lotTracked: false, reason: "NO_RATE_ANCHOR" });
      // index.tsx:621 zeroes leg 1 on `fromIsLotTracked` alone, so the page
      // shows Total +$0.0000 for this $100.00 booking (frontend guard needed).
    });
  });
});

describe("LIRA-185 exchange — lead 4: FIFO preview denominator vs stamp", () => {
  beforeEach(fresh);

  it("USD->EUR $1,000 against a 1.16 lot: stamp books 33.34; preview with the page's inputs says 33.33", () => {
    t(() => {
      seedRate("EUR", 1.18, 1.16, 1.2, -1);
      const repo = new ExchangeRepository();
      // Real acquire: opens a 1,000 EUR lot at 1160/1000 = 1.16.
      repo.createTransaction({
        fromCurrency: "EUR",
        toCurrency: "USD",
        amountIn: 1000,
        amountOut: 1160,
        leg1Rate: 1.16,
        leg1MarketRate: 1.18,
        leg1ProfitUsd: 0,
        totalProfitUsd: 0,
      });

      const rawQty = 1000 / 1.2; // consumingLeg.amountOut (unrounded)
      const submittedQty = parseFloat(rawQty.toFixed(2)); // 833.33

      // Preview exactly as index.tsx:863-892 calls it: qty rounded, price raw.
      const pagePreview = new ExchangeLotService().previewSettlement({
        currencyCode: "EUR",
        qty: submittedQty,
        unitProceedsUsd: 1000 / rawQty,
        fromCurrency: "USD",
      }) as { lotTracked: boolean; realizedProfitUsd: number };
      // Preview with the server's own pair (amountIn / submitted amountOut).
      const serverPairPreview = new ExchangeLotService().previewSettlement({
        currencyCode: "EUR",
        qty: submittedQty,
        unitProceedsUsd: 1000 / submittedQty,
        fromCurrency: "USD",
      }) as { lotTracked: boolean; realizedProfitUsd: number };

      const { id } = repo.createTransaction({
        fromCurrency: "USD",
        toCurrency: "EUR",
        amountIn: 1000,
        amountOut: submittedQty,
        leg1Rate: 1.2,
        leg1MarketRate: 1.18,
        leg1ProfitUsd: 0,
        totalProfitUsd: 0,
      });
      const stamped = exRow(id).leg1_profit_usd;

      expect(stamped).toBe(33.34);
      expect(serverPairPreview.realizedProfitUsd).toBe(33.34);
      // Measured divergence: the page's raw-denominator input previews 33.33.
      expect(pagePreview.lotTracked).toBe(true);
      expect(pagePreview.realizedProfitUsd).toBe(33.33);
    });
  });
});

describe("LIRA-185 exchange — lead 5: EXCHANGE_LEG_PROFIT copies", () => {
  beforeEach(fresh);

  it("every writer stamps leg1_profit_usd, so History's profit_usd fallback is unreachable; Closing now reads ProfitService", () => {
    t(() => {
      seedRate("LBP", 89_500, 89_000, 90_000, 1);
      bookLead1Pair(new ExchangeRepository());
      const rows = db.prepare(`SELECT * FROM exchange_transactions`).all() as ExRow[];
      expect(rows.every((x) => x.leg1_profit_usd !== null)).toBe(true);
      const parsed = exchangeSubmitSchema.safeParse({
        fromCurrency: "USD",
        toCurrency: "LBP",
        amountIn: 100,
        amountOut: 8_900_000,
        leg1Rate: 89_000,
        leg1MarketRate: 89_500,
        totalProfitUsd: 1,
      });
      expect(parsed.success).toBe(false); // leg1ProfitUsd is required

      const pr = new ProfitRepository();
      const history = rows.reduce((s, x) => s + (historyProfit(x) ?? 0), 0);
      const profits = pr.getExchangeTotals(`${TODAY} 00:00:00`, `${TODAY} 23:59:59`).profit_usd;
      const closing = new ClosingService(new ClosingRepository(), new ProfitService(pr))
        .getDailyStatsSnapshot({ day: TODAY }, { includeProfit: true }).totalProfitUSD;
      expect(r2(history)).toBe(r2(profits));
      expect(r2(closing)).toBe(r2(profits));
    });
  });
});

describe("LIRA-185 exchange — lead 6: Dashboard net-profit tile omits exchange", () => {
  beforeEach(fresh);

  it("Dashboard 30-day net profit includes exchange profit and equals the Profits page", () => {
    t(() => {
      seedRate("LBP", 89_500, 89_000, 90_000, 1);
      bookLead1Pair(new ExchangeRepository());
      const ps = new ProfitService(new ProfitRepository());
      const tile = new SalesService(undefined, ps).getNetProfitLast30Days(TODAY);
      const summary = ps.getSummary(TODAY, TODAY);
      expect(r2(tile.netProfitUSD)).toBe(r2(P_A + P_B)); // 1.12
      expect(r2(tile.netProfitUSD)).toBe(r2(summary.totals.net_profit_usd));
    });
  });
});
