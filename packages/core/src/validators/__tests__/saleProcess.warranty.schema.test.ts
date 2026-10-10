/**
 * LIRA-296 (T019) — `saleProcessSchema` keeps the per-line `warranty_months`
 * and the sale's `client_day`. Zod strips unknown keys silently (rule 23),
 * so without these keys the till edit and the shop's day would vanish on
 * BOTH transports with no error.
 */
import { saleProcessSchema } from "../sale.js";

const base = {
  client_id: null,
  items: [{ product_id: 1, quantity: 1, price: 10 }],
  total_amount: 10,
  discount: 0,
  final_amount: 10,
  payment_usd: 10,
  payment_lbp: 0,
  exchange_rate: 89500,
};

describe("saleProcessSchema — LIRA-296 keys", () => {
  it("keeps warranty_months on a line and client_day on the sale", () => {
    const parsed = saleProcessSchema.parse({
      ...base,
      client_day: "2026-10-10",
      items: [{ product_id: 1, quantity: 1, price: 10, warranty_months: 6 }],
    });
    expect(parsed.client_day).toBe("2026-10-10");
    expect(parsed.items[0]?.warranty_months).toBe(6);
  });

  it("accepts null and omitted warranty_months", () => {
    expect(
      saleProcessSchema.parse({
        ...base,
        items: [{ product_id: 1, quantity: 1, price: 10, warranty_months: null }],
      }).items[0]?.warranty_months,
    ).toBeNull();
    expect(saleProcessSchema.parse(base).items[0]).not.toHaveProperty(
      "warranty_months",
    );
  });

  it.each([-1, 61, 2.5])("rejects warranty_months %p", (v) => {
    expect(
      saleProcessSchema.safeParse({
        ...base,
        items: [{ product_id: 1, quantity: 1, price: 10, warranty_months: v }],
      }).success,
    ).toBe(false);
  });

  it("rejects a malformed client_day", () => {
    expect(
      saleProcessSchema.safeParse({ ...base, client_day: "10/10/2026" }).success,
    ).toBe(false);
  });
});
