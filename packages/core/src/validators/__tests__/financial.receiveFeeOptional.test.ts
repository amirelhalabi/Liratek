/**
 * D1 cutover (OWNER_NOTES_2026-09-21.md §2b, note #6): "omt receive 40$, cash
 * to business, no fee — i can see omt fee is required for this service
 * type." The `createFinancialServiceSchema` refine at ~:303-328
 * (`hasFeeLookupTable`) required `omtFee` for every non-lookup-table
 * `omtServiceType` (CASH_TO_BUSINESS, CASH_TO_GOV, OMT_CARD,
 * OGERO_MECANIQUE) regardless of `serviceType` — correct for a SEND (real
 * money the shop needs an exact figure for) but wrong for a RECEIVE, which
 * under D1 never collects a fee from the customer at all: `omtFee` on a
 * RECEIVE is purely informational (drives the commission calculation), so
 * requiring it blocked the exact "no fee" case the owner reported.
 *
 * The fix adds `data.serviceType !== "RECEIVE"` to the refine's guard — kept
 * for SEND (and BILL), relaxed for RECEIVE. This file proves both halves so
 * neither can regress silently.
 *
 * RULE 17 — PROVEN FAILING-FIRST 2026-09-23: ran this file with the
 * `data.serviceType !== "RECEIVE"` clause removed from the refine (reverting
 * to the pre-fix condition) — the RECEIVE case below failed with the exact
 * "OMT fee is required for this service type" error the owner reported;
 * reverted after confirming red (see the parent task's report for the
 * transcript this test's docblock cites).
 */

import { createFinancialServiceSchema } from "../financial.js";

describe("createFinancialServiceSchema — D1 cutover: omtFee is optional on RECEIVE", () => {
  it("RECEIVE, CASH_TO_BUSINESS, no omtFee at all — ACCEPTED (note #6's exact repro)", () => {
    const result = createFinancialServiceSchema.safeParse({
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 40,
      currency: "USD",
      omtServiceType: "CASH_TO_BUSINESS",
      cashoutMethod: "CASH",
      // omtFee omitted entirely.
    });
    expect(result.success).toBe(true);
  });

  it("RECEIVE, CASH_TO_BUSINESS, omtFee: 0 explicit — ACCEPTED", () => {
    const result = createFinancialServiceSchema.safeParse({
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 40,
      currency: "USD",
      omtServiceType: "CASH_TO_BUSINESS",
      omtFee: 0,
      cashoutMethod: "CASH",
    });
    expect(result.success).toBe(true);
  });

  it("RECEIVE, OGERO_MECANIQUE (another non-lookup-table service type), no omtFee — ACCEPTED", () => {
    const result = createFinancialServiceSchema.safeParse({
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 40,
      currency: "USD",
      omtServiceType: "OGERO_MECANIQUE",
      cashoutMethod: "CASH",
    });
    expect(result.success).toBe(true);
  });

  it("SEND, CASH_TO_BUSINESS, no omtFee — STILL REJECTED (rule unchanged for SEND)", () => {
    const result = createFinancialServiceSchema.safeParse({
      provider: "OMT",
      serviceType: "SEND",
      amount: 40,
      currency: "USD",
      omtServiceType: "CASH_TO_BUSINESS",
      paidByMethod: "CASH",
      // omtFee omitted — must still be rejected; real cash leg needs an
      // exact figure.
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "OMT fee is required for this service type",
      );
    }
  });

  it("SEND, CASH_TO_BUSINESS, omtFee supplied — ACCEPTED (unchanged)", () => {
    const result = createFinancialServiceSchema.safeParse({
      provider: "OMT",
      serviceType: "SEND",
      amount: 40,
      currency: "USD",
      omtServiceType: "CASH_TO_BUSINESS",
      omtFee: 2,
      paidByMethod: "CASH",
    });
    expect(result.success).toBe(true);
  });

  it("RECEIVE, INTRA (a lookup-table service type), no omtFee — ACCEPTED (was already true, unaffected)", () => {
    const result = createFinancialServiceSchema.safeParse({
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 40,
      currency: "USD",
      omtServiceType: "INTRA",
      cashoutMethod: "CASH",
    });
    expect(result.success).toBe(true);
  });
});
