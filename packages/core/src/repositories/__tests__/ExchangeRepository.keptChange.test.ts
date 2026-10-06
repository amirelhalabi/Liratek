/**
 * Exchange "keep the change" on a PAYOUT (owner decision 2026-10-06, D9
 * refined).
 *
 * On Exchange the payment sheet is a PAYOUT sheet: each line is cash the shop
 * hands OUT. Owner example: 9,000,000 LBP -> USD at 89,000 = $101.12 owed; the
 * cashier hands over $101 and KEEPS $0.12 as shop profit. So keep-change here
 * runs in the opposite direction to T3 (which keeps an OVERPAY): the payout
 * lines are SHORT of amountOut by a small leftover, and that leftover
 * (owed - paid) becomes profit.
 *
 * Contract pinned here:
 *   - payout legs reconcile against amountOut - kept (hard-reject otherwise);
 *   - kept is shop profit but NOT exchange margin (owner decision
 *     2026-10-06, refined): exchange_transactions' leg/profit columns keep
 *     the margin only (the Profits page's Exchange row), while the kept USD
 *     value is booked on the unified EXCHANGE row (profit_usd = margin +
 *     kept, metadata kept_profit_usd) and surfaces as
 *     getExchangeTotals().kept_change_usd — the Profits page's Kept change
 *     line. LBP kept is converted at the till rate (exchange profit is
 *     USD-only — there is no LBP profit column);
 *   - an OVERPAID payout (lines > owed) is still rejected and never booked as
 *     profit, with or without kept;
 *   - kept is rejected on FOR-partner exchanges, without payout legs, above the
 *     small-leftover cap, in the non-payout currency, or when the lines already
 *     cover what is owed;
 *   - refund (plain swap-back REFUND) nets drawers, Exchange profit AND the
 *     kept line to 0, per currency (rule 20).
 *
 * Runs against the real electron-app/create_db.sql schema and the real
 * ProfitRepository read surface (pattern: ProfitAudit.exchange.test.ts).
 */
import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext.js";
import {
  ExchangeRepository,
  type CreateExchangeData,
} from "../ExchangeRepository.js";
import { PartnerRepository } from "../PartnerRepository.js";
import { ProfitRepository } from "../ProfitRepository.js";
import { getTransactionRepository } from "../TransactionRepository.js";
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

function seedRate(): void {
  db.prepare(
    `INSERT OR REPLACE INTO exchange_rates (tenant_id, to_code, market_rate, buy_rate, sell_rate, is_stronger) VALUES (1, 'LBP', 89500, 89000, 90000, 1)`,
  ).run();
}

function bal(drawer: string, currency: string): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE tenant_id = 1 AND drawer_name = ? AND currency_code = ?`,
    )
    .get(drawer, currency) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

function exchangeProfit(): number {
  return new ProfitRepository().getExchangeTotals(`${TODAY} 00:00:00`, `${TODAY} 23:59:59`)
    .profit_usd;
}

/** The Profits page's Kept change line contribution from exchange payouts. */
function exchangeKept(): number {
  return new ProfitRepository().getExchangeTotals(`${TODAY} 00:00:00`, `${TODAY} 23:59:59`)
    .kept_change_usd;
}

function count(table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

function unifiedRow(exchangeId: number): { id: number; profit_usd: number; profit_lbp: number } {
  return db
    .prepare(
      `SELECT id, profit_usd, profit_lbp FROM transactions WHERE source_table = 'exchange_transactions' AND source_id = ? AND type = 'EXCHANGE'`,
    )
    .get(exchangeId) as { id: number; profit_usd: number; profit_lbp: number };
}

/** Owner example: 9,000,000 LBP -> USD at 89,000 -> $101.12 owed. */
const LEG1_PROFIT = 9_000_000 / 89_000 - 9_000_000 / 89_500; // 0.5649...
const OWNER_TX: CreateExchangeData = {
  fromCurrency: "LBP",
  toCurrency: "USD",
  amountIn: 9_000_000,
  amountOut: 101.12,
  leg1Rate: 89_000,
  leg1MarketRate: 89_500,
  leg1ProfitUsd: LEG1_PROFIT,
  totalProfitUsd: LEG1_PROFIT,
  tender_exchange_rate: 89_000,
};

describe("Exchange payout keep-change — owner example ($101 handed over, $0.12 kept)", () => {
  beforeEach(fresh);

  it("accepts a $101 payout against $101.12 owed with kept 0.12: USD drawer -101, kept line +0.12, Exchange row = margin", () => {
    t(() => {
      seedRate();
      const usd0 = bal("General", "USD");
      const lbp0 = bal("General", "LBP");
      const profit0 = exchangeProfit();
      const kept0 = exchangeKept();

      const { id, bookedProfitUsd } = new ExchangeRepository().createTransaction({
        ...OWNER_TX,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 101 }],
        kept_change_usd: 0.12,
        kept_change_lbp: 0,
      });

      expect(r2(bal("General", "USD") - usd0)).toBe(-101);
      expect(r2(bal("General", "LBP") - lbp0)).toBe(9_000_000);
      expect(r2(exchangeProfit() - profit0)).toBe(r2(LEG1_PROFIT));
      expect(r2(exchangeKept() - kept0)).toBe(0.12);
      // bookedProfitUsd (the session stamp) matches the unified row.
      expect(r2(bookedProfitUsd)).toBe(r2(LEG1_PROFIT + 0.12));
      expect(r2(unifiedRow(id).profit_usd)).toBe(r2(LEG1_PROFIT + 0.12));
      const ex = db
        .prepare(`SELECT leg1_profit_usd, leg2_profit_usd, profit_usd FROM exchange_transactions WHERE id = ?`)
        .get(id) as { leg1_profit_usd: number; leg2_profit_usd: number | null; profit_usd: number };
      expect(r2(ex.leg1_profit_usd)).toBe(r2(LEG1_PROFIT));
      expect(r2(ex.leg2_profit_usd)).toBe(0);
      expect(r2(ex.profit_usd)).toBe(r2(LEG1_PROFIT));
    });
  });

  it("the kept 0.12 is exactly the delta vs. the same exchange paid in full — on the kept line, not the Exchange row", () => {
    t(() => {
      seedRate();
      const p0 = exchangeProfit();
      const k0 = exchangeKept();
      new ExchangeRepository().createTransaction({
        ...OWNER_TX,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 101.12 }],
      });
      const fullProfit = exchangeProfit() - p0;
      expect(r2(exchangeKept() - k0)).toBe(0);
      const p1 = exchangeProfit();
      const k1 = exchangeKept();
      new ExchangeRepository().createTransaction({
        ...OWNER_TX,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 101 }],
        kept_change_usd: 0.12,
      });
      expect(r2(exchangeProfit() - p1 - fullProfit)).toBe(0);
      expect(r2(exchangeKept() - k1)).toBe(0.12);
    });
  });

  it("refund (swap-back) nets drawers and Exchange profit to 0, per currency (rule 20)", () => {
    t(() => {
      seedRate();
      const usd0 = bal("General", "USD");
      const lbp0 = bal("General", "LBP");
      const profit0 = exchangeProfit();
      const kept0 = exchangeKept();

      const { id } = new ExchangeRepository().createTransaction({
        ...OWNER_TX,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 101 }],
        kept_change_usd: 0.12,
      });
      const original = unifiedRow(id);
      const refundId = getTransactionRepository().refundTransaction(original.id, 1);

      expect(r2(bal("General", "USD") - usd0)).toBe(0);
      expect(r2(bal("General", "LBP") - lbp0)).toBe(0);
      expect(r2(exchangeProfit() - profit0)).toBe(0);
      expect(r2(exchangeKept() - kept0)).toBe(0);
      const refund = db
        .prepare(`SELECT profit_usd, profit_lbp FROM transactions WHERE id = ?`)
        .get(refundId) as { profit_usd: number; profit_lbp: number };
      expect(r2(refund.profit_usd + original.profit_usd)).toBe(0);
      expect(r2((refund.profit_lbp ?? 0) + (original.profit_lbp ?? 0))).toBe(0);
    });
  });

  it("LBP payout: kept LBP leftover is booked as USD-equivalent profit at the till rate", () => {
    t(() => {
      seedRate();
      const p0 = exchangeProfit();
      const k0 = exchangeKept();
      const lbp0 = bal("General", "LBP");
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
      expect(bal("General", "LBP") - lbp0).toBe(-8_900_000);
      expect(r2(exchangeProfit() - p0)).toBe(0);
      expect(r2(exchangeKept() - k0)).toBe(r2(12_345 / 89_000));
    });
  });
});

describe("Exchange payout keep-change — lot-tracked acquire leg (ordering)", () => {
  beforeEach(fresh);

  it("EUR -> USD (acquire leg zeroed, Q8): kept 0.12 stays off the lot-overwritten legs, reaches the kept line, and refund nets to 0", () => {
    t(() => {
      seedRate();
      db.prepare(
        `INSERT OR REPLACE INTO exchange_rates (tenant_id, to_code, market_rate, buy_rate, sell_rate, is_stronger) VALUES (1, 'EUR', 1.18, 1.16, 1.2, -1)`,
      ).run();
      const usd0 = bal("General", "USD");
      const eur0 = bal("General", "EUR");
      const p0 = exchangeProfit();
      const k0 = exchangeKept();

      const { id, bookedProfitUsd } = new ExchangeRepository().createTransaction({
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

      const ex = db
        .prepare(`SELECT leg1_profit_usd, profit_usd FROM exchange_transactions WHERE id = ?`)
        .get(id) as { leg1_profit_usd: number; profit_usd: number };
      expect(r2(ex.leg1_profit_usd)).toBe(0);
      expect(r2(ex.profit_usd)).toBe(0);
      expect(r2(bookedProfitUsd)).toBe(0.12);
      expect(r2(unifiedRow(id).profit_usd)).toBe(0.12);
      expect(r2(exchangeProfit() - p0)).toBe(0);
      expect(r2(exchangeKept() - k0)).toBe(0.12);
      expect(r2(bal("General", "USD") - usd0)).toBe(-116);

      getTransactionRepository().refundTransaction(unifiedRow(id).id, 1);
      expect(r2(bal("General", "USD") - usd0)).toBe(0);
      expect(r2(bal("General", "EUR") - eur0)).toBe(0);
      expect(r2(exchangeProfit() - p0)).toBe(0);
      expect(r2(exchangeKept() - k0)).toBe(0);
    });
  });
});

describe("Exchange payout keep-change — rejections (never book a loss or a shortchange as profit)", () => {
  beforeEach(fresh);

  function expectNothingWritten(): void {
    expect(count("exchange_transactions")).toBe(0);
    expect(count("transactions")).toBe(0);
    expect(bal("General", "USD")).toBe(0);
    expect(bal("General", "LBP")).toBe(0);
  }

  it("an OVERPAID payout (lines > owed) is still rejected — no kept", () => {
    t(() => {
      seedRate();
      expect(() =>
        new ExchangeRepository().createTransaction({
          ...OWNER_TX,
          payments: [{ method: "CASH", currencyCode: "USD", amount: 101.5 }],
        }),
      ).toThrow(/do not reconcile/);
      expectNothingWritten();
    });
  });

  it("an OVERPAID payout is rejected even when kept is sent — never booked as profit", () => {
    t(() => {
      seedRate();
      expect(() =>
        new ExchangeRepository().createTransaction({
          ...OWNER_TX,
          payments: [{ method: "CASH", currencyCode: "USD", amount: 101.5 }],
          kept_change_usd: 0.38,
        }),
      ).toThrow();
      expectNothingWritten();
    });
  });

  it("kept with lines that already cover what is owed is rejected (phantom profit)", () => {
    t(() => {
      seedRate();
      expect(() =>
        new ExchangeRepository().createTransaction({
          ...OWNER_TX,
          payments: [{ method: "CASH", currencyCode: "USD", amount: 101.12 }],
          kept_change_usd: 0.04, // inside the reconcile epsilon — must still refuse
        }),
      ).toThrow(/short/i);
      expectNothingWritten();
    });
  });

  it("kept that does not match the shortfall is rejected", () => {
    t(() => {
      seedRate();
      expect(() =>
        new ExchangeRepository().createTransaction({
          ...OWNER_TX,
          payments: [{ method: "CASH", currencyCode: "USD", amount: 100.5 }],
          kept_change_usd: 0.12,
        }),
      ).toThrow(/do not reconcile/);
      expectNothingWritten();
    });
  });

  it("kept at or above the small-leftover cap is rejected ($1 / 100,000 LBP)", () => {
    t(() => {
      seedRate();
      expect(() =>
        new ExchangeRepository().createTransaction({
          ...OWNER_TX,
          payments: [{ method: "CASH", currencyCode: "USD", amount: 100.12 }],
          kept_change_usd: 1,
        }),
      ).toThrow(/leftover/i);
      expectNothingWritten();
    });
  });

  it("kept in the non-payout currency is rejected", () => {
    t(() => {
      seedRate();
      expect(() =>
        new ExchangeRepository().createTransaction({
          ...OWNER_TX,
          payments: [{ method: "CASH", currencyCode: "USD", amount: 101 }],
          kept_change_lbp: 10_680,
        }),
      ).toThrow(/currency/i);
      expectNothingWritten();
    });
  });

  it("kept without payout legs is rejected (the lump fallback pays the full amount)", () => {
    t(() => {
      seedRate();
      expect(() =>
        new ExchangeRepository().createTransaction({
          ...OWNER_TX,
          kept_change_usd: 0.12,
        }),
      ).toThrow(/payout/i);
      expectNothingWritten();
    });
  });

  it("kept on a FOR-partner exchange is rejected (no customer counter)", () => {
    t(() => {
      seedRate();
      const partnerId = new PartnerRepository().create({ name: "KC Partner" } as never).id;
      expect(() =>
        new ExchangeRepository().createTransaction({
          ...OWNER_TX,
          partnerId,
          partnerMode: "FOR",
          kept_change_usd: 0.12,
        }),
      ).toThrow(/partner/i);
      expect(count("exchange_transactions")).toBe(0);
    });
  });
});

describe("Exchange keep-change — schema (one contract, both transports)", () => {
  const base = {
    fromCurrency: "LBP",
    toCurrency: "USD",
    amountIn: 9_000_000,
    amountOut: 101.12,
    leg1Rate: 89_000,
    leg1MarketRate: 89_500,
    leg1ProfitUsd: 0.56,
    totalProfitUsd: 0.56,
  };

  it("keeps kept_change_usd / kept_change_lbp (not stripped)", () => {
    const parsed = exchangeSubmitSchema.parse({
      ...base,
      kept_change_usd: 0.12,
      kept_change_lbp: 0,
    }) as Record<string, unknown>;
    expect(parsed.kept_change_usd).toBe(0.12);
    expect(parsed.kept_change_lbp).toBe(0);
  });

  it("rejects negative kept amounts", () => {
    expect(
      exchangeSubmitSchema.safeParse({ ...base, kept_change_usd: -0.12 }).success,
    ).toBe(false);
  });
});
