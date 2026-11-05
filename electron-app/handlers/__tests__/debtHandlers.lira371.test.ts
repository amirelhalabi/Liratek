/**
 * LIRA-371 — `debt:add-repayment` carries `cashDrawer` to
 * DebtService.addRepayment and refuses a bad value (shared addRepaymentSchema).
 * Parity check: the handler spreads the validated data, so this may pass
 * before any service change ("parity check, not proven failing-first").
 */
import { ipcMain } from "electron";
import { registerDebtHandlers } from "../debtHandlers";
import { getDebtService } from "@liratek/core";
import { requireRole } from "../../session";

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn() },
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return { ...actual, getDebtService: jest.fn() };
});

jest.mock("../../session", () => ({
  requireRole: jest.fn(),
}));

jest.mock("../auditHelper", () => ({
  audit: jest.fn(),
}));

describe("debtHandlers — LIRA-371 cashDrawer", () => {
  let handlers: Map<string, (...args: unknown[]) => unknown>;
  const service = {
    addRepayment: jest.fn().mockReturnValue({ success: true, id: 3 }),
  };
  const event = { sender: { id: 1 } };

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();
    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });
    (getDebtService as jest.Mock).mockReturnValue(service);
    (requireRole as jest.Mock).mockReturnValue({ ok: true, userId: 9 });
    registerDebtHandlers();
  });

  const call = (data: unknown) =>
    Promise.resolve().then(() =>
      handlers.get("debt:add-repayment")!(event, data),
    );

  it("forwards cashDrawer GENERAL to the service", async () => {
    const r = await call({
      clientId: 7,
      amountUSD: 200,
      amountLBP: 0,
      cashDrawer: "GENERAL",
    });
    expect(r).toEqual({ success: true, id: 3 });
    expect(service.addRepayment).toHaveBeenCalledWith(
      expect.objectContaining({ cashDrawer: "GENERAL", userId: 9 }),
    );
  });

  it("refuses cashDrawer OMT and never reaches the service", async () => {
    const r = (await call({
      clientId: 7,
      amountUSD: 200,
      amountLBP: 0,
      cashDrawer: "OMT",
    })) as { success: boolean };
    expect(r.success).toBe(false);
    expect(service.addRepayment).not.toHaveBeenCalled();
  });
});
