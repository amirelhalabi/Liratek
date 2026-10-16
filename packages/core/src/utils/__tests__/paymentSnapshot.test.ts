/**
 * LIRA-329 T004 — `buildPaymentSnapshot`: the copy of a transaction's payment
 * lines kept in `metadata_json.payment_snapshot`.
 *
 * Rule 17: written against a stub that returned `undefined`, seen failing,
 * then implemented.
 */
import { buildPaymentSnapshot } from "../paymentSnapshot";
import { paymentSnapshotSchema } from "../../validators/transactionDetails";

describe("LIRA-329 buildPaymentSnapshot", () => {
  it("copies a two-currency split with change returned and change kept", () => {
    const snapshot = buildPaymentSnapshot({
      flow: "IN",
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 50 },
        { method: "WHISH", currencyCode: "LBP", amount: 900000 },
        {
          method: "CASH",
          currencyCode: "LBP",
          amount: 100000,
          direction: "OUT",
        },
      ],
      keptChange: { usd: 0.25, lbp: 0 },
    });

    expect(snapshot).toEqual({
      lines: [
        { method: "CASH", currency: "USD", amount: 50, direction: "IN" },
        { method: "WHISH", currency: "LBP", amount: 900000, direction: "IN" },
        { method: "CASH", currency: "LBP", amount: 100000, direction: "OUT" },
      ],
      change_returned: [{ method: "CASH", currency: "LBP", amount: 100000 }],
      kept: { usd: 0.25 },
    });
    expect(paymentSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("classifies with partitionLegs: a leg with no direction is IN, an explicit IN stays IN", () => {
    const snapshot = buildPaymentSnapshot({
      flow: "IN",
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 10, direction: "IN" },
        { method: "CASH", currencyCode: "USD", amount: 5 },
      ],
    });
    expect(snapshot?.lines.map((l) => l.direction)).toEqual(["IN", "IN"]);
    expect(snapshot?.change_returned).toBeUndefined();
  });

  it("reads the snake_case leg shape too (currency_code) and keeps amounts positive", () => {
    const snapshot = buildPaymentSnapshot({
      flow: "IN",
      payments: [{ method: "CASH", currency_code: "LBP", amount: -450000 }],
    });
    expect(snapshot?.lines).toEqual([
      { method: "CASH", currency: "LBP", amount: 450000, direction: "IN" },
    ]);
  });

  it("adds fee lines with a note, skips zero lines, and records a session id", () => {
    const snapshot = buildPaymentSnapshot({
      flow: "IN",
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 0 },
        { method: "CASH", currencyCode: "USD", amount: 100 },
      ],
      feePayments: [{ method: "OMT", currencyCode: "USD", amount: 2 }],
      sessionId: 7,
    });
    expect(snapshot).toEqual({
      lines: [
        { method: "CASH", currency: "USD", amount: 100, direction: "IN" },
        {
          method: "OMT",
          currency: "USD",
          amount: 2,
          direction: "IN",
          note: "fee",
        },
      ],
      session_id: 7,
    });
  });

  it("returns undefined when there is nothing to record", () => {
    expect(buildPaymentSnapshot({})).toBeUndefined();
    expect(
      buildPaymentSnapshot({
        flow: "IN",
        payments: [],
        keptChange: { usd: 0, lbp: 0 },
      }),
    ).toBeUndefined();
  });
});
