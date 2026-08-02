/**
 * E2E: LIRA-074 (C1) — OMT/WHISH system RECEIVE split-currency cashout
 *
 * Regression for the bug where a system RECEIVE paid out to the customer in TWO
 * currencies (e.g. a 196-USD INTRA transfer paid as 190 USD + 540,000 LBP) only
 * deducted the primary-currency leg from the General drawer — the LBP leg was
 * silently dropped, so General LBP never moved.
 *
 * Fix (FinancialServiceRepository.createTransaction, RECEIVE CASH cashout):
 * deduct EACH payout leg from its drawer in its own currency.
 *
 * IPC-driven over the shared per-worker DB. Per the shared-DB rules we assert
 * DELTAS around the action (snapshot drawer balances immediately before/after),
 * never absolute totals or row position.
 *
 * UPDATED (float model, 2026-07-29, docs/FEATURE_GUIDE.md §7/§8.1): OMT_System
 * is now a spendable float — RECEIVE fills it up by the BARE principal `x`
 * only. The float posting (`+receiveAmount`) is unconditional and reads
 * neither the provider fee `f` nor the commission `c` at all (they only ever
 * feed the supplier-ledger booking, never this leg) — so the old loose "at
 * least 196, commission may add more" bound is gone: there is nothing left
 * that COULD add to it, fee/commission present or not. This suite's own
 * fixture happens to auto-resolve a nonzero commission from the INTRA fee
 * table for amount=196 (irrelevant here — proves the point). Hand-derived
 * from `FinancialServiceRepository.ts`'s RECEIVE branch (`+receiveAmount`
 * posted once, unconditionally, before the cashout-method branch) —
 * unexecuted.
 */

import { test, expect } from "./fixtures";

test.describe.configure({ retries: 0 });

// Minimal window.api surface used here (electron.d.ts omt type is loosely typed;
// dashboard.getDrawerBalances is the accumulated-balance reader the dashboard uses).
type Api = {
  api: {
    omt: {
      addTransaction: (data: {
        provider: string;
        serviceType: "SEND" | "RECEIVE" | "BILL";
        amount: number;
        currency?: string;
        commission?: number;
        omtServiceType?: string;
        cashoutMethod?: string;
        payments?: Array<{
          method: string;
          currencyCode: string;
          amount: number;
          direction?: "IN" | "OUT";
        }>;
      }) => Promise<{ success?: boolean; id?: number; error?: string }>;
    };
    dashboard: {
      getDrawerBalances: () => Promise<{
        generalDrawer: { usd: number; lbp: number };
        omtDrawer: { usd: number; lbp: number };
      }>;
    };
  };
};

test.describe("LIRA-074 (C1) — OMT system RECEIVE split-currency cashout", () => {
  test("split cash payout (USD + LBP) deducts BOTH currency legs from the OMT cash drawer", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(async () => {
      const w = window as unknown as Api;

      const before = await w.api.dashboard.getDrawerBalances();

      // 196 USD INTRA receive paid out as a split: 190 USD + 540,000 LBP cash.
      const res = await w.api.omt.addTransaction({
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 196,
        currency: "USD",
        commission: 0,
        omtServiceType: "INTRA",
        cashoutMethod: "CASH",
        payments: [
          { method: "CASH", currencyCode: "USD", amount: 190 },
          { method: "CASH", currencyCode: "LBP", amount: 540000 },
        ],
      });

      const after = await w.api.dashboard.getDrawerBalances();

      return {
        success: res?.success === true,
        error: res?.error ?? null,
        id: res?.id ?? null,
        generalUsdDelta: after.generalDrawer.usd - before.generalDrawer.usd,
        generalLbpDelta: after.generalDrawer.lbp - before.generalDrawer.lbp,
        omtUsdDelta: after.omtDrawer.usd - before.omtDrawer.usd,
        omtLbpDelta: after.omtDrawer.lbp - before.omtDrawer.lbp,
      };
    });

    expect(result.error).toBeNull();
    expect(result.success).toBe(true);
    expect(result.id).not.toBeNull();

    // ── The C1 fix, now landing in the OMT drawer ────────────────────────────
    // The bug this spec exists for is UNCHANGED and still guarded: BOTH payout
    // legs must be debited, each in its own currency. Only the drawer they
    // leave has moved — cash for an OMT transaction is the OMT drawer's cash.
    // USD leg: −190 (over-counting USD as −196 was one half of the C1 bug).
    expect(result.omtUsdDelta).toBeCloseTo(-190, 2);
    // LBP leg: −540,000 (silently dropped to 0 was the other half).
    expect(result.omtLbpDelta).toBeCloseTo(-540000, 2);

    // The till does not participate in an OMT transaction at all. Under the
    // float model this spec asserted these very deltas on General, so this
    // pair is what catches a regression that reroutes cash back to the till.
    expect(result.generalUsdDelta).toBeCloseTo(0, 2);
    expect(result.generalLbpDelta).toBeCloseTo(0, 2);
    // NOTE: there is deliberately no "+196 fills the float" assertion any
    // more. The float leg is deleted — a RECEIVE moves cash out of a real
    // drawer and books the provider's obligation, it does not mirror itself
    // into a second balance.
  });

  test("single-currency cash payout still deducts exactly one currency (no regression)", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(async () => {
      const w = window as unknown as Api;

      const before = await w.api.dashboard.getDrawerBalances();

      // No split legs → falls back to the single-currency payout path.
      const res = await w.api.omt.addTransaction({
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USD",
        commission: 0,
        omtServiceType: "INTRA",
        cashoutMethod: "CASH",
      });

      const after = await w.api.dashboard.getDrawerBalances();

      return {
        success: res?.success === true,
        error: res?.error ?? null,
        generalUsdDelta: after.generalDrawer.usd - before.generalDrawer.usd,
        generalLbpDelta: after.generalDrawer.lbp - before.generalDrawer.lbp,
        omtUsdDelta: after.omtDrawer.usd - before.omtDrawer.usd,
        omtLbpDelta: after.omtDrawer.lbp - before.omtDrawer.lbp,
      };
    });

    expect(result.error).toBeNull();
    expect(result.success).toBe(true);
    // Only USD moves; LBP untouched for a single-USD payout — the regression
    // guard is that a single-currency payout must not smear across currencies.
    expect(result.omtUsdDelta).toBeCloseTo(-100, 2);
    expect(result.omtLbpDelta).toBeCloseTo(0, 2);
    // Till untouched.
    expect(result.generalUsdDelta).toBeCloseTo(0, 2);
    expect(result.generalLbpDelta).toBeCloseTo(0, 2);
  });

  test("an OUT (change) leg is debited exactly once — no double-debit", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(async () => {
      const w = window as unknown as Api;

      const before = await w.api.dashboard.getDrawerBalances();

      // 100 USD payout (IN leg) + a 50,000 LBP change leg tagged OUT.
      const res = await w.api.omt.addTransaction({
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USD",
        commission: 0,
        omtServiceType: "INTRA",
        cashoutMethod: "CASH",
        payments: [
          { method: "CASH", currencyCode: "USD", amount: 100 },
          {
            method: "CASH",
            currencyCode: "LBP",
            amount: 50000,
            direction: "OUT",
          },
        ],
      });

      const after = await w.api.dashboard.getDrawerBalances();

      return {
        success: res?.success === true,
        error: res?.error ?? null,
        generalUsdDelta: after.generalDrawer.usd - before.generalDrawer.usd,
        generalLbpDelta: after.generalDrawer.lbp - before.generalDrawer.lbp,
        omtUsdDelta: after.omtDrawer.usd - before.omtDrawer.usd,
        omtLbpDelta: after.omtDrawer.lbp - before.omtDrawer.lbp,
      };
    });

    expect(result.error).toBeNull();
    expect(result.success).toBe(true);
    expect(result.omtUsdDelta).toBeCloseTo(-100, 2);
    // CLAUDE.md rule 16, the whole point of this case: the OUT (change) leg is
    // debited ONCE (−50,000), not twice (−100,000 was the double-debit bug).
    // Rerouting the drawer does not change that risk — the shared return-leg
    // loop still owns OUT legs, and a flow branch that also iterated them
    // would now double-debit the OMT drawer instead of General.
    expect(result.omtLbpDelta).toBeCloseTo(-50000, 2);
    expect(result.generalUsdDelta).toBeCloseTo(0, 2);
    expect(result.generalLbpDelta).toBeCloseTo(0, 2);
  });
});
