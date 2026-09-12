/**
 * lotoSellSchema's partnerMode "FOR" vs CUSTOMER_ACCOUNT refines
 * (FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §3): under a for-partner ticket
 * there is no customer owing — the PARTNER owes — so CUSTOMER_ACCOUNT is
 * never a valid payment method, legacy field or structured leg. Mirrors
 * `LotoTicketRepository`'s `assertNoCounterPayment` guard (its
 * `hasLegacyCustomerAccount` / `hasCounterPaymentLeg` branches).
 *
 * Rule 17 (failing-first proof owed): each refine was confirmed to fail
 * without it — see the task report for the captured before/after output.
 */

import { describe, it, expect } from "@jest/globals";
import { lotoSellSchema } from "../loto.js";

const basePayload = {
  sale_amount: 500000,
};

describe("lotoSellSchema — partnerMode FOR vs CUSTOMER_ACCOUNT (legacy payment_method)", () => {
  it("rejects payment_method: CUSTOMER_ACCOUNT under partnerMode FOR", () => {
    const result = lotoSellSchema.safeParse({
      ...basePayload,
      partnerMode: "FOR",
      partnerId: 7,
      payment_method: "CUSTOMER_ACCOUNT",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join(".") === "payment_method",
      );
      expect(issue).toBeDefined();
    }
  });

  it("accepts a normal payment_method (CASH) under partnerMode FOR", () => {
    const result = lotoSellSchema.safeParse({
      ...basePayload,
      partnerMode: "FOR",
      partnerId: 7,
      payment_method: "CASH",
    });

    expect(result.success).toBe(true);
  });

  it("accepts payment_method: CUSTOMER_ACCOUNT when partnerMode is absent (rule is conditional on FOR, not a blanket ban)", () => {
    const result = lotoSellSchema.safeParse({
      ...basePayload,
      payment_method: "CUSTOMER_ACCOUNT",
    });

    expect(result.success).toBe(true);
  });
});

describe("lotoSellSchema — partnerMode FOR vs CUSTOMER_ACCOUNT (structured payments[] legs)", () => {
  it("rejects a CUSTOMER_ACCOUNT IN leg under partnerMode FOR", () => {
    const result = lotoSellSchema.safeParse({
      ...basePayload,
      partnerMode: "FOR",
      partnerId: 7,
      payments: [
        { method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: 500000 },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join(".") === "payments",
      );
      expect(issue).toBeDefined();
    }
  });

  it("accepts a normal CASH leg under partnerMode FOR", () => {
    const result = lotoSellSchema.safeParse({
      ...basePayload,
      partnerMode: "FOR",
      partnerId: 7,
      payments: [{ method: "CASH", currencyCode: "LBP", amount: 500000 }],
    });

    expect(result.success).toBe(true);
  });

  it("accepts a CUSTOMER_ACCOUNT leg with no partnerMode (rule is conditional on FOR, not a blanket ban)", () => {
    const result = lotoSellSchema.safeParse({
      ...basePayload,
      payments: [
        { method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: 500000 },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("accepts a CUSTOMER_ACCOUNT leg with direction: OUT under partnerMode FOR (change/return, not a counter payment)", () => {
    const result = lotoSellSchema.safeParse({
      ...basePayload,
      partnerMode: "FOR",
      partnerId: 7,
      payments: [
        {
          method: "CUSTOMER_ACCOUNT",
          currencyCode: "LBP",
          amount: -1000,
          direction: "OUT",
        },
      ],
    });

    expect(result.success).toBe(true);
  });
});
