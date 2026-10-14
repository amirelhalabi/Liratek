/**
 * LIRA-321 T018 — plan owner-check #1: does an exchange whose shortfall was
 * put on the client's account (an 'Exchange Debt') count its profit AT ONCE,
 * like a fully paid exchange, or does it wait for the client to repay (the
 * DBT-1 rule service debts follow)?
 *
 * Spec US1.7 says owing does not change profit. Whitelisting 'Exchange Debt'
 * (T021) also adds it to SERVICE_DEBT_COVERAGE_TYPES, which feeds
 * `notDebtPending` — so this file pins every Profits surface: Overview
 * exchange row + gross, By Module, By Date, By Cashier, By Client, and the
 * Exchange drill-down. The exchange with the debt must read the same as the
 * fully paid one on every one of them. It also asserts the debt row exists,
 * so a run where no debt was booked cannot pass vacuously.
 *
 * No profit code is changed by LIRA-321; this is a measurement.
 */
import type Database from "better-sqlite3";
import {
  ExchangeRepository,
  type CreateExchangeData,
} from "../ExchangeRepository";
import { ProfitRepository } from "../ProfitRepository";
import { ProfitService } from "../../services/ProfitService";
import { getTransactionRepository } from "../TransactionRepository";
import {
  US1_BASE,
  US1_FORGIVE,
  US1_PART_ON_ACCOUNT,
  setupExchangeDb,
  teardownExchangeDb,
  unifiedExchangeTxnId,
} from "../testHelpers/exchangeCustomerPaysDb";

const r4 = (x: number | null | undefined) =>
  Math.round(((x ?? 0) as number) * 10_000) / 10_000;

interface Surfaces {
  overviewExchange: number;
  gross: number;
  byModuleExchange: number;
  byDate: number;
  byUser: number;
  byClient: number;
  drillDown: number;
}

function measure(payload: CreateExchangeData): {
  surfaces: Surfaces;
  exchangeDebtRows: number;
} {
  const db: Database.Database = setupExchangeDb();
  try {
    const today = (
      db.prepare(`SELECT date('now','localtime') AS d`).get() as { d: string }
    ).d;
    new ExchangeRepository().createTransaction(payload);
    const ps = new ProfitService(new ProfitRepository());
    const summary = ps.getSummary(today, today);
    const ex = ps.getByModule(today, today).find((m) => m.module === "EXCHANGE");
    const surfaces: Surfaces = {
      overviewExchange: r4(summary.exchange.profit_usd),
      gross: r4(summary.totals.gross_profit_usd),
      byModuleExchange: r4(ex?.profit_usd),
      byDate: r4(ps.getByDate(today, today).reduce((s, d) => s + d.profit_usd, 0)),
      byUser: r4(ps.getByUser(today, today).reduce((s, u) => s + u.profit_usd, 0)),
      byClient: r4(
        ps.getByClient(today, today).reduce((s, c) => s + c.profit_usd, 0),
      ),
      drillDown: r4(
        new ProfitRepository()
          .getExchangeDetail(`${today} 00:00:00`, `${today} 23:59:59`)
          .reduce((s, d) => s + d.profit_usd, 0),
      ),
    };
    const n = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM debt_ledger WHERE transaction_type = 'Exchange Debt'`,
        )
        .get() as { n: number }
    ).n;
    return { surfaces, exchangeDebtRows: n };
  } finally {
    teardownExchangeDb(db);
  }
}

describe("Profits — an exchange with an Exchange Debt counts its profit at once (US1.7)", () => {
  it("every Profits surface reads the same as the fully paid exchange", () => {
    const paid = measure({
      ...US1_BASE,
      customerPayments: [
        { method: "CASH", currencyCode: "LBP", amount: 89_500_000 },
      ],
    });
    const owing = measure(US1_PART_ON_ACCOUNT);

    expect(paid.exchangeDebtRows).toBe(0);
    expect(owing.exchangeDebtRows).toBe(1);
    // Sanity: the paid exchange shows a real margin on the Exchange row.
    expect(paid.surfaces.overviewExchange).toBeGreaterThan(0);
    expect(owing.surfaces).toEqual(paid.surfaces);
  });
});

/**
 * Measurement (not failing-first — written after T024/T030): the US1.4
 * forgiven 300,000 LBP shows on the Profits page's own "Waived" line and its
 * drill-down, and both return to 0 after the exchange is voided. Plus the
 * Pending tab does not hold the US1.1 exchange (exchange profit has no
 * debt-pending gate).
 */
describe("Profits — the forgiven leftover and the Pending tab", () => {
  it("US1.4: the Waived line and its drill-down read −300,000 LBP; a void returns both to 0", () => {
    const db: Database.Database = setupExchangeDb();
    try {
      const today = (
        db.prepare(`SELECT date('now','localtime') AS d`).get() as { d: string }
      ).d;
      const ps = new ProfitService(new ProfitRepository());
      const detail = () =>
        new ProfitRepository().getWaivedShortfallDetail(
          `${today} 00:00:00`,
          `${today} 23:59:59`,
        );
      const { id } = new ExchangeRepository().createTransaction(US1_FORGIVE);
      expect(ps.getSummary(today, today).waived.profit_lbp).toBe(-300_000);
      expect(detail().reduce((s, r) => s + r.profit_lbp, 0)).toBe(-300_000);

      getTransactionRepository().voidTransaction(
        unifiedExchangeTxnId(db, id),
        1,
      );
      expect(ps.getSummary(today, today).waived.profit_lbp).toBe(0);
      expect(detail().reduce((s, r) => s + r.profit_lbp, 0)).toBe(0);
    } finally {
      teardownExchangeDb(db);
    }
  });

  it("US1.1: the Pending tab reads the same as for the fully paid exchange", () => {
    const pending = (payload: CreateExchangeData) => {
      const db: Database.Database = setupExchangeDb();
      try {
        const today = (
          db.prepare(`SELECT date('now','localtime') AS d`).get() as { d: string }
        ).d;
        new ExchangeRepository().createTransaction(payload);
        return JSON.stringify(
          new ProfitService(new ProfitRepository()).getPendingProfit(today, today),
        );
      } finally {
        teardownExchangeDb(db);
      }
    };
    const paid = pending({
      ...US1_BASE,
      customerPayments: [
        { method: "CASH", currencyCode: "LBP", amount: 89_500_000 },
      ],
    });
    expect(pending(US1_PART_ON_ACCOUNT)).toBe(paid);
  });
});
