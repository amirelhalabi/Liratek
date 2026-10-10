/**
 * Owner-approved fix (2026-10-02): "OMT Send with fee 0 is refused." The
 * `createFinancialServiceSchema` refine at ~:368-405 (`hasFeeLookupTable`)
 * requires `omtFee` for a SEND of CASH_TO_BUSINESS / CASH_TO_GOV / OMT_CARD /
 * OGERO_MECANIQUE via `!data.omtFee` — a truthy check, so an EXPLICIT
 * `omtFee: 0` (the cashier typed "0") is indistinguishable from the key
 * being entirely absent and is rejected with "OMT fee is required for this
 * service type". The frontend (`Services/index.tsx` ~898/1090) already sends
 * `omtFee: 0` for a typed "0" and omits the key entirely when the field is
 * empty, so the validator must tell those two payloads apart instead of
 * collapsing them.
 *
 * Owner decision: a fee of 0 is a VALID entered value and must be accepted.
 * Superseded 2026-10-10: a MISSING fee is now accepted on SEND too — see
 * `financial.omtFeeOptional.test.ts`.
 *
 * RULE 17 — PROVEN FAILING-FIRST 2026-10-02: ran this file against the
 * unfixed validator (refine still reads `!data.omtFee`) — every "omtFee: 0 —
 * ACCEPTED" case below failed with the exact "OMT fee is required for this
 * service type" error the ticket describes. Confirmed red before the fix
 * (changing the refine's guard to `data.omtFee === undefined ||
 * data.omtFee === null`) was applied.
 */

import { createFinancialServiceSchema } from "../financial.js";

describe("createFinancialServiceSchema — SEND omtFee: 0 is a valid entered fee", () => {
  const base = {
    provider: "OMT",
    serviceType: "SEND",
    amount: 100,
    currency: "USD",
    paidByMethod: "CASH",
  } as const;

  const nonLookupTypes = [
    "CASH_TO_BUSINESS",
    "CASH_TO_GOV",
    "OMT_CARD",
    "OGERO_MECANIQUE",
  ] as const;

  for (const omtServiceType of nonLookupTypes) {
    it(`SEND, ${omtServiceType}, omtFee: 0 explicit — ACCEPTED`, () => {
      const result = createFinancialServiceSchema.safeParse({
        ...base,
        omtServiceType,
        omtFee: 0,
      });
      expect(result.success).toBe(true);
    });
  }

  it("RECEIVE, CASH_TO_BUSINESS, omtFee: 0 — still ACCEPTED (unaffected by this fix)", () => {
    const result = createFinancialServiceSchema.safeParse({
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      omtServiceType: "CASH_TO_BUSINESS",
      omtFee: 0,
      cashoutMethod: "CASH",
    });
    expect(result.success).toBe(true);
  });
});
