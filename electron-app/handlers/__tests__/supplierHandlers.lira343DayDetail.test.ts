/**
 * LIRA-343 (T032, contracts/calendar-reads.md §3) — `suppliers:account-day-detail`,
 * desktop (IPC) side.
 *
 * Same gate as `suppliers:account-unsettled`: a read with no role check
 * (REST mirrors it with `requireAuth` only). The day is checked with the
 * shared core `accountDaySchema` (rule 14). It is a RAW-shape read (the
 * renderer expects the rows array, never an envelope), so an invalid day
 * REJECTS the invoke promise — the same treatment as account-month-rows.
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

describe("supplierHandlers — LIRA-343 suppliers:account-day-detail", () => {
  let handlers: Map<string, (...args: unknown[]) => unknown>;
  const rows = [
    { id: 1, shop_day: "2026-10-21", settlements: [], added_after_settlement: false },
  ];
  const service = {
    getAccountDayDetail: jest.fn().mockReturnValue(rows),
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
    Promise.resolve().then(() => {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`channel ${channel} is not registered`);
      return handler(event, ...args);
    });

  it("forwards (id, shopDay) and returns the raw rows array", async () => {
    const r = await call("suppliers:account-day-detail", 7, "2026-10-21");
    expect(service.getAccountDayDetail).toHaveBeenCalledWith(7, "2026-10-21");
    expect(r).toBe(rows);
  });

  it("is ungated like suppliers:account-unsettled (no role check)", async () => {
    await call("suppliers:account-day-detail", 7, "2026-10-21");
    expect(requireRole).not.toHaveBeenCalled();
  });

  it.each(["2026-10", "2026-1-21", "21/10/2026", "", undefined, 20261021])(
    "rejects day %p without calling the service",
    async (bad) => {
      await expect(
        call("suppliers:account-day-detail", 7, bad),
      ).rejects.toThrow(/Validation failed: day/);
      expect(service.getAccountDayDetail).not.toHaveBeenCalled();
    },
  );
});
