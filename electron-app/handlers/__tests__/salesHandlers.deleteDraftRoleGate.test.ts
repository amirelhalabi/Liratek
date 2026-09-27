/**
 * LIRA-234 — "sales:delete-draft" (electron-app/handlers/salesHandlers.ts)
 * had no `requireRole` call at all (any authenticated OR unauthenticated
 * session could cancel a draft — `_event` wasn't even used) and audited
 * unconditionally, even when `SalesService.deleteDraft` refused the delete
 * (e.g. "Only draft sales can be deleted" / "Draft not found"), leaving a
 * phantom "Deleted draft sale #N" audit row for a delete that never
 * happened.
 *
 * This test proves the fixed handler:
 *   1. requires the SAME roles as "sales:process" (["admin","staff"]) — a
 *      refused `requireRole` result short-circuits before the service is
 *      ever called;
 *   2. refuses a non-positive-integer saleId (0, negative, non-integer)
 *      with `{ success: false, error: "Invalid sale ID" }`, mirroring the
 *      REST route (backend/src/api/sales.ts), before the service is called;
 *   3. only audits when `result.success` is true.
 *
 * Same mocking shape as salesHandlers.refundLegOverride.test.ts:
 * `../../session.js`'s `requireRole` and `./auditHelper.js`'s `audit` are
 * mocked directly so no real session/audit machinery runs.
 *
 * Rule 17 (failing-first) — run against the pre-fix handler body (no
 * `requireRole` call, unconditional `audit(...)`):
 *   - case 1 ("no session") FAILED: `deleteDraft` WAS called (received 7)
 *     and the result was `{ success: true }` instead of the expected
 *     `{ success: false, error: "Not authenticated" }` — there was no gate
 *     to refuse it.
 *   - case 3 ("non-positive-integer saleId") FAILED: `deleteDraft` was
 *     called with `0` instead of being refused with "Invalid sale ID".
 *   - case 4 ("service failure — audit not called") FAILED:
 *     `audit` WAS called once despite `result.success === false`.
 * All three now pass after the fix below.
 */

import { ipcMain } from "electron";
import { registerSalesHandlers } from "../salesHandlers";
import { getSalesService } from "@liratek/core";
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

describe("sales:delete-draft — LIRA-234 role gate + conditional audit", () => {
  const mockSalesService = {
    deleteDraft: jest.fn(),
  };
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();

    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });

    (getSalesService as jest.Mock).mockReturnValue(mockSalesService);
    (requireRole as jest.Mock).mockReturnValue({ ok: true, userId: 7 });

    registerSalesHandlers();
  });

  const getHandler = () => handlers.get("sales:delete-draft")!;

  it("refuses an unauthenticated caller — service and audit never called", async () => {
    (requireRole as jest.Mock).mockReturnValue({
      ok: false,
      error: "Not authenticated",
    });
    const handler = getHandler();

    const result = await handler({ sender: { id: 1 } }, 7);

    expect(result).toEqual({ success: false, error: "Not authenticated" });
    expect(mockSalesService.deleteDraft).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("refuses a role requireRole rejects (e.g. Forbidden) — service and audit never called", async () => {
    (requireRole as jest.Mock).mockReturnValue({
      ok: false,
      error: "Forbidden",
    });
    const handler = getHandler();

    const result = await handler({ sender: { id: 1 } }, 7);

    expect(result).toEqual({ success: false, error: "Forbidden" });
    expect(mockSalesService.deleteDraft).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("calls requireRole with the SAME roles as sales:process (admin, staff)", async () => {
    const handler = getHandler();
    mockSalesService.deleteDraft.mockReturnValue({ success: true });

    await handler({ sender: { id: 1 } }, 7);

    expect(requireRole).toHaveBeenCalledWith(1, ["admin", "staff"]);
  });

  it.each([0, -1, 1.5, NaN])(
    "refuses a non-positive-integer saleId (%p) without reaching the service",
    async (saleId) => {
      const handler = getHandler();

      const result = await handler({ sender: { id: 1 } }, saleId);

      expect(result).toEqual({ success: false, error: "Invalid sale ID" });
      expect(mockSalesService.deleteDraft).not.toHaveBeenCalled();
      expect(audit).not.toHaveBeenCalled();
    },
  );

  it("a service failure (e.g. not a draft) is returned but NOT audited", async () => {
    mockSalesService.deleteDraft.mockReturnValue({
      success: false,
      error: "Only draft sales can be deleted",
    });
    const handler = getHandler();

    const result = await handler({ sender: { id: 1 } }, 7);

    expect(result).toEqual({
      success: false,
      error: "Only draft sales can be deleted",
    });
    expect(mockSalesService.deleteDraft).toHaveBeenCalledWith(7);
    expect(audit).not.toHaveBeenCalled();
  });

  it("a successful delete is audited with the deleted sale id", async () => {
    mockSalesService.deleteDraft.mockReturnValue({ success: true });
    const handler = getHandler();

    const result = await handler({ sender: { id: 1 } }, 7);

    expect(result).toEqual({ success: true });
    expect(mockSalesService.deleteDraft).toHaveBeenCalledWith(7);
    expect(audit).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        action: "delete",
        entity_type: "sale",
        entity_id: "7",
      }),
    );
  });
});
