/**
 * OMTHandlers Unit Tests
 *
 * Tests IPC handler registration and delegation to FinancialService.
 *
 * Revived 2026-09-13: three things had drifted since this suite was written —
 * (1) `omt:add-transaction` gained a `requireRole(event.sender.id, …)` gate
 *     that reads `event.sender.id`, while these tests still invoked
 *     handlers with a bare `{}` event, throwing `TypeError: Cannot read
 *     properties of undefined (reading 'id')`.
 * (2) `getFinancialService` is imported from "@liratek/core" (not a local
 *     "../../services" module — that mock target no longer matches
 *     anything omtHandlers.ts imports, so the old
 *     `jest.mock("../../services", …)` was silently mocking a module the
 *     handler never requires).
 * (3) the payload shape itself moved: `FinancialServiceSchema`
 *     (electron-app/schemas/index.ts) validates `amount`/`currency`/
 *     `commission`, not the old `amountUSD`/`amountLBP`/`commissionUSD`/
 *     `commissionLBP` fields this suite used to send — a payload in the old
 *     shape now fails validation before ever reaching the service. The
 *     handler also now stamps the authenticated `userId` onto the data it
 *     forwards to `addTransaction`.
 * `omt:get-history`/`omt:get-analytics` don't read `event` at all and don't
 * gain a role gate, so those two describe blocks are otherwise unchanged.
 */

import { ipcMain } from "electron";
import { registerOMTHandlers } from "../omtHandlers";
import { getFinancialService } from "@liratek/core";
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
    getFinancialService: jest.fn(),
  };
});

jest.mock("../../session", () => ({
  requireRole: jest.fn(),
}));

jest.mock("../auditHelper", () => ({
  audit: jest.fn(),
}));

describe("OMTHandlers", () => {
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
      addTransaction: jest.fn().mockReturnValue({ success: true, id: 1 }),
      getHistory: jest
        .fn()
        .mockReturnValue([
          { id: 1, provider: "OMT", service_type: "SEND", commission_usd: 5 },
        ]),
      getAnalytics: jest.fn().mockReturnValue({
        today: { commissionUSD: 100, commissionLBP: 0, count: 10 },
        month: { commissionUSD: 2500, commissionLBP: 500000, count: 250 },
        byProvider: [],
      }),
    };
    (getFinancialService as jest.Mock).mockReturnValue(mockService);

    // Default: user is admin (userId 7 — deliberately distinct from the
    // sender id used below).
    (requireRole as jest.Mock).mockReturnValue({ ok: true, userId: 7 });

    registerOMTHandlers();
  });

  describe("Handler Registration", () => {
    it("should register all OMT handlers", () => {
      expect(ipcMain.handle).toHaveBeenCalledWith(
        "omt:add-transaction",
        expect.any(Function),
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        "omt:get-history",
        expect.any(Function),
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        "omt:get-analytics",
        expect.any(Function),
      );
    });
  });

  describe("omt:add-transaction", () => {
    it("should add an OMT transaction", async () => {
      const handler = handlers.get("omt:add-transaction")!;
      const transactionData = {
        provider: "OMT",
        serviceType: "SEND",
        amount: 100,
        currency: "USD",
        commission: 5,
      };

      const result = await handler({ sender: { id: 1 } }, transactionData);

      expect(requireRole).toHaveBeenCalledWith(1, ["admin", "staff"]);
      expect(mockService.addTransaction).toHaveBeenCalledWith({
        ...transactionData,
        userId: 7,
      });
      expect(result).toEqual({ success: true, id: 1 });
    });

    it("should add a WHISH transaction", async () => {
      const handler = handlers.get("omt:add-transaction")!;
      const transactionData = {
        provider: "WHISH",
        serviceType: "RECEIVE",
        amount: 50,
        currency: "USD",
        commission: 3,
      };

      const result = await handler({ sender: { id: 1 } }, transactionData);

      expect(mockService.addTransaction).toHaveBeenCalledWith({
        ...transactionData,
        userId: 7,
      });
      expect(result).toEqual({ success: true, id: 1 });
    });

    it("should handle service errors", async () => {
      mockService.addTransaction.mockReturnValue({
        success: false,
        error: "Transaction failed",
      });

      const handler = handlers.get("omt:add-transaction")!;
      // A schema-valid payload — the old `{ provider: "OMT" }` fragment
      // this test used to send now fails FinancialServiceSchema validation
      // (missing serviceType/amount) before ever reaching the service,
      // which would prove the wrong thing (a validation error, not a
      // propagated service failure).
      const transactionData = {
        provider: "OMT",
        serviceType: "SEND",
        amount: 10,
      };
      const result = await handler({ sender: { id: 1 } }, transactionData);

      expect(result).toEqual({ success: false, error: "Transaction failed" });
    });
  });

  describe("omt:get-history", () => {
    it("should get all transaction history", async () => {
      const handler = handlers.get("omt:get-history")!;
      const result = await handler({}, undefined);

      expect(mockService.getHistory).toHaveBeenCalledWith(undefined);
      expect(result).toHaveLength(1);
      expect(result[0].provider).toBe("OMT");
    });

    it("should filter history by provider", async () => {
      const handler = handlers.get("omt:get-history")!;
      await handler({}, "WHISH");

      expect(mockService.getHistory).toHaveBeenCalledWith("WHISH");
    });
  });

  describe("omt:get-analytics", () => {
    it("should get analytics data", async () => {
      const handler = handlers.get("omt:get-analytics")!;
      const result = await handler({});

      expect(mockService.getAnalytics).toHaveBeenCalled();
      expect(result.today.commissionUSD).toBe(100);
      expect(result.month.count).toBe(250);
    });
  });
});
