/**
 * LIRA-378 (owner 2026-11-09) — on the OMT Settle Account sheet, nothing
 * ticked in "Which OMT commission does this SMS include?" means OMT pays NO
 * commission in this SMS. The sheet sends `covered_omt_service_types: []`
 * for that, so the settle-account schema must accept the empty list — but
 * only next to an SMS amount: on the legacy whole-row path and on the
 * amount-first path without an SMS figure, `[]` would mean "every new-style
 * transfer waits" (nothing to settle), so it stays refused.
 *
 * RULE 17 — run before the schema change: the first two cases failed
 * (`Array must contain at least 1 element(s)`).
 */
import { supplierSettleAccountSchema } from "../supplier.js";

const amountFirst = (extra: Record<string, unknown> = {}) => ({
  account_supplier_id: 1,
  per_currency: {
    USD: {
      direction: "PAY" as const,
      payments: [{ method: "CASH", currency_code: "USD", amount: 776.5 }],
      ...extra,
    },
  },
  expected_owed: { usd: 776.5, lbp: 0 },
});

const legacy = {
  account_supplier_id: 1,
  direction: "PAY" as const,
  selections: [{ kind: "FINANCIAL_SERVICE" as const, id: 1 }],
  amount_usd: 10,
  amount_lbp: 0,
  commission_usd: 0,
  commission_lbp: 0,
};

describe("supplierSettleAccountSchema — covered_omt_service_types: [] (no commission)", () => {
  it("is accepted with an SMS amount and survives parsing (rule 23)", () => {
    const r = supplierSettleAccountSchema.safeParse({
      ...amountFirst({ sms_amount: 776.5 }),
      covered_omt_service_types: [],
    });
    expect(r.success).toBe(true);
    expect(
      (r as { data: { covered_omt_service_types?: string[] } }).data
        .covered_omt_service_types,
    ).toEqual([]);
  });

  it("is accepted when only the LBP section carries the SMS amount", () => {
    const r = supplierSettleAccountSchema.safeParse({
      account_supplier_id: 1,
      per_currency: {
        LBP: {
          direction: "PAY" as const,
          payments: [{ method: "CASH", currency_code: "LBP", amount: 450_000 }],
          sms_amount: 450_000,
        },
      },
      expected_owed: { usd: 0, lbp: 450_000 },
      covered_omt_service_types: [],
    });
    expect(r.success).toBe(true);
  });

  it("is refused on the amount-first path without an SMS amount", () => {
    const r = supplierSettleAccountSchema.safeParse({
      ...amountFirst(),
      covered_omt_service_types: [],
    });
    expect(r.success).toBe(false);
  });

  it("is refused on the legacy whole-row path", () => {
    const r = supplierSettleAccountSchema.safeParse({
      ...legacy,
      covered_omt_service_types: [],
    });
    expect(r.success).toBe(false);
  });

  it("a non-empty list and an absent key are unchanged", () => {
    expect(
      supplierSettleAccountSchema.safeParse({
        ...amountFirst({ sms_amount: 776.5 }),
        covered_omt_service_types: ["INTRA"],
      }).success,
    ).toBe(true);
    expect(supplierSettleAccountSchema.safeParse(amountFirst({ sms_amount: 776.5 })).success).toBe(
      true,
    );
    expect(supplierSettleAccountSchema.safeParse(legacy).success).toBe(true);
  });
});
