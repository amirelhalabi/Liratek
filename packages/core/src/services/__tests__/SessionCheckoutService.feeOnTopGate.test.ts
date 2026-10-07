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
 *
 * LIRA-271 (2026-10-07): the gate now delegates to the ONE shared rule
 * (`utils/sessionFeeOnTop.ts`) the checkout modal also uses. Cases (a)/(b)
 * used OMT-shaped fixtures (`omtFee`, no provider) and expected `true`;
 * under D1 an OMT RECEIVE's fee is never collected, so they are rewritten to
 * WHISH fixtures, and new cases pin that OMT and app-wallet RECEIVEs are
 * NOT flagged (they used to be flagged here and zeroed later by the SQL
 * provider gate).
 */

import { isFeeOnTopReceiveItem } from "../SessionCheckoutService";

describe("SessionCheckoutService.isFeeOnTopReceiveItem — bug 7's fee-on-top gate", () => {
  const whishReceive = (extra: Record<string, unknown>) => ({
    provider: "WHISH",
    serviceType: "RECEIVE",
    whishFee: 5,
    ...extra,
  });

  it("(a) WHISH RECEIVE with includingFees omitted (fee-on-top, the default) -> true", () => {
    expect(isFeeOnTopReceiveItem(whishReceive({}))).toBe(true);
  });

  it("(b) WHISH RECEIVE with includingFees: false (explicit fee-on-top) -> true", () => {
    expect(isFeeOnTopReceiveItem(whishReceive({ includingFees: false }))).toBe(
      true,
    );
  });

  it("(c) RECEIVE with includingFees: true (fee netted from the payout, NOT fee-on-top) -> false", () => {
    expect(isFeeOnTopReceiveItem(whishReceive({ includingFees: true }))).toBe(
      false,
    );
  });

  it("(d) SEND (not a RECEIVE at all) -> false regardless of includingFees", () => {
    expect(
      isFeeOnTopReceiveItem({
        provider: "WHISH",
        serviceType: "SEND",
        includingFees: false,
        whishFee: 5,
      }),
    ).toBe(false);
    expect(isFeeOnTopReceiveItem({ serviceType: "SEND" })).toBe(false);
  });

  it("(e) a non-financial item (no serviceType at all, e.g. a custom service) -> false", () => {
    expect(isFeeOnTopReceiveItem({ label: "Phone case" })).toBe(false);
  });

  it("(f) LIRA-271: OMT system RECEIVE with a fee on top -> false (D1: OMT never takes a RECEIVE fee)", () => {
    expect(
      isFeeOnTopReceiveItem({
        provider: "OMT",
        serviceType: "RECEIVE",
        includingFees: false,
        omtFee: 5,
      }),
    ).toBe(false);
  });

  it("(g) LIRA-271: app-wallet RECEIVE with a fee on top -> false (the fee arrives in the wallet)", () => {
    expect(
      isFeeOnTopReceiveItem({
        provider: "WHISH_APP",
        serviceType: "RECEIVE",
        includingFees: false,
        whishFee: 1,
      }),
    ).toBe(false);
  });

  it("(h) WHISH RECEIVE with no fee entered -> false (nothing to collect)", () => {
    expect(isFeeOnTopReceiveItem(whishReceive({ whishFee: 0 }))).toBe(false);
  });
});
