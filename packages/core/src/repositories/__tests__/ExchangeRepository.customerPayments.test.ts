/**
 * LIRA-321 T015 — Exchange "Customer pays": the customer's money-in side can
 * be split, part of it put on the client's account (Exchange Debt) or a small
 * leftover forgiven. Payout legs are unchanged (FR-010).
 *
 * Real writer, real schema (create_db.sql + migrations). Every assertion is a
 * ledger DELTA (rule 15): General LBP/USD/EUR, the client's Exchange Debt,
 * and the profit stamp.
 *
 * Covers spec US1 scenarios 1, 2, 3, 4 and 5; client_id on both rows;
 * owing/forgiving refused when the customer pays in EUR (owner decision
 * 2026-10-14 — the lot would oversell), all-cash EUR still booked;
 * For-Partner refusal; a line in another
 * currency refused (offline replay bypasses the schema); and a payload
 * without `customerPayments` booking the single CASH lump exactly as today
 * (FR-018).
 */
import type Database from "better-sqlite3";
import {
  ExchangeRepository,
  type CreateExchangeData,
} from "../ExchangeRepository";
import { getTransactionRepository } from "../TransactionRepository";
import {
  CLIENT_ID,
  PARTNER_ID,
  US1_BASE,
  US1_FORGIVE,
  US1_MARGIN,
  US1_PART_ON_ACCOUNT,
  delta,
  setupExchangeDb,
  snapshot,
  teardownExchangeDb,
  unifiedExchangeTxnId,
} from "../testHelpers/exchangeCustomerPaysDb";

let db: Database.Database;

beforeEach(() => {
  db = setupExchangeDb();
});
afterEach(() => teardownExchangeDb(db));

const create = (data: CreateExchangeData) =>
  new ExchangeRepository().createTransaction(data);

interface PaymentRow {
  method: string;
  drawer_name: string;
  currency_code: string;
  amount: number;
}
function paymentsOf(txnId: number): PaymentRow[] {
  return db
    .prepare(
      `SELECT method, drawer_name, currency_code, amount FROM payments WHERE transaction_id = ? ORDER BY id`,
    )
    .all(txnId) as PaymentRow[];
}

describe("Exchange — customer pays part now, owes the rest (US1)", () => {
  it("US1.1: 87,600,000 cash + 1,900,000 on account → LBP +87.6M, USD −1,000, Exchange Debt +1,900,000 LBP", () => {
    const before = snapshot(db);
    const { id } = create(US1_PART_ON_ACCOUNT);
    const d = delta(before, snapshot(db));

    expect(d.generalLbp).toBe(87_600_000);
    expect(d.generalUsd).toBe(-1_000);
    expect(d.debtLbp).toBe(1_900_000);
    expect(d.debtUsd).toBe(0);

    const txnId = unifiedExchangeTxnId(db, id);
    const debt = db
      .prepare(
        `SELECT client_id, amount_usd, amount_lbp, transaction_id FROM debt_ledger WHERE transaction_type = 'Exchange Debt'`,
      )
      .all() as Array<{
      client_id: number;
      amount_usd: number;
      amount_lbp: number;
      transaction_id: number;
    }>;
    expect(debt).toEqual([
      {
        client_id: CLIENT_ID,
        amount_usd: 0,
        amount_lbp: 1_900_000,
        transaction_id: txnId,
      },
    ]);
  });

  it("US1.7 (stamp): owing does not change the exchange's profit stamp", () => {
    const before = snapshot(db);
    create(US1_PART_ON_ACCOUNT);
    const d = delta(before, snapshot(db));
    expect(d.profitUsd).toBeCloseTo(US1_MARGIN, 6);
    expect(d.profitLbp).toBe(0);
  });

  it("client_id is stored on exchange_transactions and on the unified transaction row (rule 11)", () => {
    const { id } = create(US1_PART_ON_ACCOUNT);
    const ex = db
      .prepare(`SELECT client_id FROM exchange_transactions WHERE id = ?`)
      .get(id) as { client_id: number | null };
    expect(ex.client_id).toBe(CLIENT_ID);
    const txn = getTransactionRepository().findById(
      unifiedExchangeTxnId(db, id),
    );
    expect(txn?.client_id).toBe(CLIENT_ID);
  });

  it("US1.2: paid in full (89,500,000 cash, no client) → LBP +89.5M, USD −1,000, no debt", () => {
    const before = snapshot(db);
    const full: CreateExchangeData = {
      ...US1_BASE,
      customerPayments: [
        { method: "CASH", currencyCode: "LBP", amount: 89_500_000 },
      ],
    };
    create(full);
    const d = delta(before, snapshot(db));
    expect(d.generalLbp).toBe(89_500_000);
    expect(d.generalUsd).toBe(-1_000);
    expect(d.debtLbp).toBe(0);
    expect(d.balanceLbp).toBe(0);
  });

  it("US1.3: 1,900,000 left unpaid with no client and no forgive → refused, nothing written", () => {
    const before = snapshot(db);
    const short: CreateExchangeData = {
      ...US1_BASE,
      customerPayments: [
        { method: "CASH", currencyCode: "LBP", amount: 87_600_000 },
      ],
    };
    expect(() => create(short)).toThrow(/less than the total/);
    expect(delta(before, snapshot(db))).toEqual(delta(before, before));
    const n = db
      .prepare(`SELECT COUNT(*) AS n FROM exchange_transactions`)
      .get() as { n: number };
    expect(n.n).toBe(0);
  });

  it("US1.3b: an account line with no client → refused", () => {
    const noClient: CreateExchangeData = {
      ...US1_PART_ON_ACCOUNT,
      clientId: undefined,
    };
    expect(() => create(noClient)).toThrow(/Choose a client/);
  });

  it("US1.4: 89,200,000 cash, 300,000 forgiven, no client → LBP +89.2M, USD −1,000, no debt, forgiven part recorded", () => {
    const before = snapshot(db);
    const { id } = create(US1_FORGIVE);
    const d = delta(before, snapshot(db));
    expect(d.generalLbp).toBe(89_200_000);
    expect(d.generalUsd).toBe(-1_000);
    expect(d.balanceLbp).toBe(0);
    // The forgiven part lowers profit, in its own currency (LIRA-310 shape).
    expect(d.profitLbp).toBe(-300_000);
    expect(d.profitUsd).toBeCloseTo(US1_MARGIN, 6);

    const waived = db
      .prepare(
        `SELECT amount_usd, amount_lbp, profit_usd, profit_lbp, source_table, source_id, metadata_json
           FROM transactions WHERE type = 'WAIVED_SHORTFALL'`,
      )
      .all() as Array<{
      amount_usd: number;
      amount_lbp: number;
      profit_usd: number;
      profit_lbp: number;
      source_table: string;
      source_id: number;
      metadata_json: string;
    }>;
    expect(waived).toHaveLength(1);
    expect(waived[0].amount_usd).toBe(0);
    expect(waived[0].amount_lbp).toBe(0);
    expect(waived[0].profit_lbp).toBe(-300_000);
    // Linked to the parent EXCHANGE transaction, never to the
    // exchange_transactions row (getBySourceId must keep finding the EXCHANGE).
    expect(waived[0].source_table).toBe("transactions");
    expect(waived[0].source_id).toBe(unifiedExchangeTxnId(db, id));
    // Rule 26: a row the system wrote as a side effect.
    expect(JSON.parse(waived[0].metadata_json).is_auto).toBe(true);
    expect(
      getTransactionRepository().getBySourceId("exchange_transactions", id)
        ?.type,
    ).toBe("EXCHANGE");
  });

  it("US1.4b: forgive above 450,000 LBP → refused", () => {
    const over: CreateExchangeData = {
      ...US1_BASE,
      customerPayments: [
        { method: "CASH", currencyCode: "LBP", amount: 89_000_000 },
      ],
      customer_waived_amount: 500_000,
    };
    expect(() => create(over)).toThrow(/above the limit/);
  });

  it("US1.5: nothing owed → saves without a client, exactly as today", () => {
    const full: CreateExchangeData = {
      ...US1_BASE,
      customerPayments: [
        { method: "CASH", currencyCode: "LBP", amount: 89_500_000 },
      ],
    };
    const { id } = create(full);
    const txnId = unifiedExchangeTxnId(db, id);
    expect(paymentsOf(txnId)).toEqual([
      { method: "CASH", drawer_name: "General", currency_code: "LBP", amount: 89_500_000 },
      { method: "CASH", drawer_name: "General", currency_code: "USD", amount: -1_000 },
    ]);
    expect(getTransactionRepository().findById(txnId)?.client_id).toBeNull();
  });

  it("a split IN side posts each drawer line to its own drawer (cash + Whish wallet)", () => {
    const before = snapshot(db);
    const split: CreateExchangeData = {
      ...US1_BASE,
      customerPayments: [
        { method: "CASH", currencyCode: "LBP", amount: 80_000_000 },
        { method: "WHISH", currencyCode: "LBP", amount: 9_500_000 },
      ],
    };
    const { id } = create(split);
    const d = delta(before, snapshot(db));
    expect(d.generalLbp).toBe(80_000_000);
    const inRows = paymentsOf(unifiedExchangeTxnId(db, id)).filter(
      (p) => p.amount > 0,
    );
    expect(inRows.map((p) => [p.method, p.currency_code, p.amount])).toEqual([
      ["CASH", "LBP", 80_000_000],
      ["WHISH", "LBP", 9_500_000],
    ]);
  });
});

describe("Exchange — owing/forgiving is refused when the customer pays in EUR (owner decision 2026-10-14)", () => {
  // The lot code records the full amountIn as bought while the drawer only
  // got what was paid (100 EUR lot vs 95 EUR in the drawer), so a later sale
  // would oversell. Blocked in the writer too: offline replay skips schemas.
  const BLOCKED =
    /Owing or forgiving isn't available yet when the customer pays in EUR/;
  const EUR_USD: CreateExchangeData = {
    fromCurrency: "EUR",
    toCurrency: "USD",
    amountIn: 100,
    amountOut: 116.12,
    leg1Rate: 1.1612,
    leg1MarketRate: 1.18,
    leg1ProfitUsd: 1.88,
    totalProfitUsd: 1.88,
  };

  it("EUR→USD: 95 EUR cash + 5 EUR on account is refused and nothing is booked", () => {
    const before = snapshot(db);
    expect(() =>
      create({
        ...EUR_USD,
        clientId: CLIENT_ID,
        customerPayments: [
          { method: "CASH", currencyCode: "EUR", amount: 95 },
          { method: "CUSTOMER_ACCOUNT", currencyCode: "EUR", amount: 5 },
        ],
      }),
    ).toThrow(BLOCKED);
    expect(delta(before, snapshot(db))).toEqual(delta(before, before));
  });

  it("EUR→LBP via USD: an account line is refused and nothing is booked", () => {
    const before = snapshot(db);
    expect(() =>
      create({
        fromCurrency: "EUR",
        toCurrency: "LBP",
        amountIn: 100,
        amountOut: 10_382_000, // 116 USD × 89,500
        leg1Rate: 1.16,
        leg1MarketRate: 1.18,
        leg1ProfitUsd: 2,
        leg2Rate: 89_500,
        leg2MarketRate: 89_500,
        leg2ProfitUsd: 0,
        viaCurrency: "USD",
        totalProfitUsd: 2,
        clientId: CLIENT_ID,
        customerPayments: [
          { method: "CASH", currencyCode: "EUR", amount: 95 },
          { method: "CUSTOMER_ACCOUNT", currencyCode: "EUR", amount: 5 },
        ],
      }),
    ).toThrow(BLOCKED);
    expect(delta(before, snapshot(db))).toEqual(delta(before, before));
  });

  it("EUR→USD: a forgiven 1 EUR is refused and nothing is booked", () => {
    const before = snapshot(db);
    expect(() =>
      create({
        ...EUR_USD,
        customerPayments: [{ method: "CASH", currencyCode: "EUR", amount: 99 }],
        customer_waived_amount: 1,
      }),
    ).toThrow(BLOCKED);
    expect(delta(before, snapshot(db))).toEqual(delta(before, before));
  });

  it("EUR→USD paid in full in cash is still booked (positive control)", () => {
    const before = snapshot(db);
    create({
      ...EUR_USD,
      customerPayments: [{ method: "CASH", currencyCode: "EUR", amount: 100 }],
    });
    const d = delta(before, snapshot(db));
    expect(d.generalEur).toBe(100);
    expect(d.generalUsd).toBeCloseTo(-116.12, 6);
    expect(d.debtUsd).toBe(0);
  });
});

describe("Exchange — customer pays guards", () => {
  it("a For-Partner exchange carrying customerPayments is refused", () => {
    const before = snapshot(db);
    const forPartner: CreateExchangeData = {
      ...US1_BASE,
      partnerId: PARTNER_ID,
      partnerMode: "FOR",
      customerPayments: [
        { method: "CASH", currencyCode: "LBP", amount: 89_500_000 },
      ],
    };
    expect(() => create(forPartner)).toThrow(/partner/i);
    expect(delta(before, snapshot(db))).toEqual(delta(before, before));
  });

  it("a line in a currency other than fromCurrency is refused (offline replay skips the schema)", () => {
    const mixed: CreateExchangeData = {
      ...US1_BASE,
      customerPayments: [
        { method: "CASH", currencyCode: "LBP", amount: 80_000_000 },
        { method: "CASH", currencyCode: "USD", amount: 106.15 },
      ],
    };
    expect(() => create(mixed)).toThrow(/currency/i);
  });

  it("FR-018: a payload WITHOUT customerPayments books the single CASH lump exactly as today", () => {
    const before = snapshot(db);
    const { id } = create(US1_BASE);
    const d = delta(before, snapshot(db));
    expect(d.generalLbp).toBe(89_500_000);
    expect(d.generalUsd).toBe(-1_000);
    expect(d.debtLbp).toBe(0);
    expect(paymentsOf(unifiedExchangeTxnId(db, id))).toEqual([
      { method: "CASH", drawer_name: "General", currency_code: "LBP", amount: 89_500_000 },
      { method: "CASH", drawer_name: "General", currency_code: "USD", amount: -1_000 },
    ]);
  });
});

describe("Exchange history — the picked client is projected (T025, FR-014)", () => {
  it("getHistory returns client_id and the client's name from clients", () => {
    create(US1_PART_ON_ACCOUNT);
    create(US1_BASE);
    const rows = new ExchangeRepository().getHistory(null);
    const withClient = rows.find((r) => r.client_id === CLIENT_ID);
    expect(withClient).toBeDefined();
    expect(withClient?.client_full_name).toBe("Exchange Client");
    const without = rows.find((r) => r.client_id === null);
    expect(without).toBeDefined();
    expect(without?.client_full_name).toBeNull();
  });
});
