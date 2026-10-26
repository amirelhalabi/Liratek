/**
 * LIRA-343 (T031, contracts/calendar-reads.md §3) — the day-details read is
 * a thin pass-through to the repository (rule 13: no SQL in the service).
 */
const getAccountDayDetail = jest.fn();

jest.mock("../../repositories/index.js", () => ({
  getSupplierRepository: () => ({ getAccountDayDetail }),
  getProductSupplierRepository: jest.fn(),
  getSupplierPurchaseRepository: jest.fn(),
  getStockBatchRepository: jest.fn(),
}));

import { SupplierService } from "../SupplierService.js";

describe("SupplierService.getAccountDayDetail (LIRA-343)", () => {
  beforeEach(() => getAccountDayDetail.mockReset());

  it("asks the repository for that account and shop day, and returns its rows", () => {
    const rows = [{ id: 1, settlements: [], added_after_settlement: false }];
    getAccountDayDetail.mockReturnValue(rows);
    const out = new SupplierService().getAccountDayDetail(7, "2026-10-21");
    expect(getAccountDayDetail).toHaveBeenCalledTimes(1);
    expect(getAccountDayDetail).toHaveBeenCalledWith(7, "2026-10-21");
    expect(out).toBe(rows);
  });
});
