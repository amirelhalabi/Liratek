/**
 * E2E: LIRA-116 (PFT-R) — a Loto ticket sale "for the partner" books the
 * FULL sale_amount to partner_ledger (FOR_LOTO DEBIT) and takes NO counter
 * payment at the counter. This is the owner-validated full-amount model
 * (docs/plans/PARTNER_FOR_TRANSACTIONS_PLAN.md § "VALIDATED FLOW CATALOG"),
 * which SUPERSEDES the earlier PFT-4 "remainder after customer cash" model
 * this spec originally guarded (d91785d) — there is no walk-in customer in
 * a "for partner" transaction, so no counter cash is ever taken; the
 * partner owes the full amount, settled later on the Partners page.
 *
 * UNLIKE lira-113 (POS), there is NO void step: LOTO is in
 * NON_REVERSIBLE_TRANSACTION_TYPES (packages/core/src/constants/transactionTypes.ts),
 * so TransactionRepository.voidTransaction/refundTransaction THROW before
 * ever reaching a partner-ledger reversal for a LOTO transaction — there is
 * no loto void path to exercise. The FOR_LOTO row's reversal owner is
 * partner settlement, exactly like the pre-existing non-reversible
 * 'Loto Debt' row (rule 20 is satisfied because the type is already gated
 * non-reversible).
 *
 * Money invariants under guard (rule 15 — deltas + identity only):
 *   - Happy path: a partner ticket with NO payment legs books the FULL
 *     500,000 LBP sale_amount to the partner (FOR_LOTO DEBIT); the General
 *     LBP drawer is untouched (delta 0) — no counter cash at all.
 *   - Rejection: a partner ticket that ALSO carries a 200,000 LBP CASH leg
 *     is rejected outright (result.ok === false) and moves nothing — a
 *     partner ticket takes no counter payment, full stop.
 *
 * Rule 17 (failing-first): BOTH tests fail on the currently-committed code
 * (the PFT-4 "remainder" model), for two different reasons:
 *   - The rejection test fails outright: committed code computes
 *     remainderLbp = sale_amount − paidLbp = 500,000 − 200,000 = 300,000 LBP
 *     and happily books that remainder to the partner while letting the
 *     200,000 LBP CASH leg post to the General drawer — `res.success` comes
 *     back `true`, not the `false` this spec requires (the canonical
 *     failing assertion: `expect(result.ok).toBe(false)`).
 *   - The happy-path (no-legs) test ALSO fails pre-fix, for an unrelated
 *     reason: with no `payments` array and no explicit `payment_method`,
 *     committed code's legacy fallback defaults `paymentMethod` to "CASH"
 *     and posts the FULL 500,000 LBP to the General drawer (a pre-existing
 *     partner-mode double-booking this fix also closes) while ALSO booking
 *     the 500,000 LBP remainder to the partner — so the drawer-delta-0
 *     assertion fails pre-fix too (observed drawer delta 500,000, not 0).
 */

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

type Api = {
  api: {
    partners: {
      create: (d: {
        name: string;
        phone?: string;
        notes?: string;
      }) => Promise<{ success: boolean; data?: { id: number }; error?: string }>;
      getBalance: (partnerId: number) => Promise<{ usd: number; lbp: number }>;
    };
    loto: {
      sell: (d: unknown) => Promise<{
        success: boolean;
        ticket?: { id: number };
        error?: string;
      }>;
    };
    recharge: {
      getDrawerBalances: () => Promise<
        Array<{ name: string; usdBalance: number; lbpBalance: number }>
      >;
    };
  };
};

async function generalLbp(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const w = window as unknown as Api;
    const rows = await w.api.recharge.getDrawerBalances();
    return rows.find((d) => d.name === "General")?.lbpBalance ?? 0;
  });
}

async function createPartner(page: Page, tag: string): Promise<number> {
  return page.evaluate(async ({ tag }) => {
    const w = window as unknown as Api;
    const created = await w.api.partners.create({
      name: `${tag} ${Date.now()}`,
      phone: `${tag}${Date.now()}`,
    });
    if (!created.success || !created.data) {
      throw new Error(created.error ?? "partner create failed");
    }
    return created.data.id;
  }, { tag });
}

async function partnerLbp(page: Page, partnerId: number): Promise<number> {
  return page.evaluate(async ({ partnerId }) => {
    const w = window as unknown as Api;
    return (await w.api.partners.getBalance(partnerId)).lbp;
  }, { partnerId });
}

test.describe("LIRA-116 — Loto ticket for a partner (full-amount model, no counter cash)", () => {
  test("no payment legs: FULL sale_amount → partner FOR_LOTO DEBIT; drawer untouched", async ({
    appPage,
  }) => {
    const NOTE = `L116a ${Date.now()}`;

    const partnerId = await createPartner(appPage, "L116a-Partner");
    const partnerBefore = await partnerLbp(appPage, partnerId);
    const drawerBefore = await generalLbp(appPage);

    const result = await appPage.evaluate(
      async ({ partnerId, note }) => {
        const w = window as unknown as Api;
        // 500,000 LBP ticket, "for" the partner — NO payment legs at all:
        // there is no walk-in customer, so no counter cash is taken.
        const res = await w.api.loto.sell({
          sale_amount: 500000,
          partnerId,
          partnerMode: "FOR",
          exchange_rate: 100000,
          note,
        });
        return { ok: res.success, error: res.error ?? null };
      },
      { partnerId, note: NOTE },
    );

    expect(result.error).toBeNull();
    expect(result.ok).toBe(true);

    const partnerAfter = await partnerLbp(appPage, partnerId);
    const drawerAfter = await generalLbp(appPage);

    // Full amount, no counter cash: the partner owes the entire 500,000 LBP
    // ticket; the General LBP drawer never moves.
    expect(partnerAfter - partnerBefore).toBeCloseTo(500000, 0);
    expect(drawerAfter - drawerBefore).toBeCloseTo(0, 0);
  });

  test("a counter-payment leg in partner mode is rejected outright (no partial booking)", async ({
    appPage,
  }) => {
    const NOTE = `L116b ${Date.now()}`;

    const partnerId = await createPartner(appPage, "L116b-Partner");
    const partnerBefore = await partnerLbp(appPage, partnerId);
    const drawerBefore = await generalLbp(appPage);

    const result = await appPage.evaluate(
      async ({ partnerId, note }) => {
        const w = window as unknown as Api;
        // Same 500,000 LBP partner ticket, but this time a 200,000 LBP CASH
        // leg tries to pay part of it at the counter — must be rejected.
        const res = await w.api.loto.sell({
          sale_amount: 500000,
          partnerId,
          partnerMode: "FOR",
          payments: [
            {
              method: "CASH",
              currencyCode: "LBP",
              amount: 200000,
              direction: "IN",
            },
          ],
          exchange_rate: 100000,
          note,
        });
        return { ok: res.success, error: res.error ?? null };
      },
      { partnerId, note: NOTE },
    );

    // The failing-first assertion (rule 17): on the committed PFT-4
    // "remainder" code this call SUCCEEDS (books the 300,000 LBP remainder
    // to the partner and lets the 200,000 LBP CASH leg hit the drawer).
    // Post-fix, a partner ticket takes no counter payment at all.
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no counter payment/i);

    // Rejected atomically inside the DB transaction: neither the partner
    // tab nor the drawer moved at all.
    const partnerAfter = await partnerLbp(appPage, partnerId);
    const drawerAfter = await generalLbp(appPage);
    expect(partnerAfter - partnerBefore).toBeCloseTo(0, 0);
    expect(drawerAfter - drawerBefore).toBeCloseTo(0, 0);
  });
});
