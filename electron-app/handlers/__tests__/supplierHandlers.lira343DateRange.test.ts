/**
 * LIRA-343 T033a (FR-016c) — desktop (IPC) side of the supplier
 * Transactions window's server-side day range. The range is an optional
 * LAST argument on three raw-shape reads:
 *  - suppliers:all-transactions      (provider, limit?, range?)
 *  - suppliers:account-transactions  (accountSupplierId, limit?, range?)  — new
 *  - suppliers:account-ledger        (accountSupplierId, limit?, range?)
 * validated with the SAME core schema as the REST routes
 * (`supplierDayRangeSchema`, rule 14). Raw-shape reads (the renderer expects
 * the array, never an envelope), so an invalid range REJECTS the invoke
 * promise, like suppliers:account-month-rows. No range → the service is
 * called exactly as before.
 */
import { ipcMain } from "electron";
import { registerSupplierHandlers } from "../supplierHandlers";
import { getSupplierService, getFinancialService } from "@liratek/core";
import { requireRole } from "../../session";

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn() },
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    getSupplierService: jest.fn(),
    getFinancialService: jest.fn(),
  };
});

jest.mock("../../session", () => ({
  requireRole: jest.fn(),
}));

jest.mock("../auditHelper", () => ({
  audit: jest.fn(),
}));

describe("supplierHandlers — LIRA-343 T033a day range", () => {
  let handlers: Map<string, (...args: unknown[]) => unknown>;
  const rows = [{ id: 1 }];
  const supplierService = { getAccountLedger: jest.fn().mockReturnValue(rows) };
  const financialService = {
    getAllByProvider: jest.fn().mockReturnValue(rows),
    getAllByAccount: jest.fn().mockReturnValue(rows),
  };
  const event = { sender: { id: 1 } };

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();
    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });
    (getSupplierService as jest.Mock).mockReturnValue(supplierService);
    (getFinancialService as jest.Mock).mockReturnValue(financialService);
    registerSupplierHandlers();
  });

  const call = (channel: string, ...args: unknown[]) =>
    Promise.resolve().then(() => {
      const h = handlers.get(channel);
      if (!h) throw new Error(`no handler for ${channel}`);
      return h(event, ...args);
    });

  const range = { from: "2026-10-01", to: "2026-10-25" };

  it("all-transactions forwards (provider, limit, range)", async () => {
    const r = await call("suppliers:all-transactions", "OMT", 50, range);
    expect(financialService.getAllByProvider).toHaveBeenCalledWith("OMT", 50, range);
    expect(r).toBe(rows);
  });

  it("account-transactions forwards (id, limit, range) to getAllByAccount, ungated", async () => {
    const r = await call("suppliers:account-transactions", 3, undefined, range);
    expect(financialService.getAllByAccount).toHaveBeenCalledWith(3, undefined, range);
    expect(r).toBe(rows);
    expect(requireRole).not.toHaveBeenCalled();
  });

  it("account-ledger forwards (id, limit, range)", async () => {
    await call("suppliers:account-ledger", 3, 20, { from: "2026-10-01" });
    expect(supplierService.getAccountLedger).toHaveBeenCalledWith(3, 20, {
      from: "2026-10-01",
    });
  });

  it("no range → the service gets undefined, exactly as before", async () => {
    await call("suppliers:all-transactions", "OMT");
    expect(financialService.getAllByProvider).toHaveBeenCalledWith(
      "OMT",
      undefined,
      undefined,
    );
  });

  it.each([
    ["suppliers:all-transactions", "OMT"],
    ["suppliers:account-transactions", 3],
    ["suppliers:account-ledger", 3],
  ] as const)("%s rejects a bad range without calling the service", async (channel, first) => {
    await expect(
      call(channel, first, undefined, { from: "2026-10-31", to: "2026-10-01" }),
    ).rejects.toThrow(/Validation failed/);
    await expect(call(channel, first, undefined, { from: "2026-13-01" })).rejects.toThrow(
      /Validation failed/,
    );
    expect(financialService.getAllByProvider).not.toHaveBeenCalled();
    expect(financialService.getAllByAccount).not.toHaveBeenCalled();
    expect(supplierService.getAccountLedger).not.toHaveBeenCalled();
  });
});
