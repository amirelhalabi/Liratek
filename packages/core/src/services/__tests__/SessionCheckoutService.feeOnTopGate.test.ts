/**
 * BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 Phase F, bug 7's third component —
 * `isFeeOnTopReceiveItem` is the ONLY place `includingFees`/`serviceType`
 * are ever read to decide whether a session RECEIVE item's fee is
 * fee-on-top (collected via the pooled CHARGE legs) — the flag lives in the
 * cart item's formData and is never persisted on the financial_services
 * row, so `SessionCheckoutService.checkout()` resolves this gate once per
 * item (batch and non-batch alike) and hands the matching financial_services
 * ids down to `recordBasketPayment` → `getSessionCashSplitContext`.
 *
 * Exported purely for this test — the narrowest seam that pins the gate's
 * condition without standing up the full async checkout() transaction
 * (session repo, client repo, a real DB, every module service, …) — matching
 * the same rationale `processCartItem` is exported for
 * (SessionCheckoutService.cartItemChannel.test.ts).
 *
 * RULE 17 (failing-first): proven against a temporarily-inverted condition
 * (`includingFees !== true` flipped to `includingFees === true`, matching
 * what a copy-paste of the STANDALONE FinancialServiceRepository gate —
 * which reads `receiveFeeIncluded = data.includingFees === true` for the
 * OPPOSITE purpose, "skip the fee leg when included" — would look like if
 * pasted here unchanged) — cases (b) and (d) below flipped from pass to
 * fail. Reverted after observing the failure; see the task's final report
 * for the exact diff/observed-output/restore transcript.
 */

import { isFeeOnTopReceiveItem } from "../SessionCheckoutService";

describe("SessionCheckoutService.isFeeOnTopReceiveItem — bug 7's fee-on-top gate", () => {
  it("(a) RECEIVE with includingFees omitted (fee-on-top, the default) -> true", () => {
    expect(isFeeOnTopReceiveItem({ serviceType: "RECEIVE", omtFee: 5 })).toBe(
      true,
    );
  });

  it("(b) RECEIVE with includingFees: false (explicit fee-on-top) -> true", () => {
    expect(
      isFeeOnTopReceiveItem({
        serviceType: "RECEIVE",
        includingFees: false,
        omtFee: 5,
      }),
    ).toBe(true);
  });

  it("(c) RECEIVE with includingFees: true (fee netted from the payout, NOT fee-on-top) -> false", () => {
    expect(
      isFeeOnTopReceiveItem({
        serviceType: "RECEIVE",
        includingFees: true,
        omtFee: 5,
      }),
    ).toBe(false);
  });

  it("(d) SEND (not a RECEIVE at all) -> false regardless of includingFees", () => {
    expect(
      isFeeOnTopReceiveItem({ serviceType: "SEND", includingFees: false }),
    ).toBe(false);
    expect(isFeeOnTopReceiveItem({ serviceType: "SEND" })).toBe(false);
  });

  it("(e) a non-financial item (no serviceType at all, e.g. a custom service) -> false", () => {
    expect(isFeeOnTopReceiveItem({ label: "Phone case" })).toBe(false);
  });
});
