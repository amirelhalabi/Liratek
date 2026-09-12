/**
 * inventory:batch-update — admin-or-staff role gate + `unit` forwarding
 * (TRANSPORT_PARITY_AUDIT_PLAN.md §6.4 items 1 and 3).
 *
 * This channel had NO `requireRole` check at all before this fix — every
 * other write channel in `inventoryHandlers.ts`
 * (`inventory:create-product`, `inventory:update-product`,
 * `inventory:delete-product`, `inventory:batch-delete`,
 * `inventory:receive-stock`) already gates on `["admin", "staff"]`; this one
 * silently let ANY caller batch-edit category/min-stock/supplier/unit across
 * every selected product. The mirroring REST route
 * (`POST /api/inventory/products/batch-update`,
 * `backend/src/api/inventory.ts`) had the identical gap and is fixed
 * alongside this one.
 *
 * Same mocking shape as `productUnitHandlers.test.ts`: `@liratek/core` is
 * mocked via `jest.requireActual` + override so `BatchUpdateSchema` (now a
 * direct re-export of the real core `batchUpdateProductsSchema`, rule 14)
 * still runs for real — a non-admin/staff caller must be refused WITHOUT
 * ever reaching the service.
 *
 * Rule-17 note: the role-gate assertion below has NOT yet been proven to
 * fail against the pre-fix code (the missing `requireRole` call) — that
 * failing-first proof is still owed before this counts as a fully guarded
 * regression test.
 */

import { ipcMain } from "electron";
import { registerInventoryHandlers } from "../inventoryHandlers";
import {
  getInventoryService,
  getCategoryRepository,
  getProductSupplierRepository,
} from "@liratek/core";
import { requireRole } from "../../session";
import { audit } from "../auditHelper";

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn() },
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    getInventoryService: jest.fn(),
    getCategoryRepository: jest.fn(),
    getProductSupplierRepository: jest.fn(),
  };
});

jest.mock("../../session", () => ({
  requireRole: jest.fn(),
}));

jest.mock("../auditHelper", () => ({
  audit: jest.fn(),
}));

describe("inventory:batch-update", () => {
  const mockService = {
    batchUpdateProducts: jest.fn(),
  };
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();

    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });

    (getInventoryService as jest.Mock).mockReturnValue(mockService);
    (getCategoryRepository as jest.Mock).mockReturnValue({
      getNames: jest.fn(),
      getAll: jest.fn(),
    });
    (getProductSupplierRepository as jest.Mock).mockReturnValue({
      getNames: jest.fn(),
      getAllWithProductCount: jest.fn(),
    });
    (requireRole as jest.Mock).mockReturnValue({ ok: true, userId: 7 });

    registerInventoryHandlers();
  });

  it("rejects a non-admin/staff caller WITHOUT calling the service", async () => {
    (requireRole as jest.Mock).mockReturnValue({
      ok: false,
      error: "Forbidden",
    });
    const handler = handlers.get("inventory:batch-update")!;

    const result = await handler(
      { sender: { id: 1 } },
      { ids: [1, 2], category: "New Category" },
    );

    expect(requireRole).toHaveBeenCalledWith(1, ["admin", "staff"]);
    expect(mockService.batchUpdateProducts).not.toHaveBeenCalled();
    expect(result).toEqual({ success: false, error: "Forbidden" });
  });

  it("allows an admin/staff caller through and forwards `unit` to the service", async () => {
    mockService.batchUpdateProducts.mockReturnValue({
      success: true,
      updated: 2,
    });
    const handler = handlers.get("inventory:batch-update")!;

    const result = await handler(
      { sender: { id: 1 } },
      { ids: [1, 2], unit: "box" },
    );

    expect(mockService.batchUpdateProducts).toHaveBeenCalledWith(
      [1, 2],
      expect.objectContaining({ unit: "box" }),
    );
    expect(result).toEqual({ success: true, updated: 2 });
  });

  it("rejects an invalid payload (empty ids) at the door WITHOUT calling the service", async () => {
    const handler = handlers.get("inventory:batch-update")!;

    const result = (await handler({ sender: { id: 1 } }, { ids: [] })) as {
      success: boolean;
      error?: string;
    };

    expect(mockService.batchUpdateProducts).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });
});
