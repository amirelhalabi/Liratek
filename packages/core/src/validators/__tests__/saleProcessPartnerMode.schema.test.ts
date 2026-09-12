/**
 * saleProcessSchema's partnerMode "FOR" vs CUSTOMER_ACCOUNT leg refine
 * (FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §3): under a for-partner sale
 * there is no customer owing — the PARTNER owes — so a CUSTOMER_ACCOUNT
 * payment leg is never valid. Mirrors `SalesRepository.processSale`'s
 * `assertNoCustomerAccountLeg` guard. Sales has no legacy payment-method
 * field (unlike Loto/Financial Services/Recharge), so this schema only
 * needs the one `payments[]` refine.
 *
 * Rule 17 (failing-first proof owed): confirmed to fail without the
 * refine — see the task report for the captured before/after output.
 */

import { describe, it, expect } from "@jest/globals";
import { saleProcessSchema } from "../sale.js";

const basePayload = {
  client_id: null,
  items: [
    {
      product_id: 1,
      quantity: 1,
      price: 10,
    },
  ],
  total_amount: 10,
  discount: 0,
  final_amount: 10,
  payment_usd: 0,
  payment_lbp: 0,
  exchange_rate: 90000,
};

describe("saleProcessSchema — partnerMode FOR vs CUSTOMER_ACCOUNT leg", () => {
  it("rejects a CUSTOMER_ACCOUNT IN leg under partnerMode FOR", () => {
    const result = saleProcessSchema.safeParse({
      ...basePayload,
      partnerMode: "FOR",
      partnerId: 7,
      payments: [
        { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 10 },
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
    const result = saleProcessSchema.safeParse({
      ...basePayload,
      partnerMode: "FOR",
      partnerId: 7,
      payments: [{ method: "CASH", currency_code: "USD", amount: 10 }],
    });

    expect(result.success).toBe(true);
  });

  it("accepts a CUSTOMER_ACCOUNT leg with no partnerMode (rule is conditional on FOR, not a blanket ban)", () => {
    const result = saleProcessSchema.safeParse({
      ...basePayload,
      payments: [
        { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 10 },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("accepts a CUSTOMER_ACCOUNT leg with direction: OUT under partnerMode FOR (change/return, not a counter payment)", () => {
    const result = saleProcessSchema.safeParse({
      ...basePayload,
      partnerMode: "FOR",
      partnerId: 7,
      payments: [
        {
          method: "CUSTOMER_ACCOUNT",
          currency_code: "USD",
          amount: -2,
          direction: "OUT",
        },
      ],
    });

    expect(result.success).toBe(true);
  });
});
