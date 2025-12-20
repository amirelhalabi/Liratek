/**
 * RateHandlers Unit Tests
 *
 * Tests IPC handler registration and delegation to RateService.
 */

import { ipcMain } from "electron";
import { registerRateHandlers } from "../rateHandlers";
import { getRateService } from "../../services";
import { requireRole } from "../../session";

// Mock dependencies
jest.mock("electron", () => ({
  ipcMain: {
    handle: jest.fn(),
  },
}));

jest.mock("../../services", () => ({
  getRateService: jest.fn(),
  resetRateService: jest.fn(),
}));

jest.mock("../../session", () => ({
  requireRole: jest.fn(),
}));

describe("RateHandlers", () => {
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
      listRates: jest
        .fn()
        .mockReturnValue([
          { id: 1, from_code: "USD", to_code: "LBP", rate: 90000 },
        ]),
      setRate: jest.fn().mockReturnValue({ success: true }),
    };
    (getRateService as jest.Mock).mockReturnValue(mockService);

    // Default: user is admin
    (requireRole as jest.Mock).mockReturnValue({ ok: true, userId: 1 });

    registerRateHandlers();
  });

  describe("Handler Registration", () => {
    it("should register all rate handlers", () => {
      expect(ipcMain.handle).toHaveBeenCalledWith(
        "rates:list",
        expect.any(Function),
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        "rates:set",
        expect.any(Function),
      );
    });
  });

  describe("rates:list", () => {
    it("should list all rates", async () => {
      const handler = handlers.get("rates:list")!;
      const result = await handler({});

      expect(mockService.listRates).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].rate).toBe(90000);
    });

    it("should return empty array when no rates", async () => {
      mockService.listRates.mockReturnValue([]);

      const handler = handlers.get("rates:list")!;
      const result = await handler({});

      expect(result).toEqual([]);
    });
  });

  describe("rates:set", () => {
    it("should set a rate when admin", async () => {
      const handler = handlers.get("rates:set")!;
      const rateData = {
        from_code: "USD",
        to_code: "LBP",
        rate: 95000,
      };

      const result = await handler({ sender: { id: 1 } }, rateData);

      expect(requireRole).toHaveBeenCalledWith(1, ["admin"]);
      expect(mockService.setRate).toHaveBeenCalledWith(rateData);
      expect(result).toEqual({ success: true });
    });

    it("should reject non-admin users", async () => {
      (requireRole as jest.Mock).mockReturnValue({
        ok: false,
        error: "Admin required",
      });

      const handler = handlers.get("rates:set")!;
      const result = await handler({ sender: { id: 1 } }, { from_code: "USD" });

      expect(result).toEqual({ success: false, error: "Admin required" });
      expect(mockService.setRate).not.toHaveBeenCalled();
    });

    it("should handle service errors", async () => {
      mockService.setRate.mockReturnValue({
        success: false,
        error: "Invalid rate",
      });

      const handler = handlers.get("rates:set")!;
      const result = await handler({ sender: { id: 1 } }, { from_code: "USD" });

      expect(result).toEqual({ success: false, error: "Invalid rate" });
    });
  });
});
