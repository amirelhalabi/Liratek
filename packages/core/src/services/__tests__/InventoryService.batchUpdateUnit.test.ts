/**
 * InventoryService.batchUpdateProducts — `unit` field (TRANSPORT_PARITY_AUDIT_PLAN.md
 * §6.4 item 3, inventory half).
 *
 * The batch-edit modal's "Quantity" input (bound to `batchFields.unit`,
 * `frontend/src/features/inventory/pages/Inventory/ProductList.tsx`) writes
 * `products.unit` (a nullable TEXT column, `electron-app/create_db.sql:301`)
 * — it never reached the database on either transport before this fix: the
 * `hasField` guard below didn't know about `unit`, so a unit-only batch edit
 * was rejected as "No fields to update" even if every other layer had
 * accepted it.
 *
 * Uses a mocked `ProductRepository` (constructor injection) rather than a
 * real DB — this test is only proving InventoryService's own guard/pass-
 * through logic, not the SQL `unit = ?` clause (that's ProductRepository's
 * own concern).
 */

import { InventoryService } from "../InventoryService.js";
import type { ProductRepository } from "../../repositories/ProductRepository.js";

describe("InventoryService.batchUpdateProducts — unit field", () => {
  function makeMockProductRepo() {
    return {
      batchUpdateProducts: jest.fn().mockReturnValue(2),
    } as unknown as ProductRepository;
  }

  it("accepts a unit-only payload instead of rejecting it as 'No fields to update'", () => {
    const mockProductRepo = makeMockProductRepo();
    const service = new InventoryService(mockProductRepo);

    const result = service.batchUpdateProducts([1, 2], { unit: "box" });

    expect(result).toEqual({ success: true, updated: 2 });
  });

  it("forwards `unit` to the repository call unchanged", () => {
    const mockProductRepo = makeMockProductRepo();
    const service = new InventoryService(mockProductRepo);

    service.batchUpdateProducts([1, 2, 3], { unit: "kg" });

    expect(mockProductRepo.batchUpdateProducts).toHaveBeenCalledWith(
      [1, 2, 3],
      expect.objectContaining({ unit: "kg" }),
    );
  });

  it("forwards `unit: null` (explicit clear) rather than dropping it", () => {
    const mockProductRepo = makeMockProductRepo();
    const service = new InventoryService(mockProductRepo);

    service.batchUpdateProducts([1], { unit: null });

    expect(mockProductRepo.batchUpdateProducts).toHaveBeenCalledWith(
      [1],
      expect.objectContaining({ unit: null }),
    );
  });

  it("still rejects an empty payload (no category/min_stock_level/supplier/unit) as 'No fields to update'", () => {
    const mockProductRepo = makeMockProductRepo();
    const service = new InventoryService(mockProductRepo);

    const result = service.batchUpdateProducts([1, 2], {});

    expect(result).toEqual({
      success: false,
      updated: 0,
      error: "No fields to update",
    });
    expect(mockProductRepo.batchUpdateProducts).not.toHaveBeenCalled();
  });

  it("still rejects an empty ids array regardless of unit", () => {
    const mockProductRepo = makeMockProductRepo();
    const service = new InventoryService(mockProductRepo);

    const result = service.batchUpdateProducts([], { unit: "box" });

    expect(result).toEqual({
      success: false,
      updated: 0,
      error: "No products selected",
    });
    expect(mockProductRepo.batchUpdateProducts).not.toHaveBeenCalled();
  });
});
