/**
 * sales:update-metadata — Zod validation parity
 * (TRANSPORT_PARITY_AUDIT_PLAN.md §6.4 follow-up 3).
 *
 * Before this fix the handler validated nothing beyond `requireRole` while
 * the REST twin (`POST /api/sales/update-metadata`) already validated
 * against `saleUpdateMetadataSchema` (packages/core/src/validators/sale.ts)
 * — REST was silently stricter than desktop. The handler now validates
 * against the SAME schema (`SaleUpdateMetadataSchema`, re-exported in
 * electron-app/schemas/index.ts).
 *
 * Same mocking shape as `inventoryHandlers.batchUpdateRoleGate.test.ts`:
 * `@liratek/core` is mocked via `jest.requireActual` + override so the real
 * schema still runs — an invalid payload must be refused WITHOUT ever
 * reaching the service.
 *
 * Rule-17 note: the "invalid payload rejected" assertion below has NOT yet
 * been proven to fail against the pre-fix code (no validation at all) —
 * that failing-first proof is still owed before this counts as a fully
 * guarded regression test.
 */

import { ipcMain } from "electron";
import { registerSalesHandlers } from "../salesHandlers";
import { getSalesService, getUserRepository } from "@liratek/core";
import { requireRole } from "../../session";

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn() },
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    getSalesService: jest.fn(),
    getTransactionService: jest.fn(() => ({})),
    getUserRepository: jest.fn(),
  };
});

jest.mock("../../session", () => ({
  requireRole: jest.fn(),
}));

jest.mock("../auditHelper", () => ({
  audit: jest.fn(),
}));

describe("sales:update-metadata validation", () => {
  const mockService = {
    updateSaleMetadata: jest.fn(),
  };
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();

    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });

    (getSalesService as jest.Mock).mockReturnValue(mockService);
    (getUserRepository as jest.Mock).mockReturnValue({
      findById: jest.fn(() => null),
    });
    (requireRole as jest.Mock).mockReturnValue({ ok: true, userId: 7 });

    registerSalesHandlers();
  });

  it("passes a valid payload through to the service with all fields intact", async () => {
    mockService.updateSaleMetadata.mockReturnValue({
      success: true,
      entity: { id: 42 },
    });
    const handler = handlers.get("sales:update-metadata")!;

    const result = await handler(
      { sender: { id: 1 } },
      {
        id: 42,
        note: "Called back re: warranty",
        client_name: "Jane Doe",
        client_phone: "70123456",
      },
    );

    expect(mockService.updateSaleMetadata).toHaveBeenCalledWith(
      42,
      {
        note: "Called back re: warranty",
        client_name: "Jane Doe",
        client_phone: "70123456",
      },
      expect.any(String),
    );
    expect(result).toEqual({ success: true, data: { id: 42 } });
  });

  it("rejects an invalid payload (non-positive id) at the door WITHOUT calling the service", async () => {
    const handler = handlers.get("sales:update-metadata")!;

    const result = (await handler(
      { sender: { id: 1 } },
      { id: -1, note: "x" },
    )) as { success: boolean; error?: string };

    expect(mockService.updateSaleMetadata).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });

  it("rejects an over-long client_name (> 255 chars) WITHOUT calling the service", async () => {
    const handler = handlers.get("sales:update-metadata")!;

    const result = (await handler(
      { sender: { id: 1 } },
      { id: 42, client_name: "a".repeat(256) },
    )) as { success: boolean; error?: string };

    expect(mockService.updateSaleMetadata).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });
});
