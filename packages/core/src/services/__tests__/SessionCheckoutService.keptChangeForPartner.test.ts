/**
 * G42 — owner decision 2026-10-07: a FOR-partner transaction refuses kept
 * change (exact amount required). A session basket can carry a FOR-partner
 * item (a custom service or a financial service with `partnerMode: "FOR"`
 * still books its partner ledger under deferPayment), so a basket holding
 * one refuses a kept claim.
 *
 * RULE 17: written before the FOR gate and run red first (see the task
 * report). Pure seams only — no database.
 */
import { basketHasForPartnerItem } from "../SessionCheckoutService";
import { resolveBasketKeptChange } from "../SessionPaymentService";

const ctx = {
  chargeTotalUsd: 100,
  chargeTotalLbp: 0,
  payoutTotalUsd: 0,
  payoutTotalLbp: 0,
};
const legs = [
  {
    method: "CASH",
    currencyCode: "USD",
    amount: 105,
    direction: "IN" as const,
  },
];

describe("G42 — FOR-partner baskets refuse kept change", () => {
  it("detects a FOR-partner item at the top level and inside a batch", () => {
    expect(
      basketHasForPartnerItem([{ formData: { partnerMode: "FOR" } }]),
    ).toBe(true);
    expect(
      basketHasForPartnerItem([
        {
          formData: {
            _batch: true,
            items: [{ partnerMode: "THROUGH" }, { partnerMode: "FOR" }],
          },
        },
      ]),
    ).toBe(true);
    expect(
      basketHasForPartnerItem([
        { formData: { partnerMode: "VIA" } },
        { formData: { partnerMode: "THROUGH" } },
        { formData: {} },
      ]),
    ).toBe(false);
  });

  it("refuses a kept claim when the basket holds a FOR-partner item", () => {
    expect(() =>
      resolveBasketKeptChange({
        legs,
        ctx,
        claimedKept: { usd: 5, lbp: 0 },
        exchangeRate: 90000,
        isForPartner: true,
      }),
    ).toThrow(/partner transaction cannot keep change/);
  });

  it("accepts the same claim on a basket without a FOR-partner item", () => {
    expect(
      resolveBasketKeptChange({
        legs,
        ctx,
        claimedKept: { usd: 5, lbp: 0 },
        exchangeRate: 90000,
        isForPartner: false,
      }),
    ).toEqual({ keptUsd: 5, keptLbp: 0 });
  });
});
