/**
 * LIRA-296 (T039) — IPC claim channels: warranty:claim, warranty:claims-for,
 * warranty:void-claim, warranty:defective, warranty:defective-resolve.
 * Roles mirror contracts/api.md (claim & history: admin+staff — the service
 * keeps REPLACE/REFUND admin-only; void and defective: admin). The actor
 * (id + role) comes from the session, never the payload. Real schemas.
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

describe("warranty claim IPC channels (LIRA-296)", () => {
  let handlers: Map<string, (...args: any[]) => any>;
  const svc = {
    search: jest.fn(),
    createClaim: jest.fn(),
    claimsFor: jest.fn(),
    voidClaim: jest.fn(),
    listDefective: jest.fn(),
    resolveDefective: jest.fn(),
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
      userId: 9,
      role: "staff",
    });
    registerWarrantyHandlers();
  });

  it("warranty:claim — admin+staff, validated, actor from the session", () => {
    svc.createClaim.mockReturnValue({
      success: true,
      data: { claim: { id: 1 } },
    });
    const res = handlers.get("warranty:claim")!(ev, {
      sale_item_id: 4,
      action: "REPAIR",
      client_day: "2026-10-10",
      user_id: 999,
    });
    expect(requireRole).toHaveBeenCalledWith(3, ["admin", "staff"]);
    expect(svc.createClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        sale_item_id: 4,
        action: "REPAIR",
        client_day: "2026-10-10",
      }),
      { userId: 9, role: "staff" },
    );
    expect(svc.createClaim.mock.calls[0][0]).not.toHaveProperty("user_id");
    expect(res).toEqual({ success: true, data: { claim: { id: 1 } } });
  });

  it("warranty:claim refuses an invalid payload before the service", () => {
    const res = handlers.get("warranty:claim")!(ev, {
      action: "REPAIR",
      client_day: "2026-10-10",
    });
    expect(res.success).toBe(false);
    expect(svc.createClaim).not.toHaveBeenCalled();
  });

  it("warranty:claims-for — admin+staff", () => {
    svc.claimsFor.mockReturnValue([{ id: 1 }]);
    expect(
      handlers.get("warranty:claims-for")!(ev, { sale_item_id: 4 }),
    ).toEqual({ success: true, data: [{ id: 1 }] });
    expect(requireRole).toHaveBeenCalledWith(3, ["admin", "staff"]);
  });

  it("warranty:void-claim — admin only", () => {
    svc.voidClaim.mockReturnValue({ success: true, data: { id: 1 } });
    (requireRole as jest.Mock).mockReturnValue({
      ok: true,
      userId: 1,
      role: "admin",
    });
    handlers.get("warranty:void-claim")!(ev, { claim_id: 1 });
    expect(requireRole).toHaveBeenCalledWith(3, ["admin"]);
    expect(svc.voidClaim).toHaveBeenCalledWith(
      { claim_id: 1 },
      { userId: 1, role: "admin" },
    );
  });

  it("warranty:defective and warranty:defective-resolve — admin only", () => {
    svc.listDefective.mockReturnValue([]);
    svc.resolveDefective.mockReturnValue({ success: true, data: { id: 2 } });
    (requireRole as jest.Mock).mockReturnValue({
      ok: true,
      userId: 1,
      role: "admin",
    });
    expect(handlers.get("warranty:defective")!(ev, { status: "HELD" })).toEqual(
      { success: true, data: [] },
    );
    expect(svc.listDefective).toHaveBeenCalledWith({ status: "HELD" });
    handlers.get("warranty:defective-resolve")!(ev, {
      defective_item_id: 2,
      outcome: "WRITE_OFF",
    });
    expect(svc.resolveDefective).toHaveBeenCalledWith(
      { defective_item_id: 2, outcome: "WRITE_OFF" },
      { userId: 1, role: "admin" },
    );
    expect(
      (requireRole as jest.Mock).mock.calls.every(
        (c) => JSON.stringify(c[1]) === '["admin"]',
      ),
    ).toBe(true);
  });

  it("a role refusal never reaches the service", () => {
    (requireRole as jest.Mock).mockReturnValue({
      ok: false,
      error: "Forbidden",
    });
    expect(handlers.get("warranty:void-claim")!(ev, { claim_id: 1 })).toEqual({
      success: false,
      error: "Forbidden",
    });
    expect(svc.voidClaim).not.toHaveBeenCalled();
  });
});
