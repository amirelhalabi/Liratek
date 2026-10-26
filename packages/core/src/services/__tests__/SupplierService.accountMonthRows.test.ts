/**
 * LIRA-343 (T013, contracts/calendar-reads.md §1) — the calendar's month
 * read. The service turns `YYYY-MM` into a UTC window of month ± 1 day,
 * asks the repository (range mode), and keeps only the rows whose
 * `shop_day` falls in the month. No SQL here (rule 13): the repository is
 * mocked.
 */
const getAccountRows = jest.fn();

jest.mock("../../repositories/index.js", () => ({
  getSupplierRepository: () => ({ getAccountRows }),
  getProductSupplierRepository: jest.fn(),
  getSupplierPurchaseRepository: jest.fn(),
  getStockBatchRepository: jest.fn(),
}));

import { SupplierService } from "../SupplierService.js";
import type { AccountUnsettledRow } from "../../repositories/SupplierRepository.js";

function row(id: number, shop_day: string): AccountUnsettledRow {
  return {
    kind: "FINANCIAL_SERVICE",
    id,
    supplier_id: 1,
    source_provider: "OMT",
    source_name: "OMT",
    created_at: `${shop_day} 10:00:00`,
    amount_usd: 10,
    amount_lbp: 0,
    entry_type: null,
    service_type: "SEND",
    commission_usd: 0,
    commission_lbp: 0,
    omt_service_type: "INTRA",
    commission_model: 0,
    covered_usd: 0,
    covered_lbp: 0,
    remaining_usd: 10,
    remaining_lbp: 0,
    shop_day,
    source_ref_table: null,
    row_scope: "DAY",
    transaction_id: null,
  };
}

describe("SupplierService.getAccountMonthRows (LIRA-343)", () => {
  beforeEach(() => {
    getAccountRows.mockReset();
    getAccountRows.mockReturnValue([]);
  });

  it.each([
    ["2026-10", "2026-09-30 00:00:00", "2026-11-02 00:00:00"],
    // January wraps the year backward.
    ["2026-01", "2025-12-31 00:00:00", "2026-02-02 00:00:00"],
    // December wraps the year forward.
    ["2026-12", "2026-11-30 00:00:00", "2027-01-02 00:00:00"],
    // Leap-year February.
    ["2028-02", "2028-01-31 00:00:00", "2028-03-02 00:00:00"],
    // Common-year February.
    ["2027-02", "2027-01-31 00:00:00", "2027-03-02 00:00:00"],
  ])("%s asks for [%s, %s)", (month, fromUtc, toUtc) => {
    new SupplierService().getAccountMonthRows(7, month);
    expect(getAccountRows).toHaveBeenCalledTimes(1);
    expect(getAccountRows).toHaveBeenCalledWith(7, { fromUtc, toUtc });
  });

  it("keeps only the rows whose shop day is in the month", () => {
    getAccountRows.mockReturnValue([
      row(1, "2026-09-30"),
      row(2, "2026-10-01"),
      row(3, "2026-10-15"),
      row(4, "2026-10-31"),
      row(5, "2026-11-01"),
    ]);
    const rows = new SupplierService().getAccountMonthRows(7, "2026-10");
    expect(rows.map((r) => r.id)).toEqual([2, 3, 4]);
  });
});
