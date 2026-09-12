/**
 * inventory:{create,update,delete}-category and
 * inventory:{create,update,delete}-product-supplier — admin-or-staff role
 * gate (TRANSPORT_PARITY_AUDIT_PLAN.md, LIRA-143 "ungated category routes"
 * item).
 *
 * These six write channels had NO `requireRole` check at all before this
 * fix — every other write channel in `inventoryHandlers.ts`
 * (`inventory:create-product`, `inventory:update-product`,
 * `inventory:delete-product`, `inventory:batch-delete`,
 * `inventory:batch-update`, `inventory:receive-stock`) already gates on
 * `["admin", "staff"]`; these six silently let ANY authenticated caller,
 * any role, create/rename/delete a product category or a product supplier.
 * The mirroring REST routes (`POST`/`PUT`/`DELETE /api/inventory/categories`
 * and `/product-suppliers`, `backend/src/api/inventory.ts`) had the
 * identical gap and are fixed alongside these.
 *
 * The read channels (`inventory:get-categories(-full)`,
 * `inventory:get-product-suppliers(-full)`) are DELIBERATELY left ungated —
 * matching `inventory:get-products` and every other read in this file — and
 * are not exercised here.
 *
 * Same mocking shape as `inventoryHandlers.batchUpdateRoleGate.test.ts`.
 *
 * Rule-17 note: the role-gate assertions below have NOT yet been proven to
 * fail against the pre-fix code (the missing `requireRole` calls) — that
 * failing-first proof (temporarily strip the six `requireRole` calls, watch
 * every "rejects" case below fail, then revert) is still owed before this
 * counts as a fully guarded regression test.
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

describe("inventory category/product-supplier write channels — role gate", () => {
  const mockService = {};
  const mockCatRepo = {
    getNames: jest.fn(),
    getAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const mockSupplierRepo = {
    getNames: jest.fn(),
    getAllWithProductCount: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();

    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });

    (getInventoryService as jest.Mock).mockReturnValue(mockService);
    (getCategoryRepository as jest.Mock).mockReturnValue(mockCatRepo);
    (getProductSupplierRepository as jest.Mock).mockReturnValue(
      mockSupplierRepo,
    );
    (requireRole as jest.Mock).mockReturnValue({ ok: true, userId: 7 });

    registerInventoryHandlers();
  });

  const forbidden = () =>
    (requireRole as jest.Mock).mockReturnValue({
      ok: false,
      error: "Forbidden",
    });

  it("inventory:create-category refuses a non-admin/staff caller WITHOUT reaching the repository", async () => {
    forbidden();
    const handler = handlers.get("inventory:create-category")!;

    const result = await handler({ sender: { id: 1 } }, "Phones");

    expect(requireRole).toHaveBeenCalledWith(1, ["admin", "staff"]);
    expect(mockCatRepo.create).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(result).toEqual({ success: false, error: "Forbidden" });
  });

  it("inventory:update-category refuses a non-admin/staff caller WITHOUT reaching the repository", async () => {
    forbidden();
    const handler = handlers.get("inventory:update-category")!;

    const result = await handler({ sender: { id: 1 } }, 1, { name: "New" });

    expect(requireRole).toHaveBeenCalledWith(1, ["admin", "staff"]);
    expect(mockCatRepo.update).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(result).toEqual({ success: false, error: "Forbidden" });
  });

  it("inventory:delete-category refuses a non-admin/staff caller WITHOUT reaching the repository", async () => {
    forbidden();
    const handler = handlers.get("inventory:delete-category")!;

    const result = await handler({ sender: { id: 1 } }, 1);

    expect(requireRole).toHaveBeenCalledWith(1, ["admin", "staff"]);
    expect(mockCatRepo.delete).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(result).toEqual({ success: false, error: "Forbidden" });
  });

  it("inventory:create-product-supplier refuses a non-admin/staff caller WITHOUT reaching the repository", async () => {
    forbidden();
    const handler = handlers.get("inventory:create-product-supplier")!;

    const result = await handler({ sender: { id: 1 } }, "Acme Corp");

    expect(requireRole).toHaveBeenCalledWith(1, ["admin", "staff"]);
    expect(mockSupplierRepo.create).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(result).toEqual({ success: false, error: "Forbidden" });
  });

  it("inventory:update-product-supplier refuses a non-admin/staff caller WITHOUT reaching the repository", async () => {
    forbidden();
    const handler = handlers.get("inventory:update-product-supplier")!;

    const result = await handler({ sender: { id: 1 } }, 1, "New Name");

    expect(requireRole).toHaveBeenCalledWith(1, ["admin", "staff"]);
    expect(mockSupplierRepo.update).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(result).toEqual({ success: false, error: "Forbidden" });
  });

  it("inventory:delete-product-supplier refuses a non-admin/staff caller WITHOUT reaching the repository", async () => {
    forbidden();
    const handler = handlers.get("inventory:delete-product-supplier")!;

    const result = await handler({ sender: { id: 1 } }, 1);

    expect(requireRole).toHaveBeenCalledWith(1, ["admin", "staff"]);
    expect(mockSupplierRepo.delete).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(result).toEqual({ success: false, error: "Forbidden" });
  });

  it("allows an admin/staff caller through on all six channels", async () => {
    mockCatRepo.create.mockReturnValue({ id: 1 });
    mockCatRepo.update.mockReturnValue({ id: 1, name: "New" });
    mockCatRepo.delete.mockReturnValue(true);
    mockSupplierRepo.create.mockReturnValue({ id: 2 });
    mockSupplierRepo.update.mockReturnValue({ id: 2, name: "New Name" });
    mockSupplierRepo.delete.mockReturnValue(true);

    const createCategory = handlers.get("inventory:create-category")!;
    const updateCategory = handlers.get("inventory:update-category")!;
    const deleteCategory = handlers.get("inventory:delete-category")!;
    const createSupplier = handlers.get("inventory:create-product-supplier")!;
    const updateSupplier = handlers.get("inventory:update-product-supplier")!;
    const deleteSupplier = handlers.get("inventory:delete-product-supplier")!;

    await createCategory({ sender: { id: 1 } }, "Phones");
    await updateCategory({ sender: { id: 1 } }, 1, { name: "New" });
    await deleteCategory({ sender: { id: 1 } }, 1);
    await createSupplier({ sender: { id: 1 } }, "Acme Corp");
    await updateSupplier({ sender: { id: 1 } }, 2, "New Name");
    await deleteSupplier({ sender: { id: 1 } }, 2);

    expect(mockCatRepo.create).toHaveBeenCalledWith("Phones");
    expect(mockCatRepo.update).toHaveBeenCalledWith(1, {
      name: "New",
      tracksImeiUnits: undefined,
    });
    expect(mockCatRepo.delete).toHaveBeenCalledWith(1);
    expect(mockSupplierRepo.create).toHaveBeenCalledWith("Acme Corp");
    expect(mockSupplierRepo.update).toHaveBeenCalledWith(2, "New Name");
    expect(mockSupplierRepo.delete).toHaveBeenCalledWith(2);
  });
});
