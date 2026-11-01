/**
 * LIRA-365 US2 (T019) — the Discount typed in the "Customer pays" box
 * (formerly "Forgive") travels as `customer_waived_amount` and is booked as
 * a WAIVED_SHORTFALL sibling, as before. The transaction's details now also
 * record it as `details.discount`, like every other discounted form
 * (FR-007), so the details panel shows it.
 *
 *   - Exchange: from `customer_waived_amount`, in `fromCurrency`.
 *   - Whish App / OMT App / Binance cash-out: from `customer_waived_amount`
 *     when no fee discount was typed (owner 2026-11-01: on a walk-in
 *     cash-out the fee Discount is hidden while the Customer pays box is
 *     shown, so only one of them is ever sent).
 *
 * Money is asserted first, as ledger deltas (rule 15). Expected details go
 * through the kind's own schema (rule 24). Rule 17: seen failing on the
 * details part before the builders wrote it.
 */
import type Database from "better-sqlite3";
import { ExchangeRepository } from "../ExchangeRepository";
import {
  buildCryptoTransferDetails,
  buildWalletTransferDetails,
  type CreateFinancialServiceData,
} from "../FinancialServiceRepository";
import {
  US1_FORGIVE,
  US1_MARGIN,
  delta,
  setupExchangeDb,
  snapshot,
  teardownExchangeDb,
  unifiedExchangeTxnId,
} from "../testHelpers/exchangeCustomerPaysDb";
import {
  cryptoTransferDetailsSchema,
  exchangeDetailsSchema,
  walletTransferDetailsSchema,
} from "../../validators/transactionDetails";

describe("LIRA-365 US2 — Exchange discount in the Customer pays box", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = setupExchangeDb();
  });
  afterEach(() => teardownExchangeDb(db));

  it("books 300,000 LBP as WAIVED_SHORTFALL and records details.discount", () => {
    const before = snapshot(db);
    const { id } = new ExchangeRepository().createTransaction(US1_FORGIVE);
    const d = delta(before, snapshot(db));
    // Money unchanged from the Forgive booking (US1.4).
    expect(d.generalLbp).toBe(89_200_000);
    expect(d.generalUsd).toBe(-1_000);
    expect(d.profitLbp).toBe(-300_000);
    expect(d.profitUsd).toBeCloseTo(US1_MARGIN, 6);

    const row = db
      .prepare(`SELECT metadata_json FROM transactions WHERE id = ?`)
      .get(unifiedExchangeTxnId(db, id)) as { metadata_json: string };
    const details = (
      JSON.parse(row.metadata_json) as { details: Record<string, unknown> }
    ).details;
    expect(exchangeDetailsSchema.parse(details)).toEqual(details);
    expect(details.discount).toEqual({ amount: 300_000, currency: "LBP" });
  });

  it("no discount → no details.discount", () => {
    const { customer_waived_amount: _omit, ...rest } = US1_FORGIVE;
    const { id } = new ExchangeRepository().createTransaction({
      ...rest,
      customerPayments: [
        { method: "CASH", currencyCode: "LBP", amount: 89_500_000 },
      ],
    });
    const row = db
      .prepare(`SELECT metadata_json FROM transactions WHERE id = ?`)
      .get(unifiedExchangeTxnId(db, id)) as { metadata_json: string };
    const details = (
      JSON.parse(row.metadata_json) as { details: Record<string, unknown> }
    ).details;
    expect(details).not.toHaveProperty("discount");
  });
});

describe("LIRA-365 US2 — cash-out details record the Customer pays discount", () => {
  const cashOut = (
    over: Partial<CreateFinancialServiceData>,
  ): CreateFinancialServiceData =>
    ({
      provider: "WHISH_APP",
      serviceType: "RECEIVE",
      amount: 200,
      currency: "USD",
      commission: 3,
      whishFee: 3,
      customerPayments: [
        { method: "WHISH_APP", currencyCode: "USD", amount: 200 },
        { method: "CASH", currencyCode: "USD", amount: 2 },
      ],
      customer_waived_amount: 1,
      ...over,
    }) as CreateFinancialServiceData;

  it("Whish App cash-out: details.discount = the waived $1", () => {
    const details = buildWalletTransferDetails(cashOut({}), {});
    expect(walletTransferDetailsSchema.parse(details)).toEqual(details);
    expect(details.discount).toEqual({ amount: 1, currency: "USD" });
  });

  it("Binance cash-out: details.discount = the waived $1", () => {
    const details = buildCryptoTransferDetails(
      cashOut({
        provider: "BINANCE",
        customerPayments: [
          { method: "BINANCE", currencyCode: "USDT", amount: 200 },
          { method: "CASH", currencyCode: "USD", amount: 2 },
        ],
      }),
      {},
    );
    expect(cryptoTransferDetailsSchema.parse(details)).toEqual(details);
    expect(details.discount).toEqual({ amount: 1, currency: "USD" });
  });

  it("a typed fee discount still wins (never both on one screen)", () => {
    const details = buildWalletTransferDetails(
      cashOut({ typedDiscount: { amount: 0.5, currency: "USD" } }),
      {},
    );
    expect(details.discount).toEqual({ amount: 0.5, currency: "USD" });
  });
});
