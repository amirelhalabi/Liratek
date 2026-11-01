/**
 * LIRA-369 — Exchange: the payment window for every currency, and the
 * customer's account in both directions.
 *
 * Real writer, real schema. Every assertion is a DELTA (rule 15) over the
 * General drawers, the client's account (debt_ledger), the EUR position
 * (open lot quantity) and the profit stamp. Owner decisions 2026-11-01:
 *  - an EUR (or other) payout pays in that currency's cash and/or the account;
 *  - a non-USD/LBP amount on the account is a fixed USD amount at a rate typed
 *    on the form; the note keeps "<amount> <CUR> @ <rate> = $<usd>";
 *  - the account part never moves the EUR drawer or the EUR position (Q1 = A);
 *  - a typed rate other than the exchange's own changes the margin by the gap.
 */
import type Database from "better-sqlite3";
import {
  ExchangeRepository,
  type CreateExchangeData,
} from "../ExchangeRepository";
import { getTransactionRepository } from "../TransactionRepository";
import { getExchangeLotRepository } from "../ExchangeLotRepository";
import {
  CLIENT_ID,
  US1_BASE,
  US1_MARGIN,
  delta,
  setupExchangeDb,
  snapshot,
  teardownExchangeDb,
  unifiedExchangeTxnId,
} from "../testHelpers/exchangeCustomerPaysDb";

let db: Database.Database;

beforeEach(() => {
  db = setupExchangeDb();
  // 1,000 EUR in stock at $1.05 — every EUR sale below is covered by it.
  getExchangeLotRepository().createLot({
    currencyCode: "EUR",
    sourceType: "EXCHANGE_BUY",
    sourceTable: "exchange_transactions",
    sourceId: 9999,
    qty: 1000,
    unitCostUsd: 1.05,
    acquiredAt: "2026-10-01 10:00:00",
  });
});
afterEach(() => teardownExchangeDb(db));

const create = (data: CreateExchangeData) =>
  new ExchangeRepository().createTransaction(data);

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Open EUR quantity (the position). */
function eurPosition(): number {
  return (
    db
      .prepare(
        /* tenant-exempt: test-only — single-tenant in-memory test database */
        `SELECT COALESCE(SUM(remaining_qty), 0) AS q FROM exchange_lots WHERE currency_code = 'EUR' AND is_voided = 0`,
      )
      .get() as { q: number }
  ).q;
}

/** The client's account entries of one type, per currency. */
function account(type: string): { usd: number; lbp: number } {
  return db
    .prepare(
      /* tenant-exempt: test-only — single-tenant in-memory test database */
      `SELECT COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_lbp), 0) AS lbp
         FROM debt_ledger WHERE client_id = ? AND transaction_type = ?`,
    )
    .get(CLIENT_ID, type) as { usd: number; lbp: number };
}

function notesOf(type: string): string[] {
  return (
    db
      .prepare(
        /* tenant-exempt: test-only — single-tenant in-memory test database */
        `SELECT note FROM debt_ledger WHERE client_id = ? AND transaction_type = ? ORDER BY id`,
      )
      .all(CLIENT_ID, type) as Array<{ note: string | null }>
  ).map((r) => r.note ?? "");
}

function detailsOf(exchangeId: number): Record<string, unknown> {
  const row = db
    .prepare(
      /* tenant-exempt: test-only — single-tenant in-memory test database */
      `SELECT metadata_json FROM transactions WHERE id = ?`,
    )
    .get(unifiedExchangeTxnId(db, exchangeId)) as { metadata_json: string };
  const meta = JSON.parse(row.metadata_json) as { details?: object };
  return (meta.details ?? {}) as Record<string, unknown>;
}

/** $110 → 100 EUR at the shop's 1.10, EUR cost 1.05 → margin $5. */
const USD_EUR: CreateExchangeData = {
  fromCurrency: "USD",
  toCurrency: "EUR",
  amountIn: 110,
  amountOut: 100,
  leg1Rate: 1.1,
  leg1MarketRate: 1.18,
  leg1ProfitUsd: 5,
  totalProfitUsd: 5,
  customerPayments: [{ method: "CASH", currencyCode: "USD", amount: 110 }],
};

/** 100 EUR → $105 at the shop's 1.05 buy rate. */
const EUR_USD: CreateExchangeData = {
  fromCurrency: "EUR",
  toCurrency: "USD",
  amountIn: 100,
  amountOut: 105,
  leg1Rate: 1.05,
  leg1MarketRate: 1.18,
  leg1ProfitUsd: 0,
  totalProfitUsd: 0,
  payments: [{ method: "CASH", currencyCode: "USD", amount: 105 }],
};

describe("US1 — an EUR payout goes through the payment lines", () => {
  it("USD→EUR, 100 EUR cash: USD +110, EUR −100, position −100, margin $5", () => {
    const before = snapshot(db);
    const pos = eurPosition();
    create({
      ...USD_EUR,
      payments: [{ method: "CASH", currencyCode: "EUR", amount: 100 }],
    });
    const d = delta(before, snapshot(db));
    expect(d.generalUsd).toBe(110);
    expect(d.generalEur).toBe(-100);
    expect(r2(eurPosition() - pos)).toBe(-100);
    expect(d.profitUsd).toBeCloseTo(5, 6);
  });

  it("a payout line in USD on an EUR exchange is refused, nothing written", () => {
    const before = snapshot(db);
    expect(() =>
      create({
        ...USD_EUR,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 110 }],
      }),
    ).toThrow(/EUR/);
    expect(delta(before, snapshot(db))).toEqual(delta(before, before));
  });

  it("payout lines short of 100 EUR are refused", () => {
    expect(() =>
      create({
        ...USD_EUR,
        payments: [{ method: "CASH", currencyCode: "EUR", amount: 90 }],
      }),
    ).toThrow();
  });

  it("void nets drawers, position and profit to 0", () => {
    const before = snapshot(db);
    const pos = eurPosition();
    const { id } = create({
      ...USD_EUR,
      payments: [{ method: "CASH", currencyCode: "EUR", amount: 100 }],
    });
    getTransactionRepository().voidTransaction(unifiedExchangeTxnId(db, id), 1);
    expect(delta(before, snapshot(db))).toEqual(delta(before, before));
    expect(r2(eurPosition() - pos)).toBe(0);
  });
});

describe("US2 — OUT to the customer's account", () => {
  it("LBP→USD, the whole $1,000 to the account: no USD leaves, credit $1,000, margin unchanged", () => {
    const before = snapshot(db);
    const creditBefore = account("CREDIT_DEPOSIT");
    const { id } = create({
      ...US1_BASE,
      clientId: CLIENT_ID,
      customerPayments: [
        { method: "CASH", currencyCode: "LBP", amount: 89_500_000 },
      ],
      payments: [
        { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 1000 },
      ],
    });
    const d = delta(before, snapshot(db));
    expect(d.generalLbp).toBe(89_500_000);
    expect(d.generalUsd).toBe(0);
    expect(account("CREDIT_DEPOSIT").usd - creditBefore.usd).toBe(-1000);
    expect(d.profitUsd).toBeCloseTo(US1_MARGIN, 6);
    const link = db
      .prepare(
        /* tenant-exempt: test-only — single-tenant in-memory test database */
        `SELECT transaction_id FROM debt_ledger WHERE transaction_type = 'CREDIT_DEPOSIT'`,
      )
      .get() as { transaction_id: number };
    expect(link.transaction_id).toBe(unifiedExchangeTxnId(db, id));
  });

  it("USD→LBP to the account: credited in LBP", () => {
    const creditBefore = account("CREDIT_DEPOSIT");
    const before = snapshot(db);
    create({
      fromCurrency: "USD",
      toCurrency: "LBP",
      amountIn: 1000,
      amountOut: 89_000_000,
      leg1Rate: 89_000,
      leg1MarketRate: 89_500,
      leg1ProfitUsd: 1000 - 89_000_000 / 89_500,
      totalProfitUsd: 1000 - 89_000_000 / 89_500,
      clientId: CLIENT_ID,
      payments: [
        {
          method: "CUSTOMER_ACCOUNT",
          currencyCode: "LBP",
          amount: 89_000_000,
        },
      ],
    });
    expect(account("CREDIT_DEPOSIT").lbp - creditBefore.lbp).toBe(-89_000_000);
    expect(delta(before, snapshot(db)).generalLbp).toBe(0);
  });

  it("USD→EUR, all 100 EUR to the account at 1.10: credit $110, EUR drawer and position unchanged, margin 0", () => {
    const before = snapshot(db);
    const pos = eurPosition();
    const { id } = create({
      ...USD_EUR,
      clientId: CLIENT_ID,
      payments: [
        { method: "CUSTOMER_ACCOUNT", currencyCode: "EUR", amount: 100 },
      ],
      payout_account_usd_rate: 1.1,
    });
    const d = delta(before, snapshot(db));
    expect(d.generalUsd).toBe(110);
    expect(d.generalEur).toBe(0);
    expect(r2(eurPosition() - pos)).toBe(0);
    expect(account("CREDIT_DEPOSIT")).toEqual({ usd: -110, lbp: 0 });
    expect(d.profitUsd).toBeCloseTo(0, 6);
    expect(notesOf("CREDIT_DEPOSIT")[0]).toMatch(/100.*EUR @ 1\.1.*110/);
    expect(detailsOf(id).accountConversion).toEqual([
      { side: "payout", currency: "EUR", amount: 100, rate: 1.1, usd: 110 },
    ]);
  });

  it("split 60 EUR cash + 40 EUR to the account at 1.10: EUR −60, position −60, credit $44, margin $3", () => {
    const before = snapshot(db);
    const pos = eurPosition();
    create({
      ...USD_EUR,
      clientId: CLIENT_ID,
      payments: [
        { method: "CASH", currencyCode: "EUR", amount: 60 },
        { method: "CUSTOMER_ACCOUNT", currencyCode: "EUR", amount: 40 },
      ],
      payout_account_usd_rate: 1.1,
    });
    const d = delta(before, snapshot(db));
    expect(d.generalEur).toBe(-60);
    expect(r2(eurPosition() - pos)).toBe(-60);
    expect(account("CREDIT_DEPOSIT")).toEqual({ usd: -44, lbp: 0 });
    expect(d.profitUsd).toBeCloseTo(3, 6);
  });

  it("a typed 1.08 instead of 1.10 on 40 EUR: credit $43.20, margin $3 + $0.80", () => {
    const before = snapshot(db);
    create({
      ...USD_EUR,
      clientId: CLIENT_ID,
      payments: [
        { method: "CASH", currencyCode: "EUR", amount: 60 },
        { method: "CUSTOMER_ACCOUNT", currencyCode: "EUR", amount: 40 },
      ],
      payout_account_usd_rate: 1.08,
    });
    expect(account("CREDIT_DEPOSIT")).toEqual({ usd: -43.2, lbp: 0 });
    expect(delta(before, snapshot(db)).profitUsd).toBeCloseTo(3.8, 6);
  });

  it("USD→LBP paid as LBP cash + a USD account line: the credit is in USD, not LBP", () => {
    const before = snapshot(db);
    create({
      fromCurrency: "USD",
      toCurrency: "LBP",
      amountIn: 1000,
      amountOut: 89_000_000,
      leg1Rate: 89_000,
      leg1MarketRate: 89_500,
      leg1ProfitUsd: 0,
      totalProfitUsd: 0,
      clientId: CLIENT_ID,
      payments: [
        { method: "CASH", currencyCode: "LBP", amount: 80_100_000 },
        { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 100 },
      ],
      tender_exchange_rate: 89_000,
    });
    const d = delta(before, snapshot(db));
    expect(d.generalLbp).toBe(-80_100_000);
    expect(account("CREDIT_DEPOSIT")).toEqual({ usd: -100, lbp: 0 });
  });

  it("LBP→USD paid as USD cash + an LBP account line: the credit is in LBP, not USD", () => {
    create({
      ...US1_BASE,
      clientId: CLIENT_ID,
      customerPayments: [
        { method: "CASH", currencyCode: "LBP", amount: 89_500_000 },
      ],
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 900 },
        {
          method: "CUSTOMER_ACCOUNT",
          currencyCode: "LBP",
          amount: 8_950_000,
        },
      ],
      tender_exchange_rate: 89_500,
    });
    expect(account("CREDIT_DEPOSIT")).toEqual({ usd: 0, lbp: -8_950_000 });
  });

  it("an account payout without a client is refused, nothing written", () => {
    const before = snapshot(db);
    expect(() =>
      create({
        ...USD_EUR,
        payments: [
          { method: "CUSTOMER_ACCOUNT", currencyCode: "EUR", amount: 100 },
        ],
        payout_account_usd_rate: 1.1,
      }),
    ).toThrow(/client/i);
    expect(delta(before, snapshot(db))).toEqual(delta(before, before));
  });

  it("an EUR account payout without the rate is refused", () => {
    expect(() =>
      create({
        ...USD_EUR,
        clientId: CLIENT_ID,
        payments: [
          { method: "CUSTOMER_ACCOUNT", currencyCode: "EUR", amount: 100 },
        ],
      }),
    ).toThrow(/rate/i);
  });

  it("void of the split nets drawers, the account, the position and profit to 0", () => {
    const before = snapshot(db);
    const pos = eurPosition();
    const { id } = create({
      ...USD_EUR,
      clientId: CLIENT_ID,
      payments: [
        { method: "CASH", currencyCode: "EUR", amount: 60 },
        { method: "CUSTOMER_ACCOUNT", currencyCode: "EUR", amount: 40 },
      ],
      payout_account_usd_rate: 1.08,
    });
    getTransactionRepository().voidTransaction(unifiedExchangeTxnId(db, id), 1);
    expect(delta(before, snapshot(db))).toEqual(delta(before, before));
    expect(r2(eurPosition() - pos)).toBe(0);
  });

  it("refund of an all-account payout nets the account and profit to 0", () => {
    const before = snapshot(db);
    const { id } = create({
      ...USD_EUR,
      clientId: CLIENT_ID,
      payments: [
        { method: "CUSTOMER_ACCOUNT", currencyCode: "EUR", amount: 100 },
      ],
      payout_account_usd_rate: 1.1,
    });
    getTransactionRepository().refundTransaction(
      unifiedExchangeTxnId(db, id),
      1,
    );
    const d = delta(before, snapshot(db));
    expect(d.balanceUsd).toBe(0);
    expect(d.generalUsd).toBe(0);
    expect(d.profitUsd).toBeCloseTo(0, 6);
  });
});

describe("US3 — IN from the customer's account in EUR", () => {
  it("EUR→USD, 100 EUR on account at 1.05: owes $105, EUR drawer and position unchanged", () => {
    const before = snapshot(db);
    const pos = eurPosition();
    const { id } = create({
      ...EUR_USD,
      clientId: CLIENT_ID,
      customerPayments: [
        { method: "CUSTOMER_ACCOUNT", currencyCode: "EUR", amount: 100 },
      ],
      customer_account_usd_rate: 1.05,
    });
    const d = delta(before, snapshot(db));
    expect(d.generalEur).toBe(0);
    expect(d.generalUsd).toBe(-105);
    expect(d.debtUsd).toBe(105);
    expect(r2(eurPosition() - pos)).toBe(0);
    expect(notesOf("Exchange Debt")[0]).toMatch(/100.*EUR @ 1\.05.*105/);
    expect(detailsOf(id).accountConversion).toEqual([
      { side: "customer", currency: "EUR", amount: 100, rate: 1.05, usd: 105 },
    ]);
  });

  it("60 EUR cash + 40 EUR on account: EUR +60, position +60, owes $42", () => {
    const before = snapshot(db);
    const pos = eurPosition();
    create({
      ...EUR_USD,
      clientId: CLIENT_ID,
      customerPayments: [
        { method: "CASH", currencyCode: "EUR", amount: 60 },
        { method: "CUSTOMER_ACCOUNT", currencyCode: "EUR", amount: 40 },
      ],
      customer_account_usd_rate: 1.05,
    });
    const d = delta(before, snapshot(db));
    expect(d.generalEur).toBe(60);
    expect(r2(eurPosition() - pos)).toBe(60);
    expect(d.debtUsd).toBe(42);
  });

  it("an EUR account line without the rate is refused", () => {
    expect(() =>
      create({
        ...EUR_USD,
        clientId: CLIENT_ID,
        customerPayments: [
          { method: "CUSTOMER_ACCOUNT", currencyCode: "EUR", amount: 100 },
        ],
      }),
    ).toThrow(/rate/i);
  });

  it("a forgiven EUR leftover is still refused", () => {
    expect(() =>
      create({
        ...EUR_USD,
        clientId: CLIENT_ID,
        customerPayments: [{ method: "CASH", currencyCode: "EUR", amount: 99 }],
        customer_waived_amount: 1,
      }),
    ).toThrow();
  });

  it("void nets drawers, the debt, the position and profit to 0", () => {
    const before = snapshot(db);
    const pos = eurPosition();
    const { id } = create({
      ...EUR_USD,
      clientId: CLIENT_ID,
      customerPayments: [
        { method: "CASH", currencyCode: "EUR", amount: 60 },
        { method: "CUSTOMER_ACCOUNT", currencyCode: "EUR", amount: 40 },
      ],
      customer_account_usd_rate: 1.05,
    });
    getTransactionRepository().voidTransaction(unifiedExchangeTxnId(db, id), 1);
    expect(delta(before, snapshot(db))).toEqual(delta(before, before));
    expect(r2(eurPosition() - pos)).toBe(0);
  });
});
