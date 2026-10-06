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
      // LIRA-164 (Supplier Stock Intake): InventoryService.adjustStock/
      // adjustStockDelta no longer call ProductRepository.adjustStock/
      // adjustStockDelta directly — an INCREASE is routed through
      // receiveStock (same booking path as an explicit intake) and a
      // DECREASE through decreaseStockForAdjustment (FIFO batch consumption,
      // never touches the supplier ledger). See InventoryService.ts's
      // `applyStockDelta` doc comment for the owner decision.
      receiveStock: jest.fn(),
      decreaseStockForAdjustment: jest.fn(),
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
      // LIRA-148: the delete cascade is gated on this — default `true` so
      // every existing test keeps exercising the cascade unchanged.
      productUnitsTableExists: jest.fn(() => true),
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

  // ===========================================================================
  // Stock Management
  // ===========================================================================

  // LIRA-164 (Supplier Stock Intake, owner decisions D2-D4): an adjustment
  // that RAISES stock is now a delivery — it books like any other intake
  // (FIFO batch + supplier debit when applicable) via
  // `ProductRepository.receiveStock`, at the product's CURRENT
  // `cost_price_usd`/`supplier` (an adjustment carries no cost input of its
  // own). An adjustment that LOWERS stock stays a correction — it FIFO-
  // consumes batches via `decreaseStockForAdjustment` and never touches the
  // supplier ledger (shrinkage/loss, not a return). Neither branch calls the
  // repo's own `adjustStock`/`adjustStockDelta` anymore — those are ONLY
  // reached by `ProductRepository`'s own callers, not by this service — so
  // with a fully mocked repository `findById` must return a real product
  // (cost_price_usd/supplier) for the service to compute the delta and
  // route it correctly.
  describe("adjustStock", () => {
    it("adjusts stock to absolute value — an INCREASE routes through receiveStock (owner decision D2/D4)", () => {
      mockRepo.findById.mockReturnValue({
        id: 1,
        stock_quantity: 30,
        cost_price_usd: 5,
        supplier: "Acme Distributors",
      } as any);
      mockRepo.receiveStock.mockReturnValue({ batch_id: 7 });

      const result = service.adjustStock(1, 50, "Physical recount", 3);

      expect(mockRepo.receiveStock).toHaveBeenCalledWith({
        product_id: 1,
        quantity: 20, // 50 - 30
        unit_cost_usd: 5,
        supplier: "Acme Distributors",
        is_old_stock: false,
        reason: "Physical recount",
        created_by: 3,
      });
      expect(mockRepo.adjustStock).not.toHaveBeenCalled();
      expect(mockRepo.decreaseStockForAdjustment).not.toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it("adjusts stock to absolute value — a DECREASE routes through decreaseStockForAdjustment (owner decision D3)", () => {
      mockRepo.findById.mockReturnValue({
        id: 1,
        stock_quantity: 30,
        cost_price_usd: 5,
        supplier: null,
      } as any);
      mockRepo.decreaseStockForAdjustment.mockReturnValue(true);

      const result = service.adjustStock(1, 12, "Physical recount", 3);

      expect(mockRepo.decreaseStockForAdjustment).toHaveBeenCalledWith(
        1,
        18, // 30 - 12
        "Physical recount",
        3,
      );
      expect(mockRepo.receiveStock).not.toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it("handles a repository error from the receiveStock booking path", () => {
      mockRepo.findById.mockReturnValue({
        id: 1,
        stock_quantity: 30,
        cost_price_usd: 5,
        supplier: null,
      } as any);
      mockRepo.receiveStock.mockImplementation(() => {
        throw new Error("DB error");
      });

      const result = service.adjustStock(1, 50, "recount", 1);

      expect(result).toEqual({ success: false, error: "DB error" });
    });
  });

  describe("adjustStockDelta", () => {
    it("increments stock — routes through receiveStock (owner decision D2/D4)", () => {
      mockRepo.findById.mockReturnValue({
        id: 1,
        stock_quantity: 30,
        cost_price_usd: 8,
        supplier: "Acme Distributors",
      } as any);
      mockRepo.receiveStock.mockReturnValue({ batch_id: 9 });

      const result = service.adjustStockDelta(1, 10, "Restock delivery", 3);

      expect(mockRepo.receiveStock).toHaveBeenCalledWith({
        product_id: 1,
        quantity: 10,
        unit_cost_usd: 8,
        supplier: "Acme Distributors",
        is_old_stock: false,
        reason: "Restock delivery",
        created_by: 3,
      });
      expect(mockRepo.adjustStockDelta).not.toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it("decrements stock — routes through decreaseStockForAdjustment (owner decision D3), never the supplier ledger", () => {
      mockRepo.findById.mockReturnValue({
        id: 1,
        stock_quantity: 30,
        cost_price_usd: 8,
        supplier: "Acme Distributors",
      } as any);
      mockRepo.decreaseStockForAdjustment.mockReturnValue(true);

      const result = service.adjustStockDelta(1, -5, "Damaged units", 3);

      expect(mockRepo.decreaseStockForAdjustment).toHaveBeenCalledWith(
        1,
        5,
        "Damaged units",
        3,
      );
      expect(mockRepo.receiveStock).not.toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it("returns error for missing product ID", () => {
      const result = service.adjustStockDelta(0, 10, "recount", 1);

      expect(result).toEqual({ success: false, error: "Product ID required" });
    });

    it("returns 'Product not found' when the repository has no matching product", () => {
      mockRepo.findById.mockReturnValue(undefined as any);

      const result = service.adjustStockDelta(999, 10, "recount", 1);

      expect(result).toEqual({ success: false, error: "Product not found" });
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
