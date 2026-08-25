/**
 * ProductUnitHandlers Unit Tests (LIRA-143 Phase 5 — phone IMEI units &
 * warranty).
 *
 * Tests IPC handler registration, envelope shape, the admin-or-staff role
 * gate on the two writes (`register`, `delete`), and Zod validation
 * rejection at the IPC door. Same mocking shape as
 * `exchangeLotHandlers.test.ts`: mocks `@liratek/core` via
 * `jest.requireActual` + override so the schemas this handler validates
 * against stay REAL — validation-rejection tests exercise actual Zod, not a
 * stub — while only the service getter is replaced with a mock.
 */

import { ipcMain } from "electron";
import { registerProductUnitHandlers } from "../productUnitHandlers";
import { getProductUnitService } from "@liratek/core";
import { requireRole } from "../../session";
import { audit } from "../auditHelper";

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn() },
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    getProductUnitService: jest.fn(),
  };
});

jest.mock("../../session", () => ({
  requireRole: jest.fn(),
}));

jest.mock("../auditHelper", () => ({
  audit: jest.fn(),
}));

describe("ProductUnitHandlers", () => {
  // A SINGLE persistent mock object, never reassigned across tests — same
  // cached-singleton reasoning as exchangeLotHandlers.test.ts's mockService
  // (registerProductUnitHandlers's getProductUnitServiceInstance() caches
  // whatever getProductUnitService() returns on its FIRST call).
  const mockService = {
    registerUnits: jest.fn(),
    getUnitsForProduct: jest.fn(),
    getSummaryForProducts: jest.fn(),
    deleteUnit: jest.fn(),
    getUnitStory: jest.fn(),
    getUnitsForSaleItems: jest.fn(),
  };
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();

    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });

    (getProductUnitService as jest.Mock).mockReturnValue(mockService);
    (requireRole as jest.Mock).mockReturnValue({ ok: true, userId: 7 });

    registerProductUnitHandlers();
  });

  describe("Handler Registration", () => {
    it("registers all six product-units channels", () => {
      expect(ipcMain.handle).toHaveBeenCalledWith(
        "product-units:register",
        expect.any(Function),
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        "product-units:for-product",
        expect.any(Function),
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        "product-units:summary",
        expect.any(Function),
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        "product-units:delete",
        expect.any(Function),
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        "product-units:story",
        expect.any(Function),
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        "product-units:for-sale-items",
        expect.any(Function),
      );
    });
  });

  describe("product-units:register", () => {
    it("rejects a non-admin/staff caller WITHOUT calling the service", async () => {
      (requireRole as jest.Mock).mockReturnValue({
        ok: false,
        error: "Forbidden",
      });
      const handler = handlers.get("product-units:register")!;

      const result = await handler(
        { sender: { id: 1 } },
        { product_id: 1, imeis: ["123456789012345"] },
      );

      expect(requireRole).toHaveBeenCalledWith(1, ["admin", "staff"]);
      expect(mockService.registerUnits).not.toHaveBeenCalled();
      expect(result).toEqual({ success: false, error: "Forbidden" });
    });

    it("rejects an invalid payload (empty imeis) at the door WITHOUT calling the service", async () => {
      const handler = handlers.get("product-units:register")!;

      const result = await handler(
        { sender: { id: 1 } },
        { product_id: 1, imeis: [] },
      );

      expect(mockService.registerUnits).not.toHaveBeenCalled();
      expect((result as { success: boolean }).success).toBe(false);
      expect((result as { error: string }).error).toEqual(
        expect.stringContaining("Validation failed"),
      );
    });

    it("validates the payload, delegates to the service, wraps in { success, data }, and audits", async () => {
      mockService.registerUnits.mockReturnValue({
        units: [{ id: 1 }, { id: 2 }],
        drift: { inStockUnits: 2, stockQuantity: 2, matches: true },
      });
      const handler = handlers.get("product-units:register")!;

      const result = await handler(
        { sender: { id: 1 } },
        { product_id: 5, imeis: ["111111111111111", "222222222222222"] },
      );

      expect(mockService.registerUnits).toHaveBeenCalledWith(5, [
        "111111111111111",
        "222222222222222",
      ]);
      expect(result).toEqual({
        success: true,
        data: {
          units: [{ id: 1 }, { id: 2 }],
          drift: { inStockUnits: 2, stockQuantity: 2, matches: true },
        },
      });
      expect(audit).toHaveBeenCalledTimes(1);
    });
  });

  describe("product-units:for-product", () => {
    it("validates productId, delegates to the service, and wraps in { success, data }", async () => {
      mockService.getUnitsForProduct.mockReturnValue([{ id: 1 }]);
      const handler = handlers.get("product-units:for-product")!;

      const result = await handler({}, { productId: 5, status: "IN_STOCK" });

      expect(mockService.getUnitsForProduct).toHaveBeenCalledWith(
        5,
        "IN_STOCK",
      );
      expect(result).toEqual({ success: true, data: [{ id: 1 }] });
    });

    it("rejects a non-positive productId at the door WITHOUT calling the service", async () => {
      const handler = handlers.get("product-units:for-product")!;

      const result = await handler({}, { productId: 0 });

      expect(mockService.getUnitsForProduct).not.toHaveBeenCalled();
      expect((result as { success: boolean }).success).toBe(false);
    });
  });

  describe("product-units:summary", () => {
    it("validates product_ids, delegates to the service, and wraps in { success, data }", async () => {
      mockService.getSummaryForProducts.mockReturnValue({
        5: { in_stock: 2, sold: 1, defective: 0 },
      });
      const handler = handlers.get("product-units:summary")!;

      const result = await handler({}, { product_ids: [5] });

      expect(mockService.getSummaryForProducts).toHaveBeenCalledWith([5]);
      expect(result).toEqual({
        success: true,
        data: { 5: { in_stock: 2, sold: 1, defective: 0 } },
      });
    });

    it("rejects an empty product_ids array at the door WITHOUT calling the service", async () => {
      const handler = handlers.get("product-units:summary")!;

      const result = await handler({}, { product_ids: [] });

      expect(mockService.getSummaryForProducts).not.toHaveBeenCalled();
      expect((result as { success: boolean }).success).toBe(false);
    });
  });

  describe("product-units:delete", () => {
    it("rejects a non-admin/staff caller WITHOUT calling the service", async () => {
      (requireRole as jest.Mock).mockReturnValue({
        ok: false,
        error: "Forbidden",
      });
      const handler = handlers.get("product-units:delete")!;

      const result = await handler({ sender: { id: 1 } }, { id: 9 });

      expect(mockService.deleteUnit).not.toHaveBeenCalled();
      expect(result).toEqual({ success: false, error: "Forbidden" });
    });

    it("rejects a non-positive id at the door WITHOUT calling the service", async () => {
      const handler = handlers.get("product-units:delete")!;

      const result = await handler({ sender: { id: 1 } }, { id: 0 });

      expect(mockService.deleteUnit).not.toHaveBeenCalled();
      expect((result as { success: boolean }).success).toBe(false);
    });

    it("validates id, delegates to the service, returns { success: true }, and audits", async () => {
      const handler = handlers.get("product-units:delete")!;

      const result = await handler({ sender: { id: 1 } }, { id: 9 });

      expect(mockService.deleteUnit).toHaveBeenCalledWith(9);
      expect(result).toEqual({ success: true });
      expect(audit).toHaveBeenCalledTimes(1);
    });
  });

  describe("product-units:story", () => {
    it("validates imei, delegates to the service, and wraps in { success, data }", async () => {
      mockService.getUnitStory.mockReturnValue([{ id: 1, imei: "abc" }]);
      const handler = handlers.get("product-units:story")!;

      const result = await handler({}, { imei: "abc" });

      expect(mockService.getUnitStory).toHaveBeenCalledWith("abc");
      expect(result).toEqual({
        success: true,
        data: [{ id: 1, imei: "abc" }],
      });
    });

    it("rejects a blank imei at the door WITHOUT calling the service", async () => {
      const handler = handlers.get("product-units:story")!;

      const result = await handler({}, { imei: "" });

      expect(mockService.getUnitStory).not.toHaveBeenCalled();
      expect((result as { success: boolean }).success).toBe(false);
    });
  });

  describe("product-units:for-sale-items", () => {
    it("validates sale_item_ids, delegates to the service, and wraps in { success, data }", async () => {
      mockService.getUnitsForSaleItems.mockReturnValue([{ id: 1 }]);
      const handler = handlers.get("product-units:for-sale-items")!;

      const result = await handler({}, { sale_item_ids: [1, 2] });

      expect(mockService.getUnitsForSaleItems).toHaveBeenCalledWith([1, 2]);
      expect(result).toEqual({ success: true, data: [{ id: 1 }] });
    });

    it("rejects an empty sale_item_ids array at the door WITHOUT calling the service", async () => {
      const handler = handlers.get("product-units:for-sale-items")!;

      const result = await handler({}, { sale_item_ids: [] });

      expect(mockService.getUnitsForSaleItems).not.toHaveBeenCalled();
      expect((result as { success: boolean }).success).toBe(false);
    });
  });
});
