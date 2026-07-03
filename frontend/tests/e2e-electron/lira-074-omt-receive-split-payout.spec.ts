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
  test("split cash payout (USD + LBP) deducts BOTH currency legs from the General drawer", async ({
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
      };
    });

    expect(result.error).toBeNull();
    expect(result.success).toBe(true);
    expect(result.id).not.toBeNull();

    // ── The C1 fix: BOTH payout legs leave the General drawer ────────────────
    // USD leg: −190 (was −196 before, over-counting USD).
    expect(result.generalUsdDelta).toBeCloseTo(-190, 2);
    // LBP leg: −540,000 (was 0 before — the dropped leg this bug is about).
    expect(result.generalLbpDelta).toBeCloseTo(-540000, 2);

    // Sanity: the provider still owes the shop (OMT system drawer went negative
    // by at least the transfer amount). Loose bound — commission may add to it.
    expect(result.omtUsdDelta).toBeLessThanOrEqual(-196);
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
      };
    });

    expect(result.error).toBeNull();
    expect(result.success).toBe(true);
    // Only USD moves; LBP untouched for a single-USD payout.
    expect(result.generalUsdDelta).toBeCloseTo(-100, 2);
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
      };
    });

    expect(result.error).toBeNull();
    expect(result.success).toBe(true);
    expect(result.generalUsdDelta).toBeCloseTo(-100, 2);
    // OUT leg debited ONCE (−50,000), not twice (−100,000 was the double-debit bug).
    expect(result.generalLbpDelta).toBeCloseTo(-50000, 2);
  });
});
