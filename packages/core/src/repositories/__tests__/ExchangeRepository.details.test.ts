/**
 * LIRA-329 T028 — an exchange keeps everything the cashier entered on its
 * own transaction: the pair, the amounts, every leg's executed rate, market
 * rate, "rate overridden" flag and booked profit, the payout rate the sheet
 * converted at, the partner (by id and mode), the client's name and phone,
 * and how the money moved (customer-pays lines, payout lines, kept change).
 * The Exchange screen has no note field — the note it sends is its own
 * generated label, so it is NOT copied into the details (never a made-up
 * value).
 *
 * Money is asserted FIRST at today's values (FR-008) as ledger deltas
 * (rule 15). Expected details go through the kind's own schema (rule 24).
 * Rule 17: run before the builder existed and seen failing.
 *
 * Real schema: create_db.sql + migrations (exchangeCustomerPaysDb fixture).
 */
import type Database from "better-sqlite3";
import {
  ExchangeRepository,
  type CreateExchangeData,
} from "../ExchangeRepository";
import {
  PARTNER_ID,
  US1_MARGIN,
  US1_PART_ON_ACCOUNT,
  delta,
  setupExchangeDb,
  snapshot,
  teardownExchangeDb,
  unifiedExchangeTxnId,
} from "../testHelpers/exchangeCustomerPaysDb";
import {
  exchangeDetailsSchema,
  paymentSnapshotSchema,
} from "../../validators/transactionDetails";
import { expectEverySnapshotMatchesPayments } from "../testHelpers/paymentSnapshotAssert";

let db: Database.Database;

beforeEach(() => {
  db = setupExchangeDb();
});
// LIRA-329 T036 — every payment snapshot saved by a case above equals
// the payments rows it booked (method, currency, amount, direction).
afterEach(() => {
  // The on-account share books a debt row, not a payments row.
  expectEverySnapshotMatchesPayments(db, {
    unbookedMethods: ["CUSTOMER_ACCOUNT"],
  });
});

afterEach(() => teardownExchangeDb(db));

/** The fields this phase adds to the payload (typed loosely so the test
 *  runs against the unchanged `CreateExchangeData` — rule 17). */
type WithDetails = CreateExchangeData & {
  leg1RateOverridden?: boolean;
  leg2RateOverridden?: boolean;
  clientPhone?: string;
};

const create = (data: WithDetails) =>
  new ExchangeRepository().createTransaction(data);

interface TxnRow {
  id: number;
  amount_usd: number;
  amount_lbp: number;
  profit_usd: number;
  client_name: string | null;
  client_phone: string | null;
  metadata_json: string;
}

function txnFor(exchangeId: number): TxnRow {
  const id = unifiedExchangeTxnId(db, exchangeId);
  return db
    .prepare(
      `SELECT id, amount_usd, amount_lbp, profit_usd, client_name, client_phone,
              metadata_json
         FROM transactions WHERE id = ?`,
    )
    .get(id) as TxnRow;
}

function meta(row: TxnRow): Record<string, unknown> {
  return JSON.parse(row.metadata_json) as Record<string, unknown>;
}

function expectDetails(row: TxnRow, expected: Record<string, unknown>): void {
  expect(exchangeDetailsSchema.parse(expected)).toEqual(expected);
  expect(meta(row).details).toEqual(expected);
}

/** The drawer-posting `payments` rows of a transaction, as snapshot lines
 *  (method, currency, absolute amount). */
function paymentRows(
  txnId: number,
): Array<{ method: string; currency: string; amount: number }> {
  return (
    db
      .prepare(
        `SELECT method, currency_code, amount FROM payments WHERE transaction_id = ? ORDER BY id`,
      )
      .all(txnId) as Array<{
      method: string;
      currency_code: string;
      amount: number;
    }>
  ).map((p) => ({
    method: p.method,
    currency: p.currency_code,
    amount: Math.abs(p.amount),
  }));
}

/** Every drawer line of the snapshot is a real `payments` row. */
function expectSnapshotMatchesPayments(row: TxnRow): void {
  const snap = paymentSnapshotSchema.parse(meta(row).payment_snapshot);
  const rows = paymentRows(row.id);
  for (const line of snap.lines.filter(
    (l) => l.method !== "CUSTOMER_ACCOUNT",
  )) {
    expect(rows).toContainEqual({
      method: line.method,
      currency: line.currency,
      amount: line.amount,
    });
  }
}

describe("LIRA-329 — ExchangeRepository: exchange details", () => {
  it("a walk-in USD → LBP split payout keeps the leg, the override flag, the payout rate, kept change and client; the generated note is not copied", () => {
    const before = snapshot(db);
    const { id } = create({
      fromCurrency: "USD",
      toCurrency: "LBP",
      amountIn: 100,
      amountOut: 8_950_000,
      leg1Rate: 89_500,
      leg1MarketRate: 89_000,
      leg1ProfitUsd: 0.5,
      totalProfitUsd: 0.5,
      leg1RateOverridden: true,
      clientName: "Rami Nasr",
      clientPhone: "70444555",
      note: "Exchange USD → LBP",
      payments: [{ method: "CASH", currencyCode: "LBP", amount: 8_900_000 }],
      tender_exchange_rate: 89_500,
      kept_change_lbp: 50_000,
    });
    const d = delta(before, snapshot(db));
    const row = txnFor(id);

    // FR-008 — today's money (asserted first; passed on the pre-change run).
    expect(d.generalUsd).toBe(100);
    expect(d.generalLbp).toBe(-8_900_000);
    expect(row.amount_usd).toBe(100);
    expect(row.profit_usd).toBeCloseTo(0.5 + 50_000 / 89_500, 6);

    expect(row.client_name).toBe("Rami Nasr");
    expect(row.client_phone).toBe("70444555");
    expectDetails(row, {
      v: 1,
      kind: "exchange",
      from: "USD",
      to: "LBP",
      amountIn: 100,
      amountOut: 8_950_000,
      legs: [
        { rate: 89_500, marketRate: 89_000, overridden: true, profitUsd: 0.5 },
      ],
      payoutRate: 89_500,
    });
    expect(paymentSnapshotSchema.parse(meta(row).payment_snapshot)).toEqual({
      lines: [
        {
          method: "CASH",
          currency: "LBP",
          amount: 8_900_000,
          direction: "OUT",
        },
        {
          method: "CASH",
          currency: "USD",
          amount: 100,
          direction: "IN",
          note: "customer pays",
        },
      ],
      kept: { lbp: 50_000 },
    });
    expectSnapshotMatchesPayments(row);
  });

  it("customer pays part now, part on the account: the customer's lines and the payout lump are kept; the picked client's name and phone fill in", () => {
    const before = snapshot(db);
    const { id } = create({
      ...US1_PART_ON_ACCOUNT,
      leg1RateOverridden: false,
    });
    const d = delta(before, snapshot(db));
    const row = txnFor(id);

    expect(d.generalLbp).toBe(87_600_000);
    expect(d.generalUsd).toBe(-1_000);
    expect(d.debtLbp).toBe(1_900_000);

    expect(row.client_name).toBe("Exchange Client");
    expect(row.client_phone).toBe("70123456");
    expectDetails(row, {
      v: 1,
      kind: "exchange",
      from: "LBP",
      to: "USD",
      amountIn: 89_500_000,
      amountOut: 1_000,
      legs: [
        {
          rate: 89_500,
          marketRate: 89_000,
          overridden: false,
          profitUsd: US1_MARGIN,
        },
      ],
    });
    expect(paymentSnapshotSchema.parse(meta(row).payment_snapshot)).toEqual({
      lines: [
        { method: "CASH", currency: "USD", amount: 1_000, direction: "OUT" },
        {
          method: "CASH",
          currency: "LBP",
          amount: 87_600_000,
          direction: "IN",
          note: "customer pays",
        },
        {
          method: "CUSTOMER_ACCOUNT",
          currency: "LBP",
          amount: 1_900_000,
          direction: "IN",
          note: "customer pays",
        },
      ],
    });
    expectSnapshotMatchesPayments(row);
  });

  it("a For-Partner exchange keeps the partner by id and mode, never a walk-in phone, and only the payout line", () => {
    const before = snapshot(db);
    const { id } = create({
      fromCurrency: "USD",
      toCurrency: "LBP",
      amountIn: 100,
      amountOut: 8_950_000,
      leg1Rate: 89_500,
      leg1MarketRate: 89_000,
      leg1ProfitUsd: 0.5,
      totalProfitUsd: 0.5,
      partnerId: PARTNER_ID,
      partnerMode: "FOR",
      clientName: "Someone",
      clientPhone: "70999999",
    });
    const d = delta(before, snapshot(db));
    const row = txnFor(id);

    expect(d.generalUsd).toBe(0);
    expect(d.generalLbp).toBe(-8_950_000);
    expect(row.profit_usd).toBeCloseTo(0.5, 6);

    expect(row.client_name).toBe("Partner P [partner]");
    expect(row.client_phone).toBeNull();
    expectDetails(row, {
      v: 1,
      kind: "exchange",
      from: "USD",
      to: "LBP",
      amountIn: 100,
      amountOut: 8_950_000,
      legs: [{ rate: 89_500, marketRate: 89_000, profitUsd: 0.5 }],
      partner: { id: PARTNER_ID, name: "Partner P", mode: "FOR" },
    });
    expect(paymentSnapshotSchema.parse(meta(row).payment_snapshot)).toEqual({
      lines: [
        {
          method: "CASH",
          currency: "LBP",
          amount: 8_950_000,
          direction: "OUT",
        },
      ],
    });
    expectSnapshotMatchesPayments(row);
  });

  it("a lot-tracked EUR buy keeps the leg profit as booked (the acquire leg books 0), not the one the screen sent", () => {
    const before = snapshot(db);
    const { id } = create({
      fromCurrency: "EUR",
      toCurrency: "USD",
      amountIn: 100,
      amountOut: 116,
      leg1Rate: 1.16,
      leg1MarketRate: 1.18,
      leg1ProfitUsd: 2,
      totalProfitUsd: 2,
    });
    const d = delta(before, snapshot(db));
    const row = txnFor(id);
    const booked = db
      .prepare(`SELECT leg1_profit_usd FROM exchange_transactions WHERE id = ?`)
      .get(id) as { leg1_profit_usd: number };

    expect(d.generalEur).toBe(100);
    expect(d.generalUsd).toBe(-116);
    expect(booked.leg1_profit_usd).toBe(0);

    expectDetails(row, {
      v: 1,
      kind: "exchange",
      from: "EUR",
      to: "USD",
      amountIn: 100,
      amountOut: 116,
      legs: [{ rate: 1.16, marketRate: 1.18, profitUsd: 0 }],
    });
  });

  it("a cross exchange keeps both legs and the via currency", () => {
    const { id } = create({
      fromCurrency: "EUR",
      toCurrency: "LBP",
      amountIn: 100,
      amountOut: 10_324_000,
      leg1Rate: 1.16,
      leg1MarketRate: 1.18,
      leg1ProfitUsd: 2,
      leg2Rate: 89_000,
      leg2MarketRate: 89_500,
      leg2ProfitUsd: 0.65,
      viaCurrency: "USD",
      totalProfitUsd: 2.65,
      leg1RateOverridden: false,
      leg2RateOverridden: true,
    });
    const row = txnFor(id);
    const booked = db
      .prepare(
        `SELECT leg1_profit_usd, leg2_profit_usd FROM exchange_transactions WHERE id = ?`,
      )
      .get(id) as { leg1_profit_usd: number; leg2_profit_usd: number };

    expectDetails(row, {
      v: 1,
      kind: "exchange",
      from: "EUR",
      to: "LBP",
      via: "USD",
      amountIn: 100,
      amountOut: 10_324_000,
      legs: [
        {
          rate: 1.16,
          marketRate: 1.18,
          overridden: false,
          profitUsd: booked.leg1_profit_usd,
        },
        {
          rate: 89_000,
          marketRate: 89_500,
          overridden: true,
          profitUsd: booked.leg2_profit_usd,
        },
      ],
    });
  });
});
