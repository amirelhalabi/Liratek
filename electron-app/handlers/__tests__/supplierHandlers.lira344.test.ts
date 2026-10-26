/**
 * LIRA-344 — `suppliers:remove-account-credit`, desktop (IPC) side:
 * admin only, the shared core schema in front (reason 3–200), every schema
 * key forwarded (rules 23/24 — names read from the schema), the actor from
 * the session (never the payload), audited only when written.
 *
 * Not proven failing-first: written after the handler.
 */
import { ipcMain } from "electron";
import { registerSupplierHandlers } from "../supplierHandlers";
import { getSupplierService, removeAccountCreditSchema } from "@liratek/core";
import { requireRole } from "../../session";
import { audit } from "../auditHelper";

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

describe("supplierHandlers — LIRA-344 remove-account-credit", () => {
  let handlers: Map<string, (...args: unknown[]) => unknown>;
  const service = {
    removeAccountCredit: jest
      .fn()
      .mockReturnValue({
        success: true,
        id: 5,
        transaction_id: 77,
        expense_id: 9,
      }),
  };
  const event = { sender: { id: 1 } };
  const payload = {
    account_supplier_id: 28,
    ledger_row_id: 91,
    reason: "OMT never accepts this credit",
    expected_remaining: { usd: -40, lbp: 0 },
    client_day: "2026-10-26",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();
    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });
    (getSupplierService as jest.Mock).mockReturnValue(service);
    (requireRole as jest.Mock).mockReturnValue({ ok: true, userId: 9 });
    registerSupplierHandlers();
  });

  const call = (data: unknown) =>
    Promise.resolve().then(() =>
      handlers.get("suppliers:remove-account-credit")!(event, data),
    );

  it("is admin only", async () => {
    (requireRole as jest.Mock).mockReturnValueOnce({
      ok: false,
      error: "Forbidden",
    });
    const r = await call(payload);
    expect(r).toEqual({ success: false, error: "Forbidden" });
    expect(requireRole).toHaveBeenCalledWith(1, ["admin"]);
    expect(service.removeAccountCredit).not.toHaveBeenCalled();
  });

  it("refuses a too-short reason before the service", async () => {
    const r = (await call({ ...payload, reason: "no" })) as {
      success: boolean;
    };
    expect(r.success).toBe(false);
    expect(service.removeAccountCredit).not.toHaveBeenCalled();
  });

  it("forwards every schema key, actor from the session, and audits", async () => {
    const r = await call({ ...payload, created_by: 999 });
    expect(r).toEqual({
      success: true,
      id: 5,
      transaction_id: 77,
      expense_id: 9,
    });
    const forwarded = service.removeAccountCredit.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    for (const key of Object.keys(removeAccountCreditSchema.shape)) {
      expect(forwarded).toHaveProperty(key);
    }
    expect(forwarded.created_by).toBe(9);
    expect(audit).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ action: "remove_credit", entity_id: "77" }),
    );
  });

  it("does not audit a refusal", async () => {
    service.removeAccountCredit.mockReturnValueOnce({
      success: false,
      error: "This OMT credit is no longer open",
    });
    await call(payload);
    expect(audit).not.toHaveBeenCalled();
  });
});
