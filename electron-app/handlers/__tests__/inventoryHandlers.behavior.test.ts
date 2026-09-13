// Tests behavior of inventory:create-product handler

/**
 * Revived 2026-09-13 (rotted test suite).
 *
 * What had drifted: mocked `../../db`'s `getDatabase()` and drove the
 * "barcode already exists" case by having a shared `stmt.run()` mock throw a
 * raw `SQLITE_CONSTRAINT_UNIQUE` error — but `inventory:create-product`
 * never touches the database or a thrown driver error at all any more.
 * `InventoryService.createProduct` (packages/core/src/services/
 * InventoryService.ts) checks `productRepo.barcodeExists(barcode)`
 * PROACTIVELY before ever attempting an insert, returning
 * `{ success: false, error: "Barcode already exists", code:
 * "DUPLICATE_BARCODE", suggested_barcode }` — there is no
 * `SQLITE_CONSTRAINT_UNIQUE` for the handler to catch (the handler itself
 * has no try/catch around `service.createProduct(...)` either). Repointed
 * at `@liratek/core`'s `getInventoryService` getter (jest.requireActual +
 * override) and the test now configures the mocked SERVICE's `createProduct`
 * to return that already-normalized result, matching what the real service
 * contract actually produces, instead of simulating a raw driver error the
 * handler was never responsible for catching.
 */

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn(), on: jest.fn(), removeHandler: jest.fn() },
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    getInventoryService: jest.fn(),
    getCategoryRepository: jest.fn(),
    getProductSupplierRepository: jest.fn(),
  };
});

jest.mock("../../session.js", () => ({
  requireRole: jest.fn(() => ({ ok: true, userId: 7 })),
}));

jest.mock("../auditHelper.js", () => ({
  audit: jest.fn(),
}));

import { ipcMain as originalIpcMain } from "electron";
import {
  getInventoryService,
  getCategoryRepository,
  getProductSupplierRepository,
} from "@liratek/core";
import { registerInventoryHandlers } from "../inventoryHandlers";

const ipcMain = originalIpcMain as unknown as { handle: jest.Mock };

describe("inventory:create-product behavior", () => {
  const mockService = {
    getProducts: jest.fn(),
    getProductFilterOptions: jest.fn(),
    getProductById: jest.fn(),
    getProductByBarcode: jest.fn(),
    resolveScanCode: jest.fn(),
    createProduct: jest.fn(),
    updateProduct: jest.fn(),
    batchUpdateProducts: jest.fn(),
    deleteProduct: jest.fn(),
    batchDeleteProducts: jest.fn(),
    adjustStockDelta: jest.fn(),
    adjustStock: jest.fn(),
    receiveStock: jest.fn(),
    getStockAdjustments: jest.fn(),
    getOpenStockBatches: jest.fn(),
    getStockStats: jest.fn(),
    getLowStockProducts: jest.fn(),
    getNegativeStockProducts: jest.fn(),
  };
  const mockCatRepo = { getNames: jest.fn(), getAll: jest.fn() };
  const mockSupplierRepo = {
    getNames: jest.fn(),
    getAllWithProductCount: jest.fn(),
    getOrCreate: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    (getInventoryService as jest.Mock).mockReturnValue(mockService);
    (getCategoryRepository as jest.Mock).mockReturnValue(mockCatRepo);
    (getProductSupplierRepository as jest.Mock).mockReturnValue(
      mockSupplierRepo,
    );

    registerInventoryHandlers();
  });

  it("returns barcode exists when the service reports DUPLICATE_BARCODE", async () => {
    mockService.createProduct.mockReturnValue({
      success: false,
      error: "Barcode already exists",
      code: "DUPLICATE_BARCODE",
      suggested_barcode: "12345679",
    });

    const call = ipcMain.handle.mock.calls.find(
      (c: any) => c[0] === "inventory:create-product",
    );
    const handler = call[1];
    const res = await handler(
      { sender: { id: 1 } },
      {
        barcode: "b",
        name: "n",
        category: "c",
        cost_price: 1,
        retail_price: 2,
        stock_quantity: 0,
        min_stock_level: 0,
      },
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Barcode/);
  });

  it("returns success true on create", async () => {
    mockService.createProduct.mockReturnValue({ success: true, id: 123 });

    const call = ipcMain.handle.mock.calls.find(
      (c: any) => c[0] === "inventory:create-product",
    );
    const handler = call[1];
    const res = await handler(
      { sender: { id: 1 } },
      {
        barcode: "b",
        name: "n",
        category: "c",
        cost_price: 1,
        retail_price: 2,
        stock_quantity: 1,
        min_stock_level: 1,
      },
    );
    expect(res.success).toBe(true);
    expect(res.id).toBe(123);
    expect(mockService.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        barcode: "b",
        name: "n",
        category: "c",
        cost_price: 1,
        retail_price: 2,
        stock_quantity: 1,
        min_stock_level: 1,
      }),
      7, // auth.userId from the mocked requireRole, never trusted from the payload
    );
  });
});
