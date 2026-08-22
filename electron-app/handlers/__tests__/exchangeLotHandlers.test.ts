/**
 * ExchangeLotHandlers Unit Tests (EXCHANGE_LOT_SETTLEMENT.md Phase 4a).
 *
 * Tests IPC handler registration, envelope shape, the admin-only role gate
 * on `exchange-lots:adjust` (Q15), and Zod validation rejection at the IPC
 * door.
 *
 * Unlike the pre-existing handler tests in this folder (which mock
 * `"../../services"` while the real handlers under test import their
 * service/repo getters from `"@liratek/core"` directly — see
 * `exchangeHandlers.test.ts` vs `exchangeHandlers.ts`'s actual import, a
 * mismatch that leaves those tests exercising the REAL, un-mocked service
 * against no database rather than the intended mock; consistent with
 * `electron-app/jest.config.cjs`'s own header noting this whole folder is
 * "pre-existing, already orphaned from any runner"), this file mocks
 * `"@liratek/core"` via `jest.requireActual` + override so the schemas this
 * handler validates against (`previewLotSettlementSchema`/
 * `lotBreakdownSchema`/`adjustLotPositionSchema`, re-exported through
 * `../schemas/index.js`) stay REAL — validation-rejection tests exercise
 * actual Zod, not a stub — while only the service/repo getters are
 * replaced with mocks.
 */

import { ipcMain } from "electron";
import { registerExchangeLotHandlers } from "../exchangeLotHandlers";
import { getExchangeLotService, getUserRepository } from "@liratek/core";
import { requireRole } from "../../session";
import { audit } from "../auditHelper";

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn() },
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    getExchangeLotService: jest.fn(),
    getUserRepository: jest.fn(),
  };
});

jest.mock("../../session", () => ({
  requireRole: jest.fn(),
}));

jest.mock("../auditHelper", () => ({
  audit: jest.fn(),
}));

describe("ExchangeLotHandlers", () => {
  // A SINGLE persistent mock object, never reassigned across tests —
  // `exchangeLotHandlers.ts`'s `getExchangeLotServiceInstance()` caches
  // whatever `getExchangeLotService()` returns on its FIRST call at module
  // scope (by design — the real service is a true singleton for the life
  // of the app). Reassigning `mockService` to a fresh object in every
  // `beforeEach` (as the pre-existing, orphaned tests in this folder do)
  // would leave every test after the first exercising a stale, long-cached
  // reference instead of that test's own mock — `jest.clearAllMocks()`
  // clears call history, not the object identity, so keeping ONE object
  // and only reconfiguring its `jest.fn()`s per test is what makes the
  // cached-singleton handler actually testable.
  const mockService = {
    previewSettlement: jest.fn(),
    getPositions: jest.fn(),
    getBreakdown: jest.fn(),
    adjustPosition: jest.fn(),
  };
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();

    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });

    (getExchangeLotService as jest.Mock).mockReturnValue(mockService);
    (getUserRepository as jest.Mock).mockReturnValue({
      findById: jest.fn().mockReturnValue({ username: "alice" }),
    });
    (requireRole as jest.Mock).mockReturnValue({ ok: true, userId: 7 });

    registerExchangeLotHandlers();
  });

  describe("Handler Registration", () => {
    it("registers all four exchange-lots channels", () => {
      expect(ipcMain.handle).toHaveBeenCalledWith(
        "exchange-lots:preview",
        expect.any(Function),
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        "exchange-lots:positions",
        expect.any(Function),
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        "exchange-lots:breakdown",
        expect.any(Function),
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        "exchange-lots:adjust",
        expect.any(Function),
      );
    });
  });

  describe("exchange-lots:preview", () => {
    it("validates the payload, then delegates to the service and returns its result verbatim", async () => {
      mockService.previewSettlement.mockReturnValue({
        success: true,
        lotTracked: true,
        marketUnitCostUsd: 1.18,
        settlements: [],
        realizedProfitUsd: 0,
        coveredQty: 10,
        marketQty: 0,
      });
      const handler = handlers.get("exchange-lots:preview")!;

      const result = await handler(
        {},
        { currencyCode: "EUR", qty: 10, unitProceedsUsd: 1.19 },
      );

      expect(mockService.previewSettlement).toHaveBeenCalledWith({
        currencyCode: "EUR",
        qty: 10,
        unitProceedsUsd: 1.19,
      });
      expect(result).toEqual({
        success: true,
        lotTracked: true,
        marketUnitCostUsd: 1.18,
        settlements: [],
        realizedProfitUsd: 0,
        coveredQty: 10,
        marketQty: 0,
      });
    });

    it("rejects an invalid payload (negative qty) at the door WITHOUT calling the service", async () => {
      const handler = handlers.get("exchange-lots:preview")!;

      const result = await handler(
        {},
        { currencyCode: "EUR", qty: -5, unitProceedsUsd: 1.19 },
      );

      expect(mockService.previewSettlement).not.toHaveBeenCalled();
      expect((result as { success: boolean }).success).toBe(false);
      expect((result as { error: string }).error).toEqual(
        expect.stringContaining("Validation failed"),
      );
    });
  });

  describe("exchange-lots:positions", () => {
    it("wraps the service's array result in { success, data }", async () => {
      mockService.getPositions.mockReturnValue([
        { currency_code: "EUR", open_qty: 5 },
      ]);
      const handler = handlers.get("exchange-lots:positions")!;

      const result = await handler({});

      expect(result).toEqual({
        success: true,
        data: [{ currency_code: "EUR", open_qty: 5 }],
      });
    });
  });

  describe("exchange-lots:breakdown", () => {
    it("validates exchangeId, then wraps the service's result in { success, data }", async () => {
      mockService.getBreakdown.mockReturnValue({
        asSettler: [],
        againstSource: [{ id: 1 }],
      });
      const handler = handlers.get("exchange-lots:breakdown")!;

      const result = await handler({}, { exchangeId: 42 });

      expect(mockService.getBreakdown).toHaveBeenCalledWith(42);
      expect(result).toEqual({
        success: true,
        data: { asSettler: [], againstSource: [{ id: 1 }] },
      });
    });

    it("rejects a non-positive exchangeId at the door WITHOUT calling the service", async () => {
      const handler = handlers.get("exchange-lots:breakdown")!;

      const result = await handler({}, { exchangeId: 0 });

      expect(mockService.getBreakdown).not.toHaveBeenCalled();
      expect((result as { success: boolean }).success).toBe(false);
    });
  });

  describe("exchange-lots:adjust — Q15 admin-only gate", () => {
    it("rejects a non-admin caller WITHOUT calling the service", async () => {
      (requireRole as jest.Mock).mockReturnValue({
        ok: false,
        error: "Forbidden",
      });
      const handler = handlers.get("exchange-lots:adjust")!;

      const result = await handler(
        { sender: { id: 1 } },
        { currencyCode: "EUR", qty: 100, unitCostUsd: 1.1 },
      );

      expect(requireRole).toHaveBeenCalledWith(1, ["admin"]);
      expect(mockService.adjustPosition).not.toHaveBeenCalled();
      expect(result).toEqual({ success: false, error: "Forbidden" });
    });

    it("rejects an invalid payload (qty === 0) at the door WITHOUT calling the service", async () => {
      const handler = handlers.get("exchange-lots:adjust")!;

      const result = await handler(
        { sender: { id: 1 } },
        { currencyCode: "EUR", qty: 0 },
      );

      expect(mockService.adjustPosition).not.toHaveBeenCalled();
      expect((result as { success: boolean }).success).toBe(false);
    });

    it("derives createdBy from the acting user's username (never the client) and audits on success", async () => {
      mockService.adjustPosition.mockReturnValue({
        success: true,
        data: { adjustment: { id: 9 } },
      });
      const handler = handlers.get("exchange-lots:adjust")!;

      const result = await handler(
        { sender: { id: 1 } },
        { currencyCode: "EUR", qty: 100, unitCostUsd: 1.1 },
      );

      expect(mockService.adjustPosition).toHaveBeenCalledWith(
        { currencyCode: "EUR", qty: 100, unitCostUsd: 1.1 },
        "alice",
      );
      expect(result).toEqual({
        success: true,
        data: { adjustment: { id: 9 } },
      });
      expect(audit).toHaveBeenCalledTimes(1);
    });

    it("does not audit when the service reports failure", async () => {
      mockService.adjustPosition.mockReturnValue({
        success: false,
        error: "cannot write off 100 EUR — only 10 is open",
      });
      const handler = handlers.get("exchange-lots:adjust")!;

      await handler(
        { sender: { id: 1 } },
        { currencyCode: "EUR", qty: -100 },
      );

      expect(audit).not.toHaveBeenCalled();
    });
  });
});
