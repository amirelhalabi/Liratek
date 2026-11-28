/**
 * LIRA-406 — variant table (rule 28d): every Whish App sale mode builds the
 * SAME per-unit Only Days fields for every card and every credit choice.
 *
 * Modes: walk-in unit (`onlyDaysUnitFields`, what the FinancialForm loop
 * spreads), session sub-item (`whishBatchSubItems`), one-payment basket entry
 * (`buildBasketCheckoutPayload`) and partner sale (`buildPartnerOrderPayload`).
 * Each payload is parsed STRICTLY through the core schema (rule 24).
 *
 * Not proven failing-first: written after the builders were changed; the
 * walk-in, session and partner builders each have their own guard test.
 */
import {
  createFinancialServiceSchema,
  rechargeBasketCheckoutSchema,
  rechargePartnerOrderSchema,
} from "@liratek/core";
import {
  buildBasketCheckoutPayload,
  buildPartnerOrderPayload,
  onlyDaysUnitFields,
  whishBatchSubItems,
} from "../basketCheckout";
import type { PricedLine, WhishCartLine } from "../../types/basket";

type Credit = "default" | "edited";

function cartLine(category: "alfa" | "mtc", credit: Credit): WhishCartLine {
  return {
    item: {
      id: category === "alfa" ? 31 : 41,
      key: `WHISH_APP/${category}/Prepaid/7.58`,
      provider: "WHISH_APP",
      category,
      subcategory: "Prepaid",
      label: "7.58",
      catalogCost: 765_007,
      catalogSellPrice: 800_000,
      sortOrder: 0,
      credits: 7.58,
      days_cost_lbp: 120_707,
    },
    quantity: 1,
    onlyDays: true,
    returnedCreditsUsd: credit === "edited" ? 5 : 7,
    returnedCreditsEdited: credit === "edited",
  };
}

function expected(category: "alfa" | "mtc", credit: Credit) {
  return {
    itemCategory: category,
    mobileServiceItemId: category === "alfa" ? 31 : 41,
    returnedCreditsUsd: credit === "edited" ? 5 : undefined,
  };
}

const strictUnit = createFinancialServiceSchema.strict();

function pick(u: Record<string, unknown>) {
  return {
    itemCategory: u.itemCategory,
    mobileServiceItemId: u.mobileServiceItemId,
    returnedCreditsUsd: u.returnedCreditsUsd,
  };
}

function pricedLine(line: WhishCartLine): PricedLine {
  const subItems = whishBatchSubItems(line, "SEND", "LBP", 250_000);
  return {
    key: line.item.key,
    provider: "WHISH_APP",
    label: line.item.label,
    currency: "LBP",
    amount: 250_000,
    cost: 765_007,
    commission: 0,
    subItems,
    sheetItem: {
      key: line.item.key,
      name: line.item.label,
      quantity: 1,
      unitPrice: 250_000,
      currency: "LBP",
    },
  };
}

const MODES: Record<string, (line: WhishCartLine) => Record<string, unknown>> =
  {
    "walk-in unit": (line) =>
      strictUnit.parse({
        provider: "WHISH_APP",
        serviceType: "SEND",
        amount: 250_000,
        cost: 765_007,
        currency: "LBP",
        commission: 0,
        itemCategory: line.item.category,
        ...onlyDaysUnitFields(line),
      }),
    "session sub-item": (line) =>
      strictUnit.parse({
        ...whishBatchSubItems(line, "SEND", "LBP", 250_000)[0],
        payments: [],
      }),
    "basket entry": (line) => {
      const payload = rechargeBasketCheckoutSchema.strict().parse(
        buildBasketCheckoutPayload({
          lines: [pricedLine(line)],
          discount: 0,
          payments: [
            { id: "L1", method: "CASH", currencyCode: "LBP", amount: 250_000 },
          ],
          returnLegs: [],
          paidByMethod: "CASH",
          exchangeRate: 89_500,
          keptChange: { usd: 0, lbp: 0 },
          extra: { usd: 0, lbp: 0 },
          client: { clientId: 12, clientName: "Rami", clientPhone: "03123456" },
          userId: 3,
        }),
      );
      const entry = payload.cartItems[0] as {
        formData: { items: Record<string, unknown>[] };
      };
      return strictUnit.parse({ ...entry.formData.items[0], payments: [] });
    },
    "partner sale": (line) =>
      rechargePartnerOrderSchema.strict().parse(
        buildPartnerOrderPayload({
          lines: [pricedLine(line)],
          partnerId: 7,
          userId: 3,
        }),
      ).sales[0] as Record<string, unknown>,
  };

describe("LIRA-406 Whish App Only Days — every mode sends the same per-unit fields", () => {
  const cases: Array<[string, "alfa" | "mtc", Credit]> = [];
  for (const mode of Object.keys(MODES)) {
    for (const category of ["alfa", "mtc"] as const) {
      for (const credit of ["default", "edited"] as const) {
        cases.push([mode, category, credit]);
      }
    }
  }

  it.each(cases)("%s — %s, %s credit", (mode, category, credit) => {
    const unit = MODES[mode]!(cartLine(category, credit));
    expect(pick(unit)).toEqual(expected(category, credit));
  });
});
