/**
 * Inventory product-list filter schemas.
 *
 * `productListQuerySchema` is the REST-side parser: everything reaching it
 * is a raw query-string value (`string`, `string[]` for repeated express
 * params, or absent). Two traps drive most of these cases:
 *
 *  - `''` — a cleared numeric input the browser still submits — must
 *    become "no bound", NEVER `0`. Coercing it to `0` would silently apply
 *    a real `>= 0` / `<= 0` filter and quietly change the result set.
 *  - the singular URL keys `category` / `supplier` must come out under the
 *    plural `categories` / `suppliers` names `ProductListFilters` uses, so
 *    the parsed query can be handed straight to the service.
 */

import {
  productListFiltersSchema,
  productListQuerySchema,
  type ProductListFilters,
  type ProductListQuery,
} from "../product";

describe("productListFiltersSchema", () => {
  it("accepts an empty object — every field is optional", () => {
    expect(productListFiltersSchema.parse({})).toEqual({});
  });

  it("accepts a fully populated filter set", () => {
    const input: ProductListFilters = {
      categories: ["Phones"],
      suppliers: ["Acme"],
      addedFrom: "2026-01-01",
      addedTo: "2026-12-31",
      costMin: 0,
      costMax: 100.5,
      retailMin: 1,
      retailMax: 200,
      profitPctMin: -50,
      profitPctMax: 150,
      stockMin: -5,
      stockMax: 99,
    };
    expect(productListFiltersSchema.parse(input)).toEqual(input);
  });

  it("rejects a date that is not YYYY-MM-DD", () => {
    expect(
      productListFiltersSchema.safeParse({ addedFrom: "01/02/2026" }).success,
    ).toBe(false);
    expect(
      productListFiltersSchema.safeParse({ addedTo: "2026-1-2" }).success,
    ).toBe(false);
  });

  it("rejects negative cost/retail bounds but allows negative profit% and stock", () => {
    expect(productListFiltersSchema.safeParse({ costMin: -1 }).success).toBe(
      false,
    );
    expect(productListFiltersSchema.safeParse({ retailMax: -1 }).success).toBe(
      false,
    );
    expect(
      productListFiltersSchema.safeParse({ profitPctMin: -100 }).success,
    ).toBe(true);
    expect(productListFiltersSchema.safeParse({ stockMin: -100 }).success).toBe(
      true,
    );
  });

  it("requires stock bounds to be integers", () => {
    expect(productListFiltersSchema.safeParse({ stockMin: 1.5 }).success).toBe(
      false,
    );
  });

  it("rejects empty strings inside the category/supplier arrays", () => {
    expect(
      productListFiltersSchema.safeParse({ categories: [""] }).success,
    ).toBe(false);
    expect(
      productListFiltersSchema.safeParse({ suppliers: [""] }).success,
    ).toBe(false);
  });

  it("caps the array filters at 100 entries", () => {
    const under = Array.from({ length: 100 }, (_, i) => `c${i}`);
    expect(
      productListFiltersSchema.safeParse({ categories: under }).success,
    ).toBe(true);
    expect(
      productListFiltersSchema.safeParse({ categories: [...under, "c100"] })
        .success,
    ).toBe(false);
  });

  it("does NOT reject an inverted range — that just returns an empty set", () => {
    expect(
      productListFiltersSchema.safeParse({ costMin: 100, costMax: 1 }).success,
    ).toBe(true);
    expect(
      productListFiltersSchema.safeParse({
        addedFrom: "2026-12-31",
        addedTo: "2026-01-01",
      }).success,
    ).toBe(true);
  });
});

describe("productListQuerySchema", () => {
  it("parses an empty query to an unfiltered request", () => {
    const parsed = productListQuerySchema.parse({});
    expect(parsed.categories).toBeUndefined();
    expect(parsed.suppliers).toBeUndefined();
    expect(parsed.search).toBeUndefined();
    expect(parsed.activeOnly).toBe(true);
  });

  describe("category / supplier — singular URL key, plural output key", () => {
    it("wraps a single occurrence into an array under the plural key", () => {
      const parsed = productListQuerySchema.parse({
        category: "Phones",
        supplier: "Acme",
      });
      expect(parsed.categories).toEqual(["Phones"]);
      expect(parsed.suppliers).toEqual(["Acme"]);
    });

    it("keeps a repeated param (?category=A&category=B) as an array", () => {
      const parsed = productListQuerySchema.parse({ category: ["A", "B"] });
      expect(parsed.categories).toEqual(["A", "B"]);
    });

    it("does not leak the singular input keys into the output", () => {
      const parsed = productListQuerySchema.parse({
        category: "A",
        supplier: "B",
      });
      expect(parsed).not.toHaveProperty("category");
      expect(parsed).not.toHaveProperty("supplier");
    });

    it("caps repeated params at 100 entries", () => {
      const over = Array.from({ length: 101 }, (_, i) => `c${i}`);
      expect(productListQuerySchema.safeParse({ category: over }).success).toBe(
        false,
      );
    });
  });

  describe("numeric params", () => {
    it("parses numeric strings", () => {
      const parsed = productListQuerySchema.parse({
        costMin: "0",
        costMax: "12.5",
        retailMin: "3",
        retailMax: "9",
        profitPctMin: "-20",
        profitPctMax: "150",
        stockMin: "-5",
        stockMax: "40",
      });
      expect(parsed).toMatchObject({
        costMin: 0,
        costMax: 12.5,
        retailMin: 3,
        retailMax: 9,
        profitPctMin: -20,
        profitPctMax: 150,
        stockMin: -5,
        stockMax: 40,
      });
    });

    it.each([
      "costMin",
      "costMax",
      "retailMin",
      "retailMax",
      "profitPctMin",
      "profitPctMax",
      "stockMin",
      "stockMax",
    ])("maps an empty '%s' to undefined, NEVER to 0", (key) => {
      const parsed = productListQuerySchema.parse({ [key]: "" }) as Record<
        string,
        unknown
      >;
      expect(parsed[key]).toBeUndefined();
      expect(parsed[key]).not.toBe(0);
    });

    it("rejects a non-numeric value instead of smuggling NaN into SQL", () => {
      const result = productListQuerySchema.safeParse({ costMin: "abc" });
      expect(result.success).toBe(false);
    });

    it("rejects an explicit NaN/Infinity spelling", () => {
      expect(productListQuerySchema.safeParse({ costMin: "NaN" }).success).toBe(
        false,
      );
      expect(
        productListQuerySchema.safeParse({ costMax: "Infinity" }).success,
      ).toBe(false);
    });

    it("keeps the filter-schema bounds (no negative cost, integer stock)", () => {
      expect(productListQuerySchema.safeParse({ costMin: "-1" }).success).toBe(
        false,
      );
      expect(
        productListQuerySchema.safeParse({ stockMin: "1.5" }).success,
      ).toBe(false);
      expect(
        productListQuerySchema.safeParse({ profitPctMin: "-1" }).success,
      ).toBe(true);
    });
  });

  describe("date params", () => {
    it("parses YYYY-MM-DD bounds", () => {
      const parsed = productListQuerySchema.parse({
        addedFrom: "2026-01-01",
        addedTo: "2026-02-01",
      });
      expect(parsed.addedFrom).toBe("2026-01-01");
      expect(parsed.addedTo).toBe("2026-02-01");
    });

    it("maps an empty date to undefined", () => {
      const parsed = productListQuerySchema.parse({
        addedFrom: "",
        addedTo: "",
      });
      expect(parsed.addedFrom).toBeUndefined();
      expect(parsed.addedTo).toBeUndefined();
    });

    it("rejects a malformed date", () => {
      expect(
        productListQuerySchema.safeParse({ addedFrom: "2026-13" }).success,
      ).toBe(false);
    });
  });

  describe("back-compat params the route ignores", () => {
    it("accepts barcode and activeOnly without failing validation", () => {
      const parsed = productListQuerySchema.parse({
        barcode: "12345",
        activeOnly: "true",
        search: "phone",
      });
      expect(parsed.barcode).toBe("12345");
      expect(parsed.search).toBe("phone");
      expect(parsed.activeOnly).toBe(true);
    });

    it("defaults activeOnly to true when absent", () => {
      expect(productListQuerySchema.parse({}).activeOnly).toBe(true);
    });

    it("decodes the string 'false' as false rather than truthy-coercing it", () => {
      expect(
        productListQuerySchema.parse({ activeOnly: "false" }).activeOnly,
      ).toBe(false);
      expect(productListQuerySchema.parse({ activeOnly: "0" }).activeOnly).toBe(
        false,
      );
    });

    it("strips unknown query params", () => {
      expect(productListQuerySchema.parse({ page: "2" })).not.toHaveProperty(
        "page",
      );
    });
  });

  it("produces output assignable to ProductListFilters", () => {
    const parsed: ProductListQuery = productListQuerySchema.parse({
      category: ["Phones", "Accessories"],
      supplier: "Acme",
      addedFrom: "2026-01-01",
      costMax: "50",
      stockMin: "1",
    });
    // The compile-time half of the contract: the parsed query feeds the
    // service's `filters` argument with no reshaping at the call site.
    const filters: ProductListFilters = parsed;
    expect(filters).toMatchObject({
      categories: ["Phones", "Accessories"],
      suppliers: ["Acme"],
      addedFrom: "2026-01-01",
      costMax: 50,
      stockMin: 1,
    });
    expect(productListFiltersSchema.safeParse(filters).success).toBe(true);
  });
});
