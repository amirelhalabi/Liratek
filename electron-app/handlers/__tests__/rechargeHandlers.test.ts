/**
 * RechargeHandlers Unit Tests
 *
 * Tests IPC handler registration and delegation to RechargeService.
 *
 * Revived 2026-09-13: this suite used to mock a local "../../services" path
 * that never existed as an import in rechargeHandlers.ts's actual code — the
 * handler resolves getRechargeService() from "@liratek/core" directly — so
 * the mock silently missed and every call fell through to the REAL
 * RechargeService against no database ("Database not initialized. Call
 * initDatabase() first."), and `mockService.getStock`/`processRecharge` were
 * never called. Fixed by mocking "@liratek/core" itself (jest.requireActual +
 * override, the pattern established by exchangeLotHandlers.test.ts /
 * authHandlers.sessions.test.ts in this folder) so getRechargeService is
 * intercepted while the REAL RechargeSchema/validatePayload (from
 * "../schemas/index.js", untouched here) keep validating "recharge:process"
 * payloads exactly as production does.
 *
 * "recharge:process" also drifted on its OWN terms, independent of the mock
 * path: the handler runs `validatePayload(RechargeSchema, data)` and forwards
 * `{ ...v.data, userId }` to the service — not the raw input object. Zod
 * fills in this schema's defaults (`currency: "USD"`, `paid_by_method:
 * "CASH"`), so the object actually reaching the service always has MORE keys
 * than what the test payload declares. Assertions below now match that
 * merged shape instead of the raw input literal.
 */

import { ipcMain } from "electron";
import { registerRechargeHandlers } from "../rechargeHandlers";
import { getRechargeService } from "@liratek/core";
import { requireRole } from "../../session";

// Mock dependencies
jest.mock("electron", () => ({
  ipcMain: {
    handle: jest.fn(),
  },
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    getRechargeService: jest.fn(),
  };
});

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
      processRecharge: jest.fn().mockReturnValue({ success: true, id: 1 }),
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
      // The handler forwards `{ ...validatedData, userId }`, not the raw
      // input — RechargeSchema fills in `currency`/`paid_by_method` defaults
      // (rule 24 spirit: assert the schema's actual merged shape, not a
      // hand-copied literal).
      expect(mockService.processRecharge).toHaveBeenCalledWith({
        ...rechargeData,
        currency: "USD",
        paid_by_method: "CASH",
        userId: 1,
      });
      expect(result).toEqual({ success: true, id: 1 });
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

      expect(mockService.processRecharge).toHaveBeenCalledWith({
        ...rechargeData,
        currency: "USD",
        paid_by_method: "CASH",
        userId: 1,
      });
      // ASSERTION CHANGED: the mock (set up in beforeEach) has always
      // returned `{ success: true, id: 1 }` — never `saleId`. The handler
      // returns the service's result verbatim, so `saleId` here was already
      // wrong before this suite rotted; it never matched what the mock
      // actually produced. Corrected to the mock's real shape.
      expect(result).toEqual({ success: true, id: 1 });
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
      // ASSERTION CHANGED: the original payload (`{ provider: "MTC", amount:
      // 1000 }`) is missing `type`/`price`, both required by the REAL
      // RechargeSchema this handler validates against. With the mock now
      // correctly wired, that incomplete payload is caught by
      // `validatePayload` BEFORE the service is ever called, returning a
      // validation error instead of exercising the money path this test is
      // actually named for. Completed the payload (kept `amount: 1000` to
      // preserve the "large amount -> insufficient stock" intent) so it
      // reaches the mocked service.
      const result = await handler(
        { sender: { id: 1 } },
        { provider: "MTC", type: "CREDIT_TRANSFER", amount: 1000, price: 10 },
      );

      expect(result).toEqual({ success: false, error: "Insufficient stock" });
    });
  });
});
