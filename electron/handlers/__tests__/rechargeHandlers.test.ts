/**
 * RechargeHandlers Unit Tests
 *
 * Tests IPC handler registration and delegation to RechargeService.
 */

import { ipcMain } from "electron";
import { registerRechargeHandlers } from "../rechargeHandlers";
import { getRechargeService } from "../../services";
import { requireRole } from "../../session";

// Mock dependencies
jest.mock("electron", () => ({
  ipcMain: {
    handle: jest.fn(),
  },
}));

jest.mock("../../services", () => ({
  getRechargeService: jest.fn(),
  resetRechargeService: jest.fn(),
}));

jest.mock("../../session", () => ({
  requireRole: jest.fn(),
}));

describe("RechargeHandlers", () => {
  let mockService: any;
  let handlers: Map<string, Function>;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();

    // Capture registered handlers
    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });

    // Mock service
    mockService = {
      getStock: jest.fn().mockReturnValue({ mtc: 500, alfa: 300 }),
      processRecharge: jest.fn().mockReturnValue({ success: true, saleId: 1 }),
    };
    (getRechargeService as jest.Mock).mockReturnValue(mockService);

    // Default: user is admin
    (requireRole as jest.Mock).mockReturnValue({ ok: true, userId: 1 });

    registerRechargeHandlers();
  });

  describe("Handler Registration", () => {
    it("should register all recharge handlers", () => {
      expect(ipcMain.handle).toHaveBeenCalledWith(
        "recharge:get-stock",
        expect.any(Function),
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        "recharge:process",
        expect.any(Function),
      );
    });
  });

  describe("recharge:get-stock", () => {
    it("should get virtual stock", async () => {
      const handler = handlers.get("recharge:get-stock")!;
      const result = await handler({});

      expect(mockService.getStock).toHaveBeenCalled();
      expect(result).toEqual({ mtc: 500, alfa: 300 });
    });

    it("should return zero stock when empty", async () => {
      mockService.getStock.mockReturnValue({ mtc: 0, alfa: 0 });

      const handler = handlers.get("recharge:get-stock")!;
      const result = await handler({});

      expect(result).toEqual({ mtc: 0, alfa: 0 });
    });
  });

  describe("recharge:process", () => {
    it("should process MTC recharge when admin", async () => {
      const handler = handlers.get("recharge:process")!;
      const rechargeData = {
        provider: "MTC",
        type: "CREDIT_TRANSFER",
        amount: 10,
        cost: 9,
        price: 10,
        phoneNumber: "03123456",
      };

      const result = await handler({ sender: { id: 1 } }, rechargeData);

      expect(requireRole).toHaveBeenCalledWith(1, ["admin"]);
      expect(mockService.processRecharge).toHaveBeenCalledWith(rechargeData);
      expect(result).toEqual({ success: true, saleId: 1 });
    });

    it("should process Alfa recharge", async () => {
      const handler = handlers.get("recharge:process")!;
      const rechargeData = {
        provider: "Alfa",
        type: "VOUCHER",
        amount: 20,
        cost: 18,
        price: 20,
      };

      const result = await handler({ sender: { id: 1 } }, rechargeData);

      expect(mockService.processRecharge).toHaveBeenCalledWith(rechargeData);
      expect(result).toEqual({ success: true, saleId: 1 });
    });

    it("should reject non-admin users", async () => {
      (requireRole as jest.Mock).mockReturnValue({
        ok: false,
        error: "Admin required",
      });

      const handler = handlers.get("recharge:process")!;
      const result = await handler({ sender: { id: 1 } }, { provider: "MTC" });

      expect(result).toEqual({ success: false, error: "Admin required" });
      expect(mockService.processRecharge).not.toHaveBeenCalled();
    });

    it("should handle insufficient stock error", async () => {
      mockService.processRecharge.mockReturnValue({
        success: false,
        error: "Insufficient stock",
      });

      const handler = handlers.get("recharge:process")!;
      const result = await handler(
        { sender: { id: 1 } },
        { provider: "MTC", amount: 1000 },
      );

      expect(result).toEqual({ success: false, error: "Insufficient stock" });
    });
  });
});
