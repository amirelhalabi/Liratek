/**
 * LIRA-147 — "sales:undo-item-refund" IPC channel
 * (`electron-app/handlers/salesHandlers.ts`): admin-only, real Zod
 * validation against the shared core schema (`saleUndoItemRefundSchema`,
 * rule 14 — same contract the REST route `POST /api/sales/undo-item-refund`
 * uses), forwarded to `SalesService.undoItemRefund`.
 *
 * Mirrors `salesHandlers.refundLegOverride.test.ts`'s mocking shape:
 * `../session.js`'s `requireRole` and `./auditHelper.js`'s `audit` are
 * mocked directly; `@liratek/core` keeps its REAL validators via
 * `jest.requireActual` so real Zod parsing runs.
 */

import { ipcMain } from "electron";
import { registerSalesHandlers } from "../salesHandlers";
import { getSalesService, getTransactionService } from "@liratek/core";
import { requireRole } from "../../session";
import { audit } from "../auditHelper";

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn() },
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    getSalesService: jest.fn(),
    getTransactionService: jest.fn(),
    getUserRepository: jest.fn(),
  };
});

jest.mock("../../session", () => ({
  requireRole: jest.fn(),
}));

jest.mock("../auditHelper", () => ({
  audit: jest.fn(),
}));

describe("sales:undo-item-refund — LIRA-147 admin-only undo refund", () => {
  const mockSalesService = {
    undoItemRefund: jest.fn(),
  };
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();

    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });

    (getSalesService as jest.Mock).mockReturnValue(mockSalesService);
    (getTransactionService as jest.Mock).mockReturnValue({});
    (requireRole as jest.Mock).mockReturnValue({ ok: true, userId: 7 });

    registerSalesHandlers();
  });

  it("is registered on the expected channel", () => {
    expect(handlers.has("sales:undo-item-refund")).toBe(true);
  });

  it("validates the payload with the real core schema and forwards to the service with the authenticated userId", async () => {
    mockSalesService.undoItemRefund.mockReturnValue({
      success: true,
      undoId: 99,
    });
    const handler = handlers.get("sales:undo-item-refund")!;

    const result = await handler({ sender: { id: 1 } }, {
      refundTransactionId: 42,
    });

    expect(requireRole).toHaveBeenCalledWith(1, ["admin"]);
    expect(mockSalesService.undoItemRefund).toHaveBeenCalledWith({
      refundTransactionId: 42,
      userId: 7,
    });
    expect(result).toEqual({ success: true, undoId: 99 });
    expect(audit).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        action: "refund",
        entity_type: "transaction",
        entity_id: "42",
      }),
    );
  });

  it("rejects a non-admin caller before calling the service (admin-only gate)", async () => {
    (requireRole as jest.Mock).mockReturnValue({
      ok: false,
      error: "Forbidden: requires one of roles: admin",
    });
    const handler = handlers.get("sales:undo-item-refund")!;

    const result = await handler({ sender: { id: 1 } }, {
      refundTransactionId: 42,
    });

    expect(result).toEqual({
      success: false,
      error: "Forbidden: requires one of roles: admin",
    });
    expect(mockSalesService.undoItemRefund).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("rejects an invalid payload (missing refundTransactionId) before calling the service", async () => {
    const handler = handlers.get("sales:undo-item-refund")!;

    const result = await handler({ sender: { id: 1 } }, {});

    expect((result as { success: boolean }).success).toBe(false);
    expect(mockSalesService.undoItemRefund).not.toHaveBeenCalled();
  });

  it("does not audit when the service reports failure", async () => {
    mockSalesService.undoItemRefund.mockReturnValue({
      success: false,
      error: "This refund has already been undone.",
    });
    const handler = handlers.get("sales:undo-item-refund")!;

    const result = await handler({ sender: { id: 1 } }, {
      refundTransactionId: 42,
    });

    expect(result).toEqual({
      success: false,
      error: "This refund has already been undone.",
    });
    expect(audit).not.toHaveBeenCalled();
  });
});
