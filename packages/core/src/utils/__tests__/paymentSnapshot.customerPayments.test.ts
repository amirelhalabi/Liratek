/**
 * LIRA-329 phase 4 — the payment snapshot of a wallet / crypto cash-out
 * keeps the "Customer pays" lines (what the customer handed over) next to
 * the payout lines, each marked "customer pays".
 *
 * NOT proven failing-first (rule 17): the `customerPayments` input was added
 * before this test.
 */
import { paymentSnapshotSchema } from "../../validators/transactionDetails";
import { buildPaymentSnapshot } from "../paymentSnapshot";

describe("buildPaymentSnapshot — customer-pays lines (LIRA-329)", () => {
  it("keeps the payout lines, then the customer's lines marked 'customer pays'", () => {
    const snapshot = buildPaymentSnapshot({
      flow: "PAYOUT",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 98 }],
      customerPayments: [
        { method: "BINANCE", currencyCode: "USDT", amount: 100 },
        { method: "CASH", currencyCode: "USD", amount: 2 },
      ],
    });
    expect(paymentSnapshotSchema.parse(snapshot)).toEqual({
      lines: [
        // Shop-day fix (Q1): the payout line is OUT — the cash left the
        // drawer (it read IN before the fix).
        { method: "CASH", currency: "USD", amount: 98, direction: "OUT" },
        {
          method: "BINANCE",
          currency: "USDT",
          amount: 100,
          direction: "IN",
          note: "customer pays",
        },
        {
          method: "CASH",
          currency: "USD",
          amount: 2,
          direction: "IN",
          note: "customer pays",
        },
      ],
    });
  });
});
