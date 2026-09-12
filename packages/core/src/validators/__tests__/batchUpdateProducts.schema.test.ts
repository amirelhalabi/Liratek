/**
 * batchUpdateProductsSchema — `unit` field (TRANSPORT_PARITY_AUDIT_PLAN.md
 * §6.4 item 3, inventory half).
 *
 * `electron-app/schemas/index.ts`'s `BatchUpdateSchema` now re-exports this
 * schema directly instead of hand-maintaining a parallel local copy (rule
 * 14), so this is the ONE place both `inventory:batch-update` (IPC) and
 * `POST /api/inventory/products/batch-update` (REST) validate against.
 */

import { batchUpdateProductsSchema } from "../product";

describe("batchUpdateProductsSchema", () => {
  it("accepts a unit-only payload alongside required ids", () => {
    const input = { ids: [1, 2], unit: "box" };
    expect(batchUpdateProductsSchema.parse(input)).toEqual(input);
  });

  it("accepts `unit: null` (explicit clear), same as `supplier`", () => {
    const input = { ids: [1], unit: null };
    expect(batchUpdateProductsSchema.parse(input)).toEqual(input);
  });

  it("accepts an omitted `unit`", () => {
    const input = { ids: [1], category: "Phones" };
    expect(batchUpdateProductsSchema.parse(input)).toEqual(input);
  });

  it("rejects a unit longer than 50 characters", () => {
    const overlong = "x".repeat(51);
    expect(
      batchUpdateProductsSchema.safeParse({ ids: [1], unit: overlong }).success,
    ).toBe(false);
  });

  it("still rejects an empty ids array even with a valid unit", () => {
    expect(
      batchUpdateProductsSchema.safeParse({ ids: [], unit: "box" }).success,
    ).toBe(false);
  });

  it("still rejects a missing ids field", () => {
    expect(batchUpdateProductsSchema.safeParse({ unit: "box" }).success).toBe(
      false,
    );
  });
});
