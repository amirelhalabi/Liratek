/**
 * LIRA-329 T019 / T022 — a Mobile Recharge basket discount is kept on each
 * unit's transaction: the share of the typed discount that unit was charged
 * less, in the basket's currency (`typedDiscount`). Each sub-item is a
 * financial-service payload, so the field must survive the shared
 * `createFinancialServiceSchema` (rule 23) — asserted by parsing through it
 * (rule 24).
 *
 * Rule 17: run against the unchanged spread first and seen failing (no
 * `typedDiscount` on any unit).
 */
import { createFinancialServiceSchema } from "@liratek/core";
import { buildBasketCheckoutPayload, spreadDiscount } from "../basketCheckout";
import type {
  BasketProvider,
  BasketSubItem,
  PricedLine,
} from "../../types/basket";

function sub(
  provider: BasketProvider,
  amount: number,
  cost: number,
): BasketSubItem {
  return {
    provider,
    serviceType: "SEND",
    amount,
    cost,
    currency: "LBP",
    commission: Math.max(0, amount - cost),
    itemKey: `${provider}/item/${amount}`,
    itemCategory: "Gaming",
    note: `${provider} item`,
  };
}

function line(provider: BasketProvider, subs: BasketSubItem[]): PricedLine {
  return {
    key: `${provider}-line`,
    provider,
    label: `${provider} x${subs.length}`,
    currency: "LBP",
    amount: subs.reduce((s, x) => s + x.amount, 0),
    cost: subs.reduce((s, x) => s + x.cost, 0),
    commission: subs.reduce((s, x) => s + x.commission, 0),
    subItems: subs,
    sheetItem: {
      key: `${provider}-line`,
      name: provider,
      quantity: subs.length,
      unitPrice: subs[0]!.amount,
      currency: "LBP",
    },
  };
}

describe("basket discount kept per unit (LIRA-329)", () => {
  it("each unit carries its own share; a unit with no share carries none", () => {
    const out = spreadDiscount(
      [
        sub("Katsh", 130_000, 100_000),
        sub("iPick", 110_000, 100_000),
        sub("Katsh", 50_000, 50_000),
      ],
      20_000,
    );
    const shares = [130_000, 110_000, 50_000].map((a, i) => a - out[i]!.amount);
    out.forEach((unit, i) => {
      const parsed = createFinancialServiceSchema.parse(unit);
      if (shares[i]! > 0) {
        expect(parsed.typedDiscount).toEqual({
          amount: shares[i],
          currency: "LBP",
        });
      } else {
        expect(parsed.typedDiscount).toBeUndefined();
      }
    });
  });

  it("the checkout payload's sub-items keep their share", () => {
    const payload = buildBasketCheckoutPayload({
      lines: [
        line("Katsh", [sub("Katsh", 500_000, 450_000)]),
        line("iPick", [sub("iPick", 900_000, 850_000)]),
      ],
      discount: 40_000,
      payments: [],
      returnLegs: [],
      paidByMethod: "CASH",
      client: {},
      userId: 1,
      newId: () => "id",
    });
    const subs = (
      payload.cartItems as Array<{ formData: { items: unknown[] } }>
    ).flatMap((e) => e.formData.items);
    const kept = subs.map(
      (s) => createFinancialServiceSchema.parse(s).typedDiscount?.amount ?? 0,
    );
    expect(kept.reduce((a, b) => a + b, 0)).toBe(40_000);
  });
});
