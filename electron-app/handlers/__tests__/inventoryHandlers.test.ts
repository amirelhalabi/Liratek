// electron/handlers/__tests__/inventoryHandlers.test.ts

/**
 * Revived 2026-09-13 (rotted test suite).
 *
 * What had drifted: mocked `../../db`'s `getDatabase()` directly, but
 * `inventoryHandlers.ts` never imports `../../db` at all — every handler
 * resolves data access through `@liratek/core`'s `getInventoryService`,
 * `getCategoryRepository`, and `getProductSupplierRepository` getters. The
 * `../../db` mock intercepted nothing, so `registerInventoryHandlers()`
 * reached the real, uninitialized core. Repointed at `@liratek/core`
 * (jest.requireActual + override), matching
 * `inventoryHandlers.categorySupplierRoleGate.test.ts` in this same folder.
 *
 * The hardcoded channel list was also stale in the "incomplete, not wrong"
 * way CLAUDE.md's task brief warns about: `registerInventoryHandlers()`
 * currently registers 27 channels; only 9 were ever asserted here (18 were
 * simply never checked — none of the 9 were themselves renamed or removed).
 * Expanded to the full current list (verified against
 * `electron-app/handlers/inventoryHandlers.ts`, 2026-09-13) so this test
 * earns the name "registers expected IPC channels".
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

import {
  getInventoryService,
  getCategoryRepository,
  getProductSupplierRepository,
} from "@liratek/core";

describe("inventoryHandlers registration", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (getInventoryService as jest.Mock).mockReturnValue({
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
    });
    (getCategoryRepository as jest.Mock).mockReturnValue({
      getNames: jest.fn(),
      getAll: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    });
    (getProductSupplierRepository as jest.Mock).mockReturnValue({
      getNames: jest.fn(),
      getAllWithProductCount: jest.fn(),
      getOrCreate: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    });
  });

  it("registers expected IPC channels", () => {
    const { ipcMain: originalIpcMain } = require("electron");
    const ipcMain = originalIpcMain as { handle: jest.Mock };
    const mod = require("../inventoryHandlers");
    mod.registerInventoryHandlers();
    const calls = ipcMain.handle.mock.calls.map((c: any) => c[0]);

    // Full, current channel list registered by registerInventoryHandlers()
    // (verified against electron-app/handlers/inventoryHandlers.ts,
    // 2026-09-13). The original 9-item list is still in here, just no
    // longer the whole story.
    const expected = [
      "inventory:get-products",
      "inventory:get-product-filter-options",
      "inventory:get-product",
      "inventory:get-product-by-barcode",
      "inventory:resolve-scan-code",
      "inventory:create-product",
      "inventory:update-product",
      "inventory:batch-update",
      "inventory:delete-product",
      "inventory:batch-delete",
      "inventory:adjust-stock",
      "inventory:receive-stock",
      "inventory:get-stock-adjustments",
      "inventory:get-open-stock-batches",
      "inventory:get-stock-stats",
      "inventory:get-low-stock-products",
      "inventory:get-negative-stock",
      "inventory:get-categories",
      "inventory:create-category",
      "inventory:update-category",
      "inventory:delete-category",
      "inventory:get-categories-full",
      "inventory:get-product-suppliers",
      "inventory:get-product-suppliers-full",
      "inventory:create-product-supplier",
      "inventory:update-product-supplier",
      "inventory:delete-product-supplier",
    ];
    expected.forEach((ch) => expect(calls).toContain(ch));
  });
});
