import { getCartLineKey, generateCartLineId } from "../cartLineKey";
import type { CartItem } from "@liratek/ui";

function makeItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: 7,
    name: "Test",
    barcode: "123",
    category: "General",
    quantity: 1,
    retail_price: 10,
    cost_price: 5,
    ...overrides,
  };
}

describe("getCartLineKey", () => {
  it("falls back to String(id) when cartLineId is unset (every non-unit line)", () => {
    expect(getCartLineKey(makeItem())).toBe("7");
  });

  it("prefers cartLineId when present, even though id repeats", () => {
    const a = makeItem({ cartLineId: "unit-line-1" });
    const b = makeItem({ cartLineId: "unit-line-2" }); // same product id
    expect(getCartLineKey(a)).toBe("unit-line-1");
    expect(getCartLineKey(b)).toBe("unit-line-2");
    expect(getCartLineKey(a)).not.toBe(getCartLineKey(b));
  });
});

describe("generateCartLineId", () => {
  it("returns a distinct value on every call", () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateCartLineId()));
    expect(ids.size).toBe(20);
  });
});
