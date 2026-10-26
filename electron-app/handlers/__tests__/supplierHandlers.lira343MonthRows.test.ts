/**
 * LIRA-343 (T014, contracts/calendar-reads.md §1) — `suppliers:account-month-rows`,
 * desktop (IPC) side.
 *
 * Same gate as `suppliers:account-unsettled`: a read with no role check
 * (REST mirrors it with `requireAuth` only). It is a RAW-shape read (the
 * renderer expects the rows array, never an envelope), so an invalid month
 * REJECTS the invoke promise instead of returning `{ success: false }` —
 * the same treatment as `suppliers:account-expected-statement`.
 */
import { ipcMain } from "electron";
import { registerSupplierHandlers } from "../supplierHandlers";
import { getSupplierService } from "@liratek/core";
import { requireRole } from "../../session";

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn() },
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    getSupplierService: jest.fn(),
    getFinancialService: jest.fn(() => ({})),
  };
});

jest.mock("../../session", () => ({
  requireRole: jest.fn(),
}));

jest.mock("../auditHelper", () => ({
  audit: jest.fn(),
}));

describe("supplierHandlers — LIRA-343 suppliers:account-month-rows", () => {
  let handlers: Map<string, (...args: unknown[]) => unknown>;
  const rows = [{ id: 1, shop_day: "2026-10-05" }];
  const service = {
    getAccountMonthRows: jest.fn().mockReturnValue(rows),
  };
  const event = { sender: { id: 1 } };

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();
    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });
    (getSupplierService as jest.Mock).mockReturnValue(service);
    registerSupplierHandlers();
  });

  const call = (channel: string, ...args: unknown[]) =>
    Promise.resolve().then(() => handlers.get(channel)!(event, ...args));

  it("forwards (id, month) and returns the raw rows array", async () => {
    const r = await call("suppliers:account-month-rows", 7, "2026-10");
    expect(service.getAccountMonthRows).toHaveBeenCalledWith(7, "2026-10");
    expect(r).toBe(rows);
  });

  it("is ungated like suppliers:account-unsettled (no role check)", async () => {
    await call("suppliers:account-month-rows", 7, "2026-10");
    expect(requireRole).not.toHaveBeenCalled();
  });

  it.each(["2026-13", "2026-1", "2026-10-01", "", undefined, 202610])(
    "rejects month %p without calling the service",
    async (bad) => {
      await expect(
        call("suppliers:account-month-rows", 7, bad),
      ).rejects.toThrow(/Validation failed: month/);
      expect(service.getAccountMonthRows).not.toHaveBeenCalled();
    },
  );
});
