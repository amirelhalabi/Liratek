/**
 * LIRA-372 (T010) — preview = server: the Settle Account sheet's allocator
 * call takes the section's discount (`waive`) the way the server does, so
 * "still owes" and the Confirm gating see owed − paid − discount.
 */
import type { AccountUnsettledRow } from "../../hooks/useSuppliers";
import { allocateSection } from "../accountSettleMath";

const ROW = {
  kind: "LEDGER",
  id: 1,
  supplier_id: 2,
  source_provider: "OMT",
  source_name: "OMT",
  created_at: "2026-11-01 09:00:00",
  amount_usd: 412.5,
  amount_lbp: 0,
  remaining_usd: 412.5,
  remaining_lbp: 0,
  entry_type: "TOP_UP",
  service_type: null,
  commission_usd: 0,
  commission_lbp: 0,
  omt_service_type: null,
  commission_model: null,
} as unknown as AccountUnsettledRow;

describe("allocateSection takes the discount (LIRA-372)", () => {
  it("412.50 owed, paid 410 + discount 2.50 → nothing remains", () => {
    const res = allocateSection([ROW], "USD", "PAY", {
      inSame: 410,
      outSame: 0,
      commission: 0,
      waive: 2.5,
    });
    expect(res.remaining_after).toBe(0);
  });

  it("without the discount 2.50 still remains", () => {
    const res = allocateSection([ROW], "USD", "PAY", {
      inSame: 410,
      outSame: 0,
      commission: 0,
    });
    expect(res.remaining_after).toBe(2.5);
  });
});
