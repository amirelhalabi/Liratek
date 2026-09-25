/**
 * dashboard:get-profit-sales-chart / dashboard:get-net-profit-last-30-days —
 * DC-10/DC-11 (OWNER_NOTES_2026-09-21.md §7.2): both channels now validate
 * `client_day` against the shared `dashboardChartQuerySchema`/
 * `netProfitWindowQuerySchema` (rule 27) and forward the parsed day to
 * `SalesService.getChartData`/`getNetProfitLast30Days`. Mirrors
 * `salesHandlers.updateMetadataValidation.test.ts`'s mocking shape.
 *
 * Read-only handlers degrade a malformed `client_day` to `undefined`
 * (electron-app/CLAUDE.md: "read-only handlers — validation optional but
 * recommended") rather than refusing the read outright — proven below.
 */

import { ipcMain } from "electron";
import { registerSalesHandlers } from "../salesHandlers";
import { getSalesService, getUserRepository } from "@liratek/core";
import { requireRole } from "../../session";

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn() },
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    getSalesService: jest.fn(),
    getTransactionService: jest.fn(() => ({})),
    getUserRepository: jest.fn(),
  };
});

jest.mock("../../session", () => ({
  requireRole: jest.fn(),
}));

jest.mock("../auditHelper", () => ({
  audit: jest.fn(),
}));

describe("dashboard:get-profit-sales-chart / dashboard:get-net-profit-last-30-days validation (DC-10/DC-11)", () => {
  const mockService = {
    getChartData: jest.fn(),
    getNetProfitLast30Days: jest.fn(),
  };
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();

    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });

    (getSalesService as jest.Mock).mockReturnValue(mockService);
    (getUserRepository as jest.Mock).mockReturnValue({
      findById: jest.fn(() => null),
    });
    (requireRole as jest.Mock).mockReturnValue({ ok: true, userId: 7 });

    registerSalesHandlers();
  });

  describe("dashboard:get-profit-sales-chart", () => {
    it("forwards a valid client_day straight through to the service", async () => {
      mockService.getChartData.mockReturnValue([]);
      const handler = handlers.get("dashboard:get-profit-sales-chart")!;

      await handler({}, "Profit", "2026-09-24");

      expect(mockService.getChartData).toHaveBeenCalledWith(
        "Profit",
        "2026-09-24",
      );
    });

    it("a malformed client_day degrades to undefined — the read still succeeds", async () => {
      mockService.getChartData.mockReturnValue([]);
      const handler = handlers.get("dashboard:get-profit-sales-chart")!;

      await handler({}, "Sales", "not-a-date");

      expect(mockService.getChartData).toHaveBeenCalledWith(
        "Sales",
        undefined,
      );
    });

    it("no client_day at all forwards undefined (service falls back to clientDay()/localDay())", async () => {
      mockService.getChartData.mockReturnValue([]);
      const handler = handlers.get("dashboard:get-profit-sales-chart")!;

      await handler({}, "Sales");

      expect(mockService.getChartData).toHaveBeenCalledWith(
        "Sales",
        undefined,
      );
    });
  });

  describe("dashboard:get-net-profit-last-30-days", () => {
    it("forwards a valid client_day straight through to the service", async () => {
      mockService.getNetProfitLast30Days.mockReturnValue({
        netProfitUSD: 0,
        netProfitLBP: 0,
        fromDate: "2026-08-26",
        toDate: "2026-09-24",
      });
      const handler = handlers.get(
        "dashboard:get-net-profit-last-30-days",
      )!;

      await handler({}, "2026-09-24");

      expect(mockService.getNetProfitLast30Days).toHaveBeenCalledWith(
        "2026-09-24",
      );
    });

    it("a malformed client_day degrades to undefined — the read still succeeds", async () => {
      mockService.getNetProfitLast30Days.mockReturnValue({
        netProfitUSD: 0,
        netProfitLBP: 0,
        fromDate: "2026-08-26",
        toDate: "2026-09-24",
      });
      const handler = handlers.get(
        "dashboard:get-net-profit-last-30-days",
      )!;

      await handler({}, "garbage");

      expect(mockService.getNetProfitLast30Days).toHaveBeenCalledWith(
        undefined,
      );
    });
  });
});
