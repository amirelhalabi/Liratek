/**
 * NOT RUN — proven at the end-of-batch gate.
 *
 * carrierLineHandlers.ts — the two "days still to send" IPC channels (v184,
 * #28, LIRA-218): `carrier-lines:get-owed-deliveries-pending` (read, no
 * role gate) and `carrier-lines:mark-owed-delivery-sent` (admin/staff,
 * validated, actor from the authenticated session — never the payload).
 * Closes the m4/both-transports gap the 2026-09-24 adversarial review
 * found: zero IPC-handler coverage existed for either channel.
 *
 * Mirrors `profitHandlers.commissions.test.ts`'s own harness (mocked
 * `electron`, `@liratek/core`, `../../session`) — no real DB, no real
 * Electron. `../schemas/index.js` is kept REAL (`jest.requireActual`) so
 * the "rejects an invalid deliveryId" test proves the channel's validation
 * against the real Zod contract, not a stub that would let anything through.
 */

import { ipcMain } from "electron";
import { registerCarrierLineHandlers } from "../carrierLineHandlers";
import { getCarrierLineService } from "@liratek/core";
import { requireRole } from "../../session";

jest.mock("electron", () => ({
  ipcMain: {
    handle: jest.fn(),
  },
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    getCarrierLineService: jest.fn(),
    getCarrierLineRepository: jest.fn(() => ({})),
  };
});

jest.mock("../../session", () => ({
  requireRole: jest.fn(),
}));

jest.mock("../auditHelper", () => ({
  audit: jest.fn(),
}));

describe("carrierLineHandlers — days-still-to-send channels (#28, LIRA-218)", () => {
  let mockService: {
    getPendingOwedDeliveries: jest.Mock;
    markOwedDeliverySent: jest.Mock;
  };
  let handlers: Map<string, (...args: any[]) => unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();

    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });

    mockService = {
      getPendingOwedDeliveries: jest.fn().mockReturnValue({
        success: true,
        data: [{ id: 1, carrier_line_id: 1, days_owed: 210, status: "PENDING" }],
      }),
      markOwedDeliverySent: jest.fn().mockReturnValue({
        success: true,
        data: { id: 1, carrier_line_id: 1, days_owed: 210, status: "SENT" },
      }),
    };
    (getCarrierLineService as jest.Mock).mockReturnValue(mockService);
    (requireRole as jest.Mock).mockReturnValue({ ok: true, userId: 42 });

    registerCarrierLineHandlers();
  });

  it("registers both channels", () => {
    expect(ipcMain.handle).toHaveBeenCalledWith(
      "carrier-lines:get-owed-deliveries-pending",
      expect.any(Function),
    );
    expect(ipcMain.handle).toHaveBeenCalledWith(
      "carrier-lines:mark-owed-delivery-sent",
      expect.any(Function),
    );
  });

  it("get-owed-deliveries-pending: no role gate — returns the service's result unchanged", () => {
    const handler = handlers.get("carrier-lines:get-owed-deliveries-pending")!;
    const result = handler();

    expect(requireRole).not.toHaveBeenCalled();
    expect(mockService.getPendingOwedDeliveries).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      success: true,
      data: [{ id: 1, carrier_line_id: 1, days_owed: 210, status: "PENDING" }],
    });
  });

  it("mark-owed-delivery-sent: gates on requireRole(['admin','staff']) and forwards the deliveryId + JWT-session userId, never a userId from the payload", () => {
    const handler = handlers.get("carrier-lines:mark-owed-delivery-sent")!;
    const fakeEvent = { sender: { id: 7 } };

    const result = handler(fakeEvent, { deliveryId: 1, userId: 999 });

    expect(requireRole).toHaveBeenCalledWith(7, ["admin", "staff"]);
    // 42 = requireRole's own resolved auth.userId (the session's actor) —
    // 999 (smuggled on the payload) must never reach the service.
    expect(mockService.markOwedDeliverySent).toHaveBeenCalledWith(1, 42);
    expect(result).toEqual({
      success: true,
      data: { id: 1, carrier_line_id: 1, days_owed: 210, status: "SENT" },
    });
  });

  it("mark-owed-delivery-sent: refuses when the role gate rejects, never touching the service", () => {
    (requireRole as jest.Mock).mockReturnValue({
      ok: false,
      error: "Forbidden",
    });
    const handler = handlers.get("carrier-lines:mark-owed-delivery-sent")!;

    const result = handler({ sender: { id: 7 } }, { deliveryId: 1 });

    expect(result).toEqual({ success: false, error: "Forbidden" });
    expect(mockService.markOwedDeliverySent).not.toHaveBeenCalled();
  });

  it("mark-owed-delivery-sent: rejects an invalid deliveryId through the REAL shared schema, never touching the service", () => {
    const handler = handlers.get("carrier-lines:mark-owed-delivery-sent")!;

    const result = handler(
      { sender: { id: 7 } },
      { deliveryId: -1 },
    ) as { success: boolean; error?: string };

    expect(result.success).toBe(false);
    expect(mockService.markOwedDeliverySent).not.toHaveBeenCalled();
  });
});
