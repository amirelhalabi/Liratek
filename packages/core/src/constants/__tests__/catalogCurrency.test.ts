import { isLbpSellable, isUsdSellable } from "../catalogCurrency";

/**
 * LIRA-324 — which catalog items the Whish App Bills grid shows in each
 * currency. Written before the module (rule 17).
 */
const item = (over: Partial<Parameters<typeof isUsdSellable>[0]> = {}) => ({
  category: "Gaming",
  subcategory: "PlayStation LEB",
  cost_lbp: 897000,
  sell_lbp: 897000,
  cost_usd: 10 as number | null,
  sell_usd: 10 as number | null,
  ...over,
});

describe("isUsdSellable", () => {
  it("needs both a USD cost and a USD selling price above zero", () => {
    expect(isUsdSellable(item())).toBe(true);
    expect(isUsdSellable(item({ cost_usd: null }))).toBe(false);
    expect(isUsdSellable(item({ sell_usd: null }))).toBe(false);
    expect(isUsdSellable(item({ cost_usd: 0 }))).toBe(false);
    expect(isUsdSellable(item({ sell_usd: 0 }))).toBe(false);
  });

  it("never sells an MTC / Alfa Prepaid card in USD", () => {
    expect(
      isUsdSellable(item({ category: "mtc", subcategory: "Prepaid" })),
    ).toBe(false);
    expect(
      isUsdSellable(item({ category: "alfa", subcategory: "Prepaid" })),
    ).toBe(false);
    // other alfa / mtc groups are fine
    expect(
      isUsdSellable(item({ category: "alfa", subcategory: "Mobile Internet" })),
    ).toBe(true);
  });
});

describe("isLbpSellable", () => {
  it("hides only USD-only items (no LBP price, a USD price)", () => {
    expect(isLbpSellable(item({ cost_lbp: 0, sell_lbp: 0, cost_usd: 5 }))).toBe(
      false,
    );
  });

  it("keeps every item shown today, including a legacy item with no price at all", () => {
    expect(isLbpSellable(item())).toBe(true);
    expect(
      isLbpSellable(
        item({ cost_lbp: 0, sell_lbp: 0, cost_usd: null, sell_usd: null }),
      ),
    ).toBe(true);
    expect(
      isLbpSellable(item({ cost_lbp: 0, sell_lbp: 2890, cost_usd: 5 })),
    ).toBe(true);
  });
});
