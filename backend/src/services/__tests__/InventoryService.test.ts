/**
 * InventoryService Unit Tests
 *
 * Tests all business logic in InventoryService with mocked repository.
 */

import { jest } from "@jest/globals";

jest.mock("@liratek/core", () => {
  const actual =
    jest.requireActual<typeof import("@liratek/core")>("@liratek/core");
  return {
    ...actual,
    getProductRepository: jest.fn(),
    ProductRepository: jest.fn(),
  };
});

import {
  InventoryService,
  resetInventoryService,
  ProductRepository,
  ProductUnitRepository,
  CategoryRepository,
  ValidationError,
  NotFoundError,
} from "@liratek/core";

/** What the stub category repo resolves every name to. */
const STUB_CATEGORY_ID = 4242;

describe("InventoryService", () => {
  let service: InventoryService;
  let mockRepo: jest.Mocked<ProductRepository>;
  /**
   * Stub for the 4th constructor slot. Without it the service's lazy
   * `categoryRepo` getter falls back to the REAL `getCategoryRepository()`
   * singleton — a unit test that injects a mock product repo would silently
   * be running category SQL against the shared better-sqlite3 mock, which is
   * exactly what that constructor parameter exists to prevent.
   */
  let mockCategoryRepo: jest.Mocked<CategoryRepository>;
  /**
   * Stub for the 3rd constructor slot. `deleteProduct`/`batchDeleteProducts`
   * cascade the product's IN_STOCK IMEI units (owner decision 2026-08-26) and
   * own the unit of work through this repository's `transaction()` — leaving
   * the slot `undefined` fell back to the real singleton, whose `this.db` is
   * the better-sqlite3 module mock with no `transaction` on it.
   */
  let mockUnitRepo: jest.Mocked<ProductUnitRepository>;

  beforeEach(() => {
    resetInventoryService();

    // Create mock repository
    mockRepo = {
      findAllProducts: jest.fn(),
      findById: jest.fn(),
      findByBarcode: jest.fn(),
      search: jest.fn(),
      getCategories: jest.fn(),
      barcodeExists: jest.fn(),
      createProduct: jest.fn(),
      exists: jest.fn(),
      updateProductFull: jest.fn(),
      softDeleteById: jest.fn(),
      batchSoftDelete: jest.fn(),
      adjustStock: jest.fn(),
      adjustStockDelta: jest.fn(),
      deductStockForSale: jest.fn(),
      getStockStats: jest.fn(),
      findLowStock: jest.fn(),
    } as unknown as jest.Mocked<ProductRepository>;

    mockCategoryRepo = {
      getOrCreate: jest.fn(() => STUB_CATEGORY_ID),
    } as unknown as jest.Mocked<CategoryRepository>;

    mockUnitRepo = {
      // Pass-through: these unit tests assert the service's orchestration,
      // not SQLite's atomicity (the real transaction is proven in core's
      // InventoryService.deleteUnitCascade.test.ts against a live DB).
      transaction: jest.fn((fn: () => unknown) => fn()),
      deleteInStockForProduct: jest.fn(() => ({ count: 0, imeis: [] })),
      deleteInStockForProducts: jest.fn(() => ({ count: 0, imeis: [] })),
    } as unknown as jest.Mocked<ProductUnitRepository>;

    service = new InventoryService(
      mockRepo,
      undefined,
      mockUnitRepo,
      mockCategoryRepo,
    );
  });

  // ===========================================================================
  // Product Queries
  // ===========================================================================

  describe("getProducts", () => {
    // `getProducts(search?, filters?)` forwards BOTH args straight to
    // `findAllProducts(search?, filters?)` — the structured inventory-list
    // filters are pushed down into SQL by the repository, so the service
    // stays a pass-through. `toHaveBeenCalledWith` is arity-sensitive, hence
    // the explicit trailing `undefined` on the no-filter calls.
    it("returns all products without filter", () => {
      const mockProducts = [
        { id: 1, barcode: "123", name: "Product A" },
        { id: 2, barcode: "456", name: "Product B" },
      ];
      mockRepo.findAllProducts.mockReturnValue(mockProducts as any);

      const result = service.getProducts();

      expect(mockRepo.findAllProducts).toHaveBeenCalledWith(undefined, undefined);
      expect(result).toEqual(mockProducts);
    });

    it("passes search term to repository", () => {
      mockRepo.findAllProducts.mockReturnValue([]);

      service.getProducts("phone");

      expect(mockRepo.findAllProducts).toHaveBeenCalledWith("phone", undefined);
    });

    it("forwards the structured filter set to the repository untouched", () => {
      mockRepo.findAllProducts.mockReturnValue([]);
      const filters = {
        categories: ["Phones"],
        suppliers: ["Acme"],
        costMin: 10,
        stockMax: 5,
      };

      service.getProducts("phone", filters);

      expect(mockRepo.findAllProducts).toHaveBeenCalledWith("phone", filters);
    });
  });

  describe("getProductById", () => {
    it("returns product when found", () => {
      const mockProduct = { id: 1, barcode: "123", name: "Product A" };
      mockRepo.findById.mockReturnValue(mockProduct as any);

      const result = service.getProductById(1);

      expect(mockRepo.findById).toHaveBeenCalledWith(1);
      expect(result).toEqual(mockProduct);
    });

    it("throws NotFoundError when product not found", () => {
      mockRepo.findById.mockReturnValue(null);

      expect(() => service.getProductById(999)).toThrow(NotFoundError);
    });
  });

  describe("getProductByBarcode", () => {
    it("returns product when found", () => {
      const mockProduct = { id: 1, barcode: "123", name: "Product A" };
      mockRepo.findByBarcode.mockReturnValue(mockProduct as any);

      const result = service.getProductByBarcode("123");

      expect(mockRepo.findByBarcode).toHaveBeenCalledWith("123");
      expect(result).toEqual(mockProduct);
    });

    it("throws ValidationError for empty barcode", () => {
      expect(() => service.getProductByBarcode("")).toThrow(ValidationError);
    });

    it("trims whitespace from barcode", () => {
      mockRepo.findByBarcode.mockReturnValue(null);

      service.getProductByBarcode("  123  ");

      expect(mockRepo.findByBarcode).toHaveBeenCalledWith("123");
    });
  });

  describe("searchProducts", () => {
    it("returns matching products", () => {
      const mockProducts = [{ id: 1, barcode: "123", name: "iPhone" }];
      mockRepo.search.mockReturnValue(mockProducts as any);

      const result = service.searchProducts("phone");

      expect(mockRepo.search).toHaveBeenCalledWith("phone", undefined);
      expect(result).toEqual(mockProducts);
    });

    it("returns empty array for empty search term", () => {
      const result = service.searchProducts("");

      expect(mockRepo.search).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it("passes options to repository", () => {
      mockRepo.search.mockReturnValue([]);

      service.searchProducts("phone", { limit: 10, category: "Electronics" });

      expect(mockRepo.search).toHaveBeenCalledWith("phone", {
        limit: 10,
        category: "Electronics",
      });
    });
  });

  describe("getCategories", () => {
    it("returns categories from repository", () => {
      const mockCategories = ["Electronics", "Accessories", "Services"];
      mockRepo.getCategories.mockReturnValue(mockCategories);

      const result = service.getCategories();

      expect(mockRepo.getCategories).toHaveBeenCalled();
      expect(result).toEqual(mockCategories);
    });
  });

  // ===========================================================================
  // Product CRUD
  // ===========================================================================

  describe("createProduct", () => {
    const validProductData = {
      barcode: "123456",
      name: "Test Product",
      category: "Electronics",
      cost_price: 10,
      retail_price: 20,
      current_stock: 100,
      min_stock_level: 10,
    };

    it("creates product successfully, stamping the resolved category_id", () => {
      mockRepo.barcodeExists.mockReturnValue(false);
      mockRepo.createProduct.mockReturnValue({ id: 1 });

      const result = service.createProduct(validProductData);

      // Rule 14/19b: the category NAME is resolved HERE (one site for IPC
      // and REST alike) and the id goes onto the row — a create that left
      // `category_id` NULL is what made `tracks_imei_units` always 0 for
      // web-created products (LIRA-143 decision #9).
      expect(mockCategoryRepo.getOrCreate).toHaveBeenCalledWith("Electronics");
      expect(mockRepo.createProduct).toHaveBeenCalledWith({
        ...validProductData,
        barcode: "123456",
        name: "Test Product",
        category: "Electronics",
        category_id: STUB_CATEGORY_ID,
      });
      expect(result).toEqual({ success: true, id: 1 });
    });

    it("auto-generates barcode when missing", () => {
      mockRepo.barcodeExists.mockReturnValue(false);
      mockRepo.createProduct.mockReturnValue({ id: 1 });

      const result = service.createProduct({
        ...validProductData,
        barcode: "",
      });

      expect(result).toEqual({ success: true, id: 1 });
      const call = mockRepo.createProduct.mock.calls[0][0];
      expect(call.barcode).toMatch(/^\d{8}$/);
    });

    it("returns error for missing name", () => {
      const result = service.createProduct({
        ...validProductData,
        name: "",
      });

      expect(result).toEqual({
        success: false,
        error: "Product name is required",
      });
    });

    it("returns error for missing category", () => {
      const result = service.createProduct({
        ...validProductData,
        category: "",
      });

      expect(result).toEqual({ success: false, error: "Category is required" });
    });

    it("returns error for negative cost price", () => {
      const result = service.createProduct({
        ...validProductData,
        cost_price: -5,
      });

      expect(result).toEqual({
        success: false,
        error: "Cost price cannot be negative",
      });
    });

    it("returns error for negative retail price", () => {
      const result = service.createProduct({
        ...validProductData,
        retail_price: -10,
      });

      expect(result).toEqual({
        success: false,
        error: "Retail price cannot be negative",
      });
    });

    it("returns structured error for duplicate barcode", () => {
      // Original barcode exists; suggestion barcode does not
      mockRepo.barcodeExists.mockImplementation((code: string) => {
        if (code === "123456") return true;
        return false;
      });

      const result = service.createProduct(validProductData);

      expect(result).toEqual({
        success: false,
        error: "Barcode already exists",
        code: "DUPLICATE_BARCODE",
        suggested_barcode: "123456DUP1",
      });
    });

    it("handles repository error", () => {
      mockRepo.barcodeExists.mockReturnValue(false);
      mockRepo.createProduct.mockImplementation(() => {
        throw new Error("DB error");
      });

      const result = service.createProduct(validProductData);

      expect(result).toEqual({ success: false, error: "DB error" });
    });
  });

  describe("updateProduct", () => {
    const updateData = {
      barcode: "123456",
      name: "Updated Product",
      category: "Electronics",
      category_id: null,
      cost_price: 15,
      retail_price: 30,
      min_stock_level: 5,
      supplier: null,
    };

    it("updates product successfully, re-resolving category_id from the NAME", () => {
      mockRepo.exists.mockReturnValue(true);
      mockRepo.barcodeExists.mockReturnValue(false);
      mockRepo.updateProductFull.mockReturnValue(true);

      const result = service.updateProduct(1, updateData);

      // `updateData` carries `category_id: null` — the pre-fix contract wrote
      // that straight through, which NULLed a correct id on every web edit.
      // The name now wins and the caller's id is ignored entirely.
      expect(mockCategoryRepo.getOrCreate).toHaveBeenCalledWith("Electronics");
      expect(mockRepo.updateProductFull).toHaveBeenCalledWith(1, {
        ...updateData,
        category_id: STUB_CATEGORY_ID,
      });
      expect(result).toEqual({ success: true });
    });

    it("leaves category/category_id out of the write when the update names no category", () => {
      mockRepo.exists.mockReturnValue(true);
      mockRepo.barcodeExists.mockReturnValue(false);
      mockRepo.updateProductFull.mockReturnValue(true);
      // Same edit as above with the two category keys ABSENT — what the
      // unvalidated REST `PUT /api/inventory/products/:id` can deliver.
      const result = service.updateProduct(1, {
        barcode: "123456",
        name: "Updated Product",
        cost_price: 15,
        retail_price: 30,
        min_stock_level: 5,
        supplier: null,
      });

      expect(result).toEqual({ success: true });
      // Omitted category = "leave this product's classification alone": no
      // find-or-create (so no invented 'General' row) and both keys absent
      // from the payload, which `updateProductFull`'s COALESCE reads as
      // "keep the stored values".
      expect(mockCategoryRepo.getOrCreate).not.toHaveBeenCalled();
      const written = mockRepo.updateProductFull.mock.calls[0][1];
      expect("category" in written).toBe(false);
      expect("category_id" in written).toBe(false);
      expect(written.name).toBe("Updated Product");
    });

    it("returns error for missing product ID", () => {
      const result = service.updateProduct(0, updateData);

      expect(result).toEqual({ success: false, error: "Product ID required" });
    });

    it("returns error when product not found", () => {
      mockRepo.exists.mockReturnValue(false);

      const result = service.updateProduct(999, updateData);

      expect(result).toEqual({ success: false, error: "Product not found" });
    });

    it("returns structured error for duplicate barcode", () => {
      mockRepo.exists.mockReturnValue(true);
      // Original barcode exists; suggestion barcode does not
      mockRepo.barcodeExists.mockImplementation((code: string) => {
        if (code === "123456") return true;
        return false;
      });

      const result = service.updateProduct(1, updateData);

      expect(result).toEqual({
        success: false,
        error: "Barcode already exists",
        code: "DUPLICATE_BARCODE",
        suggested_barcode: "123456DUP1",
      });
    });
  });

  describe("deleteProduct", () => {
    it("soft deletes product successfully", () => {
      mockRepo.softDeleteById.mockReturnValue(true);

      const result = service.deleteProduct(1);

      expect(mockRepo.softDeleteById).toHaveBeenCalledWith(1);
      // The IMEI-unit cascade runs for every delete, inside the repository-
      // owned transaction — and reports nothing when there was nothing to
      // remove (absent, not 0).
      expect(mockUnitRepo.transaction).toHaveBeenCalledTimes(1);
      expect(mockUnitRepo.deleteInStockForProduct).toHaveBeenCalledWith(1);
      expect(result).toEqual({ success: true });
    });

    it("reports the IN_STOCK units the cascade removed", () => {
      mockRepo.softDeleteById.mockReturnValue(true);
      (
        mockUnitRepo.deleteInStockForProduct as unknown as jest.Mock
      ).mockReturnValue({
        count: 2,
        imeis: ["111000000000001", "111000000000002"],
      });

      const result = service.deleteProduct(1);

      expect(result).toEqual({
        success: true,
        removed_unit_count: 2,
        removed_unit_imeis: ["111000000000001", "111000000000002"],
      });
    });

    it("returns error for missing product ID", () => {
      const result = service.deleteProduct(0);

      expect(result).toEqual({ success: false, error: "Product ID required" });
      // Refused before the transaction opens — nothing cascaded.
      expect(mockUnitRepo.transaction).not.toHaveBeenCalled();
    });

    it("handles repository error", () => {
      mockRepo.softDeleteById.mockImplementation(() => {
        throw new Error("DB error");
      });

      const result = service.deleteProduct(1);

      expect(result).toEqual({ success: false, error: "DB error" });
      // The soft delete throws first, so the cascade never runs — the real
      // transaction rolls the whole unit of work back.
      expect(mockUnitRepo.deleteInStockForProduct).not.toHaveBeenCalled();
    });
  });

  describe("batchDeleteProducts", () => {
    it("cascades the IMEI units for every id in the batch", () => {
      (
        mockRepo.batchSoftDelete as unknown as jest.Mock
      ).mockReturnValue(2);
      (
        mockUnitRepo.deleteInStockForProducts as unknown as jest.Mock
      ).mockReturnValue({ count: 3, imeis: ["a", "b", "c"] });

      const result = service.batchDeleteProducts([1, 2]);

      expect(mockRepo.batchSoftDelete).toHaveBeenCalledWith([1, 2]);
      expect(mockUnitRepo.deleteInStockForProducts).toHaveBeenCalledWith([
        1, 2,
      ]);
      expect(result).toEqual({
        success: true,
        deleted: 2,
        removed_unit_count: 3,
        removed_unit_imeis: ["a", "b", "c"],
      });
    });

    it("rejects an empty id list before opening the transaction", () => {
      const result = service.batchDeleteProducts([]);

      expect(result).toEqual({
        success: false,
        error: "No product IDs provided",
      });
      expect(mockUnitRepo.transaction).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Stock Management
  // ===========================================================================

  describe("adjustStock", () => {
    it("adjusts stock to absolute value", () => {
      mockRepo.adjustStock.mockReturnValue(true);

      const result = service.adjustStock(1, 50, "Physical recount", 3);

      expect(mockRepo.adjustStock).toHaveBeenCalledWith(
        1,
        50,
        "Physical recount",
        3,
      );
      expect(result).toEqual({ success: true });
    });

    it("returns error for missing product ID", () => {
      const result = service.adjustStock(0, 50, "recount", 1);

      expect(result).toEqual({ success: false, error: "Product ID required" });
    });

    it("returns error for negative quantity", () => {
      const result = service.adjustStock(1, -10, "recount", 1);

      expect(result).toEqual({
        success: false,
        error: "Stock quantity cannot be negative",
      });
    });

    it("returns error for a missing reason (LIRA-077 audit trail)", () => {
      const result = service.adjustStock(1, 50, "   ", 1);

      expect(result).toEqual({ success: false, error: "Reason is required" });
      expect(mockRepo.adjustStock).not.toHaveBeenCalled();
    });

    it("handles repository error", () => {
      mockRepo.adjustStock.mockImplementation(() => {
        throw new Error("DB error");
      });

      const result = service.adjustStock(1, 50, "recount", 1);

      expect(result).toEqual({ success: false, error: "DB error" });
    });
  });

  describe("adjustStockDelta", () => {
    it("increments stock", () => {
      mockRepo.adjustStockDelta.mockReturnValue(true);

      const result = service.adjustStockDelta(1, 10, "Restock delivery", 3);

      expect(mockRepo.adjustStockDelta).toHaveBeenCalledWith(
        1,
        10,
        "Restock delivery",
        3,
      );
      expect(result).toEqual({ success: true });
    });

    it("decrements stock", () => {
      mockRepo.adjustStockDelta.mockReturnValue(true);

      const result = service.adjustStockDelta(1, -5, "Damaged units", 3);

      expect(mockRepo.adjustStockDelta).toHaveBeenCalledWith(
        1,
        -5,
        "Damaged units",
        3,
      );
      expect(result).toEqual({ success: true });
    });

    it("returns error for missing product ID", () => {
      const result = service.adjustStockDelta(0, 10, "recount", 1);

      expect(result).toEqual({ success: false, error: "Product ID required" });
    });

    it("returns error for a missing reason (LIRA-077 audit trail)", () => {
      const result = service.adjustStockDelta(1, 10, "", 1);

      expect(result).toEqual({ success: false, error: "Reason is required" });
      expect(mockRepo.adjustStockDelta).not.toHaveBeenCalled();
    });
  });

  describe("deductStockForSale", () => {
    it("calls repository to deduct stock", () => {
      mockRepo.deductStockForSale.mockReturnValue(undefined);

      service.deductStockForSale(123);

      expect(mockRepo.deductStockForSale).toHaveBeenCalledWith(123);
    });
  });

  // ===========================================================================
  // Reporting
  // ===========================================================================

  describe("getStockStats", () => {
    it("returns stock stats from repository", () => {
      const mockStats = {
        totalBudget: 50000,
        totalItems: 500,
      };
      mockRepo.getStockStats.mockReturnValue(mockStats as any);

      const result = service.getStockStats();

      expect(mockRepo.getStockStats).toHaveBeenCalled();
      expect(result).toEqual(mockStats);
    });
  });

  describe("getLowStockProducts", () => {
    it("returns low stock products from repository", () => {
      const mockProducts = [
        {
          id: 1,
          name: "Low Stock Item",
          current_stock: 2,
          min_stock_level: 10,
        },
      ];
      mockRepo.findLowStock.mockReturnValue(mockProducts as any);

      const result = service.getLowStockProducts();

      expect(mockRepo.findLowStock).toHaveBeenCalled();
      expect(result).toEqual(mockProducts);
    });
  });
});
