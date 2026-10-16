/**
 * Bug #4 (TRANSACTION_DETAIL_AUDIT §3) — a Binance send / cash-out added to a
 * customer session's basket keeps the "Set custom time" picked on the form,
 * exactly like the same send made on its own: both are built by ONE builder
 * (rule 22). Expected keys are checked against the shared schema (rule 24).
 */
import { createFinancialServiceSchema } from "@liratek/core";
import { buildCryptoServiceFields } from "../cryptoServiceFields";

const PICKED = "2026-10-14T09:30:00.000Z";

function build(transactionTime?: string) {
  return buildCryptoServiceFields({
    cryptoType: "SEND",
    amount: 100,
    commission: 2,
    clientId: 7,
    clientName: "Rana Aziz",
    reference: "wallet-1",
    detailFields: { feePaidBy: "SENDER" },
    transactionTime,
  });
}

describe("buildCryptoServiceFields — one Binance payload for both modes", () => {
  it("carries the picked time (the session basket item used to drop it)", () => {
    const fields = build(PICKED);
    expect(fields.transaction_time).toBe(PICKED);
    // The schema keeps it — never stripped on the way to the server.
    const parsed = createFinancialServiceSchema.parse({
      ...fields,
      payments: [],
    }) as { transaction_time?: string };
    expect(parsed.transaction_time).toBe(PICKED);
  });

  it("no time picked: the key is absent (booked now)", () => {
    expect("transaction_time" in build(undefined)).toBe(false);
  });

  it("keeps the other fields every Binance item carries", () => {
    expect(build(undefined)).toEqual({
      provider: "BINANCE",
      serviceType: "SEND",
      amount: 100,
      currency: "USDT",
      clientId: 7,
      clientName: "Rana Aziz",
      referenceNumber: "wallet-1",
      commission: 2,
      feePaidBy: "SENDER",
    });
  });
});
