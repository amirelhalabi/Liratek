import { allocatePayments } from "@liratek/ui";
import {
  computeRepaymentReduction,
  resolveKeptChangeForReduction,
} from "../repaymentReduction";

/**
 * Regression guard — owner note #8 (2026-09-23, web app): hasan halawi's
 * debt was $0 / 2,520,000 LBP. He paid $25 cash + 300,000 LBP cash and kept
 * the change (T3 keep-change). The debt should have cleared to EXACTLY
 * 2,520,000 LBP / $0, but the app booked "debt payment $0 + 2,519,660 LBP"
 * and left the client's account short by a phantom 340 LBP.
 *
 * Root cause (confirmed by executing the real functions before this fix):
 * `MultiPaymentInput` computes the kept-change amount via
 * `allocatePayments(...)` with its DEFAULT options, which rounds `change`
 * to each currency's display precision (USD → 2 decimals) — correct for
 * showing "$0.06 kept" in the UI, wrong for accounting. At rate 89,000 the
 * TRUE excess is $0.056179775280899236, not $0.06. `Debts/index.tsx` fed
 * that rounded $0.06 into `computeRepaymentReduction`'s cross-currency
 * conversion — itself correct given its inputs — which manufactured a 340
 * LBP shortfall the smart-rounding band (`Math.abs(...) < 1000`) doesn't
 * absorb.
 *
 * This test exercises the COMPOSITION that was broken end-to-end: the real
 * `allocatePayments` engine's rounded output, run through
 * `resolveKeptChangeForReduction` (the function `Debts/index.tsx` calls to
 * decide what to net out of the tender), fed into the real
 * `computeRepaymentReduction`. A unit test of `computeRepaymentReduction`
 * alone (see repaymentReduction.test.ts) passes today and proves nothing
 * about this bug — the reduction math is correct FOR THE INPUT IT IS GIVEN.
 * The defect is in what upstream code passes it, i.e. in
 * `resolveKeptChangeForReduction`.
 *
 * FAILING-FIRST PROOF ACTUALLY RUN (this repo, 2026-09-23), by temporarily
 * reintroducing the bug per CLAUDE.md rule 17:
 *   1. `resolveKeptChangeForReduction` was implemented to return the
 *      ROUNDED `{ usd, lbp }` only (ignoring `exactUsd`/`exactLbp`) — this
 *      is what shipped.
 *   2. `npx jest repaymentReduction.keptChangeComposition --config
 *      frontend/jest.config.ts` from `frontend/`: the "clears the debt
 *      exactly" test FAILED —
 *      `expect(received).toBe(expected) // Object.is equality
 *       Expected: 2520000
 *       Received: 2519660`
 *      — reproducing the customer's exact 340 LBP shortfall via the same
 *      composition the app uses.
 *   3. `resolveKeptChangeForReduction` was corrected to prefer
 *      `exactUsd`/`exactLbp` (falling back to the rounded figure only when
 *      absent).
 *   4. Re-ran the same command: all tests GREEN.
 */
describe("kept-change -> debt reduction composition (owner note #8)", () => {
  const RATE = 89_000; // buy rate, matching the repayment modal's side
  const rates = { base: "USD", rates: { LBP: { buy: RATE, sell: RATE } } };

  // The exact allocatePayments call MultiPaymentInput performs for this
  // scenario: $0 / 2,520,000 LBP owed, tendered $25 cash + 300,000 LBP cash,
  // keep-change on (the full excess becomes "kept" rather than an OUT leg).
  const allocationInput = {
    totals: [{ amount: 2_520_000, currency: "LBP" }],
    payments: [
      { amount: 25, currency: "USD" },
      { amount: 300_000, currency: "LBP" },
    ],
    rates,
    side: "buy" as const,
  };

  function keptChangeReportFromAllocation() {
    const rounded = allocatePayments(allocationInput); // default: round: true
    const exact = allocatePayments(allocationInput, { round: false });
    return {
      usd: rounded.change.find((m) => m.currency === "USD")?.amount ?? 0,
      lbp: rounded.change.find((m) => m.currency === "LBP")?.amount ?? 0,
      exactUsd: exact.change.find((m) => m.currency === "USD")?.amount ?? 0,
      exactLbp: exact.change.find((m) => m.currency === "LBP")?.amount ?? 0,
    };
  }

  it("documents the true excess: rounded (display) vs exact (accounting) diverge", () => {
    const kept = keptChangeReportFromAllocation();
    expect(kept.usd).toBe(0.06);
    expect(kept.exactUsd).toBeCloseTo(0.056179775280899236, 10);
    expect(kept.usd).not.toBe(kept.exactUsd);
  });

  it("clears the debt exactly for the composition Debts/index.tsx actually runs", () => {
    const kept = keptChangeReportFromAllocation();
    const { usd: returnedUsdFromKept, lbp: returnedLbpFromKept } =
      resolveKeptChangeForReduction(kept);

    const { reduceUsd, reduceLbp } = computeRepaymentReduction({
      paidUsd: 25,
      paidLbp: 300_000,
      returnedUsd: returnedUsdFromKept,
      returnedLbp: returnedLbpFromKept,
      dueUsd: 0,
      dueLbp: 2_520_000,
      rate: RATE,
    });

    expect(reduceUsd).toBe(0);
    // Owner note #8's exact bug, pinned: the shortfall was 340 LBP
    // (2,520,000 - 2,519,660). This must be 0 post-fix.
    expect(2_520_000 - reduceLbp).toBe(0);
    expect(reduceLbp).toBe(2_520_000);
  });
});
