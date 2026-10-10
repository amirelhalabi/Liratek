/**
 * Owner decision (2026-10-10): the OMT fee is optional for EVERY OMT service
 * type, on SEND as well as RECEIVE. Reported: "omt system send transaction,
 * type cash to business, amount 10,000$, 0 fees — fails: OMT fee is required
 * for this service type."
 *
 * Root cause: the Services page's fee box is a numeric `DecimalInput`, which
 * emits `0` for both an empty box and a typed "0", and the page stores that
 * as `""` (`setOmtFee(n ? String(n) : "")`). The submit path therefore omits
 * `omtFee` for a typed 0, and the validator's "0 is fine, absent is refused"
 * distinction (2026-10-02, financial.sendFeeZero.test.ts) could never be
 * reached from the real form. Since the UI cannot tell "blank" from "0", the
 * owner chose to treat a missing fee as 0 everywhere instead of requiring it.
 *
 * Downstream already handles an absent fee: the repository resolves it via
 * `lookupOmtFee(...) ?? 0` (commission 0) and persists `omt_fee` as NULL,
 * which every reader COALESCEs to 0.
 *
 * RULE 17 — PROVEN FAILING-FIRST 2026-10-10: ran this file against the
 * validator with the "OMT fee is required" refine still in place — every
 * "no omtFee — ACCEPTED" SEND case
 * failed (`success: false`). The fix removed that refine.
 */

import { createFinancialServiceSchema } from "../financial.js";

describe("createFinancialServiceSchema — omtFee is optional for every OMT service type", () => {
  const nonLookupTypes = [
    "CASH_TO_BUSINESS",
    "CASH_TO_GOV",
    "OMT_CARD",
    "OGERO_MECANIQUE",
  ] as const;

  for (const omtServiceType of nonLookupTypes) {
    it(`SEND, ${omtServiceType}, no omtFee — ACCEPTED`, () => {
      const result = createFinancialServiceSchema.safeParse({
        provider: "OMT",
        serviceType: "SEND",
        amount: 10000,
        currency: "USD",
        paidByMethod: "CASH",
        omtServiceType,
      });
      expect(result.success).toBe(true);
    });
  }
});
