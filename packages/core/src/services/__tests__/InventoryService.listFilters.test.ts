/**
 * InventoryService — product-list filter passthrough.
 *
 * `getProducts` and `getProductFilterOptions` are deliberately thin: all
 * of the filtering is SQL in `ProductRepository` (rule 13 — services never
 * touch the DB), so what actually needs guarding here is that the service
 * forwards `filters` instead of silently dropping it, and that omitting
 * `filters` still reaches the repository as `undefined` (the "unchanged
 * for every existing caller" contract).
 *
 * Deviates from the sibling InventoryService tests' in-memory-SQLite house
 * style on purpose: a mocked repository is the right instrument for a
 * forwarding check (it can observe the exact arguments, which a real DB
 * cannot) and it keeps this file runnable without the better-sqlite3
 * native binding.
 */

import { InventoryService } from "../InventoryService.js";
import type {
  ProductRepository,
  ProductDTO,
  ProductFilterOptions,
  StockAdjustmentRepository,
  ProductUnitRepository,
} from "../../repositories/index.js";
import type { ProductListFilters } from "../../validators/product.js";

interface FindAllCall {
  search: string | undefined;
  filters: ProductListFilters | undefined;
}

function makeService(): {
  service: InventoryService;
  calls: FindAllCall[];
  products: ProductDTO[];
  options: ProductFilterOptions;
  state: { optionsCalls: number };
} {
  const calls: FindAllCall[] = [];
  const state = { optionsCalls: 0 };
  const products: ProductDTO[] = [
    {
      id: 7,
      barcode: "1",
      name: "Widget",
      category: "Phones",
      cost_price: 1,
      retail_price: 2,
      stock_quantity: 3,
      min_stock_level: 1,
      image_url: null,
      is_active: 1,
      is_deleted: 0,
      supplier: "Acme",
      created_at: "2026-01-01 00:00:00",
      tracks_imei_units: 0,
      warranty_months: null,
    },
  ];
  const options: ProductFilterOptions = {
    categories: ["Phones"],
    suppliers: ["Acme"],
  };

  const repo = {
    findAllProducts: (
      search?: string,
      filters?: ProductListFilters,
    ): ProductDTO[] => {
      calls.push({ search, filters });
      return products;
    },
    getProductFilterOptions: (): ProductFilterOptions => {
      state.optionsCalls += 1;
      return options;
    },
  } as unknown as ProductRepository;

  const service = new InventoryService(
    repo,
    {} as unknown as StockAdjustmentRepository,
    {} as unknown as ProductUnitRepository,
  );

  return { service, calls, products, options, state };
}

describe("InventoryService — product-list filters", () => {
  describe("getProducts", () => {
    it("forwards both search and filters to the repository", () => {
      const { service, calls } = makeService();
      const filters: ProductListFilters = {
        categories: ["Phones"],
        suppliers: ["Acme"],
        addedFrom: "2026-01-01",
        addedTo: "2026-12-31",
        costMin: 1,
        costMax: 2,
        retailMin: 3,
        retailMax: 4,
        profitPctMin: -5,
        profitPctMax: 6,
        stockMin: 7,
        stockMax: 8,
      };

      service.getProducts("widget", filters);

      expect(calls).toHaveLength(1);
      expect(calls[0].search).toBe("widget");
      // Forwarded whole — a partial copy would silently drop filters.
      expect(calls[0].filters).toEqual(filters);
    });

    it("passes filters through even with no search term", () => {
      const { service, calls } = makeService();
      service.getProducts(undefined, { stockMax: 0 });
      expect(calls[0]).toEqual({ search: undefined, filters: { stockMax: 0 } });
    });

    it("reaches the repository with undefined filters when called the old way", () => {
      const { service, calls } = makeService();
      service.getProducts();
      service.getProducts("phone");
      expect(calls).toEqual([
        { search: undefined, filters: undefined },
        { search: "phone", filters: undefined },
      ]);
    });

    it("returns the repository rows untouched", () => {
      const { service, products } = makeService();
      expect(service.getProducts(undefined, { costMin: 1 })).toEqual(products);
    });
  });

  describe("getProductFilterOptions", () => {
    it("passes through to the repository and returns its result", () => {
      const { service, options, state } = makeService();
      expect(service.getProductFilterOptions()).toEqual(options);
      expect(state.optionsCalls).toBe(1);
    });
  });
});
