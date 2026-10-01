import { lineGrossMarginUsd } from "../saleMargin.js";

describe("lineGrossMarginUsd (LIRA-184)", () => {
  it("multiplies by quantity — 3 units at $10 costing $6 each is a $12 / 40% margin, not a $4 / 40%-of-one-unit margin", () => {
    const margin = lineGrossMarginUsd(10, 6, 3);
    expect(margin).toBe(12);
    const revenue = 10 * 3;
    expect(margin / revenue).toBeCloseTo(0.4, 10);
  });

  it("agrees with the naive per-unit view scaled by quantity (the two views LIRA-184 requires to agree)", () => {
    const perUnitMargin = lineGrossMarginUsd(10, 6, 1);
    const totalMargin = lineGrossMarginUsd(10, 6, 3);
    expect(totalMargin).toBe(perUnitMargin * 3);
  });

  it("is zero quantity-safe and sign-correct for a loss line", () => {
    expect(lineGrossMarginUsd(5, 5, 4)).toBe(0);
    expect(lineGrossMarginUsd(5, 8, 2)).toBe(-6);
  });
});
