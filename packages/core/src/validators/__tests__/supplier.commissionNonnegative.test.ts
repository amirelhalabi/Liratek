/**
 * LIRA-166 — `supplierSettleSchema`'s `commission_usd`/`commission_lbp` were
 * bare `z.number()` (no `.nonnegative()`), so a negative entered commission
 * could reach `SupplierRepository.settleTransactions`. The `SUPPLIER_PAYS_US`
 * ledger credit normalises with `-Math.abs(...)` while the settlement profit
 * stamp (`:2784-2785`) books the RAW entered value — a negative
 * `commission_usd` would credit the ledger positively while booking negative
 * profit, so the ledger and the profit stamp disagree in sign.
 *
 * Not reachable through the settlement UI (`Suppliers/index.tsx`'s commission
 * inputs reject a leading "-" at the keystroke level via
 * `/^\d*\.?\d*$/`/`/^\d+$/`), but reachable via direct IPC/REST. Fix:
 * `.nonnegative()` on both fields, matching the repository's own documented
 * assumption.
 *
 * Rule 17: written failing-first. Run against the pre-fix schema (bare
 * `z.number()`) to see "rejects a negative commission_usd/_lbp" fail, then
 * apply `.nonnegative()` and re-run to confirm green.
 */

import { describe, it, expect } from "@jest/globals";
import { supplierSettleSchema } from "../supplier.js";

function basePayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    supplier_id: 1,
    financial_service_ids: [1],
    amount_usd: 100,
    amount_lbp: 0,
    commission_usd: 5,
    commission_lbp: 0,
    ...overrides,
  };
}

describe("supplierSettleSchema — commission_usd/commission_lbp bounds (LIRA-166)", () => {
  it("rejects a negative commission_usd", () => {
    const result = supplierSettleSchema.safeParse(
      basePayload({ commission_usd: -5 }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a negative commission_lbp", () => {
    const result = supplierSettleSchema.safeParse(
      basePayload({ commission_lbp: -1000 }),
    );
    expect(result.success).toBe(false);
  });

  it("still accepts a zero commission (informational legacy batches)", () => {
    const result = supplierSettleSchema.safeParse(
      basePayload({ commission_usd: 0, commission_lbp: 0 }),
    );
    expect(result.success).toBe(true);
  });

  it("still accepts a positive commission (the only UI-reachable shape)", () => {
    const result = supplierSettleSchema.safeParse(
      basePayload({ commission_usd: 5, commission_lbp: 20000 }),
    );
    expect(result.success).toBe(true);
  });
});
