/**
 * batchUpdateProductsSchema — `unit` field (TRANSPORT_PARITY_AUDIT_PLAN.md
 * §6.4 item 3, inventory half).
 *
 * `electron-app/schemas/index.ts`'s `BatchUpdateSchema` now re-exports this
 * schema directly instead of hand-maintaining a parallel local copy (rule
 * 14), so this is the ONE place both `inventory:batch-update` (IPC) and
 * `POST /api/inventory/products/batch-update` (REST) validate against.
 *
 * Rule-17 note (discharged 2026-09-13): removed the `unit` line from
 * `batchUpdateProductsSchema` in `packages/core/src/validators/product.ts`.
 * Ran `npx jest --testPathPatterns "batchUpdateProducts.schema"` — 3 of 6
 * failed:
 *   "accepts a unit-only payload alongside required ids" — Zod stripped the
 *   unknown key, so `{ ids: [1, 2] }` came back with no `unit`:
 *     - Expected  - 1
 *     + Received  + 0
 *         Object {
 *           "ids": Array [1, 2],
 *     -     "unit": "box",
 *         }
 *   "accepts `unit: null` (explicit clear)…" failed the same way (`unit: null`
 *   stripped); "rejects a unit longer than 50 characters" failed with
 *   `Expected: false / Received: true` (nothing left to reject).
 * 3 failed, 3 passed, 6 total. Reverted from a pre-edit copy;
 * `git diff --stat -- packages/core/src/validators/product.ts` printed
 * nothing afterward.
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
