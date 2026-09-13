/**
 * partsMath — pure arithmetic split out of PartPicker.tsx (react-refresh
 * only-export-components lint fix) so it can be unit-tested independently
 * of the component tree.
 */
import { toPartsPayload, partsTotalUsd } from "../partsMath";
import type { PartLine } from "../PartPicker";

function line(overrides: Partial<PartLine> = {}): PartLine {
  return {
    product_id: 1,
    product_name: "Screen Assembly",
    quantity: 1,
    unit_price_usd: 10,
    ...overrides,
  };
}

describe("partsTotalUsd", () => {
  it("returns 0 for an empty list", () => {
    expect(partsTotalUsd([])).toBe(0);
  });

  it("returns quantity * unit_price_usd for a single line", () => {
    expect(partsTotalUsd([line({ quantity: 3, unit_price_usd: 12.5 })])).toBe(
      37.5,
    );
  });

  it("sums quantity * unit_price_usd across multiple lines", () => {
    const parts = [
      line({ product_id: 1, quantity: 2, unit_price_usd: 10 }),
      line({ product_id: 2, quantity: 1, unit_price_usd: 5.5 }),
      line({ product_id: 3, quantity: 4, unit_price_usd: 0 }),
    ];
    expect(partsTotalUsd(parts)).toBe(25.5);
  });
});

describe("toPartsPayload", () => {
  it("returns an empty array for an empty list", () => {
    expect(toPartsPayload([])).toEqual([]);
  });

  it("strips product_name and keeps id when present", () => {
    const parts = [
      line({ id: 7, product_id: 5, quantity: 2, unit_price_usd: 8 }),
    ];
    expect(toPartsPayload(parts)).toEqual([
      { id: 7, product_id: 5, quantity: 2, unit_price_usd: 8 },
    ]);
  });

  it("omits id entirely for a newly added line that has none", () => {
    const parts = [line({ product_id: 9, quantity: 1, unit_price_usd: 3 })];
    const [payload] = toPartsPayload(parts);
    expect(payload).not.toHaveProperty("id");
    expect(payload).toEqual({
      product_id: 9,
      quantity: 1,
      unit_price_usd: 3,
    });
  });
});
