/**
 * LIRA-296 P3 (T050, T051) — IPC: warranty:supplier-return-create,
 * warranty:supplier-return-close, warranty:supplier-returns and
 * warranty:report. All admin. The actor comes from the session, never the
 * payload; payloads are validated by the shared core schemas.
 */
import { ipcMain } from "electron";
import { registerWarrantyHandlers } from "../warrantyHandlers";
import { getWarrantyService } from "@liratek/core";
import { requireRole } from "../../session";

jest.mock("electron", () => ({ ipcMain: { handle: jest.fn() } }));
jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return { ...actual, getWarrantyService: jest.fn() };
});
jest.mock("../../session", () => ({ requireRole: jest.fn() }));
jest.mock("../auditHelper", () => ({ audit: jest.fn() }));

describe("warranty supplier-return and report IPC channels (LIRA-296 P3)", () => {
  let handlers: Map<string, (...args: any[]) => any>;
  const svc = {
    createSupplierReturn: jest.fn(),
    closeSupplierReturn: jest.fn(),
    listSupplierReturns: jest.fn(),
    report: jest.fn(),
  };
  const ev = { sender: { id: 3 } };

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();
    (ipcMain.handle as jest.Mock).mockImplementation((c, f) =>
      handlers.set(c, f),
    );
    (getWarrantyService as jest.Mock).mockReturnValue(svc);
    (requireRole as jest.Mock).mockReturnValue({
      ok: true,
      userId: 1,
      role: "admin",
    });
    registerWarrantyHandlers();
  });

  it("warranty:supplier-return-create — admin, validated, actor from the session", () => {
    svc.createSupplierReturn.mockReturnValue({ success: true, data: { id: 5 } });
    const res = handlers.get("warranty:supplier-return-create")!(ev, {
      defective_item_id: 2,
      notes: "dead",
      user_id: 999,
    });
    expect(requireRole).toHaveBeenCalledWith(3, ["admin"]);
    expect(svc.createSupplierReturn).toHaveBeenCalledWith(
      { defective_item_id: 2, notes: "dead" },
      { userId: 1, role: "admin" },
    );
    expect(res).toEqual({ success: true, data: { id: 5 } });
  });

  it("warranty:supplier-return-close — admin; CREDITED without a credit is refused before the service", () => {
    const bad = handlers.get("warranty:supplier-return-close")!(ev, {
      supplier_return_id: 5,
      outcome: "CREDITED",
    });
    expect(bad.success).toBe(false);
    expect(svc.closeSupplierReturn).not.toHaveBeenCalled();

    svc.closeSupplierReturn.mockReturnValue({
      success: true,
      data: { id: 5, status: "CREDITED" },
    });
    handlers.get("warranty:supplier-return-close")!(ev, {
      supplier_return_id: 5,
      outcome: "CREDITED",
      credit_usd: 4,
    });
    expect(svc.closeSupplierReturn).toHaveBeenCalledWith(
      { supplier_return_id: 5, outcome: "CREDITED", credit_usd: 4 },
      { userId: 1, role: "admin" },
    );
    expect(requireRole).toHaveBeenCalledWith(3, ["admin"]);
  });

  it("warranty:supplier-returns — admin list", () => {
    svc.listSupplierReturns.mockReturnValue([{ id: 5 }]);
    expect(
      handlers.get("warranty:supplier-returns")!(ev, { status: "SENT" }),
    ).toEqual({ success: true, data: [{ id: 5 }] });
    expect(svc.listSupplierReturns).toHaveBeenCalledWith({ status: "SENT" });
    expect(requireRole).toHaveBeenCalledWith(3, ["admin"]);
  });

  it("warranty:report — admin, validated", () => {
    svc.report.mockReturnValue({ underWarranty: [], claims: { total: 0 } });
    expect(
      handlers.get("warranty:report")!(ev, {
        from: "2026-10-01",
        to: "2026-10-10",
        client_day: "2026-10-10",
      }),
    ).toEqual({
      success: true,
      data: { underWarranty: [], claims: { total: 0 } },
    });
    expect(requireRole).toHaveBeenCalledWith(3, ["admin"]);
    const bad = handlers.get("warranty:report")!(ev, {
      from: "2026-10-10",
      to: "2026-10-01",
      client_day: "2026-10-10",
    });
    expect(bad.success).toBe(false);
    expect(svc.report).toHaveBeenCalledTimes(1);
  });

  it("a role refusal never reaches the service", () => {
    (requireRole as jest.Mock).mockReturnValue({
      ok: false,
      error: "Forbidden",
    });
    for (const channel of [
      "warranty:supplier-return-create",
      "warranty:supplier-return-close",
      "warranty:supplier-returns",
      "warranty:report",
    ]) {
      expect(handlers.get(channel)!(ev, {})).toEqual({
        success: false,
        error: "Forbidden",
      });
    }
    expect(svc.createSupplierReturn).not.toHaveBeenCalled();
    expect(svc.closeSupplierReturn).not.toHaveBeenCalled();
    expect(svc.listSupplierReturns).not.toHaveBeenCalled();
    expect(svc.report).not.toHaveBeenCalled();
  });
});
