/**
 * productFormCreateSchema / productFormUpdateSchema (LIRA-297, rule 21) —
 * the product payload the frontend sends, validated by the desktop
 * `inventory:create-product` / `inventory:update-product` channels.
 *
 * Field names come from the schema's own `.shape` (rule 24), never hand-typed.
 */

import {
  productFormCreateSchema,
  productFormUpdateSchema,
  type CreateProductPayload,
} from "../product";

// zod 4's `.refine()` keeps the ZodObject (no ZodEffects wrapper), so the
// refined schemas still expose `.shape`.
function shapeKeys(schema: { shape: Record<string, unknown> }): string[] {
  return Object.keys(schema.shape).sort();
}

const VALID_CREATE: CreateProductPayload = {
  barcode: "1234567890",
  name: "USB cable",
  category: "Accessories",
  cost_price: 2,
  retail_price: 5,
  stock_quantity: 3,
  min_stock_level: 5,
  supplier: "Acme",
  warranty_months: 12,
  is_old_stock: true,
};

describe("productFormCreateSchema", () => {
  it("keeps every key the frontend sends (nothing silently stripped)", () => {
    const parsed = productFormCreateSchema.parse(VALID_CREATE);
    for (const key of Object.keys(VALID_CREATE)) {
      expect(parsed).toHaveProperty(key);
    }
    // Every key in the fixture is a real schema key.
    const keys = shapeKeys(productFormCreateSchema);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of Object.keys(VALID_CREATE)) {
      expect(keys).toContain(key);
    }
  });

  it("accepts a code-less product (barcode: null) — the CSV import sends that for a row with no code", () => {
    const r = productFormCreateSchema.safeParse({
      ...VALID_CREATE,
      barcode: null,
    });
    expect(r.success).toBe(true);
  });

  it("accepts a product with no barcode key at all", () => {
    const { barcode: _omit, ...rest } = VALID_CREATE;
    void _omit;
    expect(productFormCreateSchema.safeParse(rest).success).toBe(true);
  });

  it("refuses a selling price at or below cost, on retail_price", () => {
    const r = productFormCreateSchema.safeParse({
      ...VALID_CREATE,
      cost_price: 5,
      retail_price: 5,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].path).toEqual(["retail_price"]);
      expect(r.error.issues[0].message).toBe(
        "Selling price must be greater than cost price",
      );
    }
  });

  it("refuses an empty name", () => {
    expect(
      productFormCreateSchema.safeParse({ ...VALID_CREATE, name: "" }).success,
    ).toBe(false);
  });
});

describe("productFormUpdateSchema", () => {
  it("requires id", () => {
    expect(productFormUpdateSchema.safeParse(VALID_CREATE).success).toBe(false);
    expect(
      productFormUpdateSchema.safeParse({ ...VALID_CREATE, id: 7 }).success,
    ).toBe(true);
  });

  it("is the create shape plus id", () => {
    expect(shapeKeys(productFormUpdateSchema)).toEqual(
      [...shapeKeys(productFormCreateSchema), "id"].sort(),
    );
  });
});
