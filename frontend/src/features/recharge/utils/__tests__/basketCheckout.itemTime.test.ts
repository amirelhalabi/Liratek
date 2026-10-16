/**
 * Bug #4 (TRANSACTION_DETAIL_AUDIT §3) — iPick / Katsh / Whish App units
 * added to a customer session's basket keep the "Set custom time" picked on
 * the form, like the same units sold on their own. The session checkout
 * replays each unit through the financial-service schema, so the key is
 * checked against that schema (rule 24).
 */
import { createFinancialServiceSchema } from "@liratek/core";
import { withClient } from "../basketCheckout";
import type { BasketSubItem } from "../../types/basket";

const PICKED = "2026-10-14T09:30:00.000Z";

const unit: BasketSubItem = {
  provider: "iPick",
  serviceType: "SEND",
  amount: 10,
  cost: 8,
  currency: "USD",
  commission: 2,
};

describe("withClient — session sub-items carry the picked time", () => {
  it("every unit carries the time, under the key the schema keeps", () => {
    const [a, b] = withClient([unit, { ...unit, amount: 5 }], {
      clientId: 3,
      transactionTime: PICKED,
    });
    expect(a.transaction_time).toBe(PICKED);
    expect(b.transaction_time).toBe(PICKED);
    const parsed = createFinancialServiceSchema.parse({
      ...a,
      payments: [],
    }) as { transaction_time?: string };
    expect(parsed.transaction_time).toBe(PICKED);
  });

  it("no time picked: no key (the checkout's time, or now, applies)", () => {
    const [a] = withClient([unit], { clientId: 3 });
    expect("transaction_time" in a).toBe(false);
    expect(a.clientId).toBe(3);
  });
});
