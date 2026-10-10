/**
 * LIRA-296 (T021, rule 22) — ONE builder for a sale's item lines, used by
 * every POS path that sends a sale (draft autosave, Save Draft, Complete).
 * The per-line warranty edit made at the till travels as `warranty_months`
 * only when the cashier actually edited the line; otherwise the server
 * resolves the default (product, else category).
 */
import type { CartItem } from "@liratek/ui";
import { toSaleItems } from "../saleItems";

const line = (over: Partial<CartItem> = {}): CartItem => ({
  id: 7,
  name: "Charger",
  barcode: "C-1",
  category: "Accessories",
  quantity: 2,
  retail_price: 12.5,
  cost_price: 5,
  ...over,
});

describe("toSaleItems", () => {
  it("maps a plain line", () => {
    expect(toSaleItems([line()])).toEqual([
      { product_id: 7, quantity: 2, price: 12.5, imei: "" },
    ]);
  });

  it("carries the picked unit and its IMEI", () => {
    expect(
      toSaleItems([line({ quantity: 1, product_unit_id: 9, imei: "3567" })]),
    ).toEqual([
      { product_id: 7, quantity: 1, price: 12.5, imei: "3567", product_unit_id: 9 },
    ]);
  });

  it("sends warranty_months only for a line edited at the till (0 included)", () => {
    expect(toSaleItems([line({ warranty_months_edit: 6 })])[0]).toHaveProperty(
      "warranty_months",
      6,
    );
    expect(toSaleItems([line({ warranty_months_edit: 0 })])[0]).toHaveProperty(
      "warranty_months",
      0,
    );
    expect(toSaleItems([line({ warranty_months: 3 })])[0]).not.toHaveProperty(
      "warranty_months",
    );
    expect(
      toSaleItems([line({ warranty_months_edit: null })])[0],
    ).not.toHaveProperty("warranty_months");
  });
});
