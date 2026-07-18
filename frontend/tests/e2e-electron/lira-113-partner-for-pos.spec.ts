/**
 * E2E: LIRA-113 (PFT-R, revising PFT-2/ddae06f) — a POS sale "for the
 * partner" books the FULL sale amount to partner_ledger (FOR_POS DEBIT), not
 * a "remainder after cash" figure, and takes NO counter payment at all.
 * Voiding the sale reverses that partner row to net 0.
 *
 * Owner-validated flow catalog (docs/plans/done_plans/PARTNER_FOR_TRANSACTIONS_PLAN.md,
 * "⭐ VALIDATED FLOW CATALOG" — supersedes the PFT-2 walk-in/remainder model):
 * a FOR-partner transaction has NO walk-in customer in between. No cash or
 * wallet payment is taken at the counter; the partner owes the FULL
 * transaction amount, settled later on the Partners page. A partner is never
 * a client here (client_id === null).
 *
 * Money invariants under guard (rule 15 — deltas + identity only):
 *   - routing: partner balance (USD) rises by exactly the FULL sale amount
 *     ($100 on a $100 sale, no legs at all); the General drawer is untouched.
 *   - counter-payment rejection: submitting ANY customer-paid IN leg (e.g. a
 *     $40 CASH leg) in partner mode is rejected outright — the sale never
 *     commits, so it must NOT be reachable via a "book the remainder instead"
 *     fallback.
 *   - reversal (rule 20): voiding the SALE transaction writes the negating
 *     partner_ledger CREDIT so the partner balance nets back to exactly 0.
 *
 * Rule 17 (failing-first): the happy-path (no-legs, full-100) assertions do
 * NOT discriminate old vs. new code — on the committed remainder-model code,
 * a no-legs partner sale ALSO computes remainder = final_amount − 0 = 100 and
 * books 100 with the drawer untouched (same numbers, different code path).
 * The ONLY assertion that actually fails on the committed code is the
 * CASH-leg-rejection sub-case: committed code happily accepts a $40 CASH IN
 * leg, books the $60 remainder, and returns `result.ok === true`; the
 * revised code must reject it (`result.ok === false`, error mentioning "no
 * counter payment"). That is THE failing-first assertion for this spec.
 */

import { test, expect, seedProduct } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

type Api = {
  api: {
    partners: {
      create: (d: { name: string; phone?: string; notes?: string }) => Promise<{
        success: boolean;
        data?: { id: number };
        error?: string;
      }>;
      getBalance: (partnerId: number) => Promise<{ usd: number; lbp: number }>;
    };
    sales: {
      process: (
        d: unknown,
      ) => Promise<{ success: boolean; id?: number; error?: string }>;
    };
    transactions: {
      getRecent: (
        limit: number,
      ) => Promise<Array<{ id: number; type: string; summary: string | null }>>;
      void: (id: number) => Promise<{ success: boolean; error?: string }>;
    };
    recharge: {
      getDrawerBalances: () => Promise<
        Array<{ name: string; usdBalance: number }>
      >;
    };
  };
};

async function generalUsd(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const w = window as unknown as Api;
    const rows = await w.api.recharge.getDrawerBalances();
    return rows.find((d) => d.name === "General")?.usdBalance ?? 0;
  });
}

test.describe("LIRA-113 — POS sale for a partner books the FULL amount, no counter payment", () => {
  test("no-legs partner sale books full $100 to partner, drawer untouched; a CASH leg is REJECTED; void nets partner to 0", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const NAME = `L113 PartnerPOS ${ts}`;
    // cost 60, sell 100 — the partner owes the full $100, no cash collected.
    const productId = await seedProduct(appPage, {
      name: NAME,
      cost_price: 60,
      sell_price: 100,
      quantity: 5,
    });

    const drawerBefore = await generalUsd(appPage);

    const result = await appPage.evaluate(
      async ({ productId, name }) => {
        const w = window as unknown as Api;

        const created = await w.api.partners.create({
          name: `${name} Partner`,
          phone: `L113${Date.now()}`.slice(0, 12),
        });
        if (!created.success || !created.data) {
          return {
            ok: false,
            error: created.error ?? "partner create failed",
            partnerId: 0,
            partnerBalBefore: 0,
            partnerBalAfterSale: 0,
            // Rejection sub-case results (populated below).
            rejectOk: false,
            rejectError: null as string | null,
            partnerBalAfterReject: 0,
          };
        }
        const partnerId = created.data.id;
        const balUsd = async () =>
          (await w.api.partners.getBalance(partnerId)).usd;

        const partnerBalBefore = await balUsd();

        // THE failing-first sub-case (rule 17): a partner sale carrying a
        // counter-cash IN leg must be REJECTED outright. On the committed
        // (remainder-model) code this is ACCEPTED and books the $60
        // remainder instead of the full $100 — `rejectOk` would read `true`
        // there. A valid partnerId is passed so the throw hit is the
        // counter-payment guard, not the "partnerId is required" guard.
        const rejected = await w.api.sales.process({
          client_id: null,
          partnerId,
          partnerMode: "FOR",
          items: [{ product_id: productId, quantity: 1, price: 100 }],
          total_amount: 100,
          discount: 0,
          final_amount: 100,
          payment_usd: 40,
          payment_lbp: 0,
          payments: [
            {
              method: "CASH",
              currency_code: "USD",
              amount: 40,
              direction: "IN",
            },
          ],
          change_given_usd: 0,
          change_given_lbp: 0,
          exchange_rate: 90000,
        });

        // The rejected attempt must not have moved the partner balance at all.
        const partnerBalAfterReject = await balUsd();

        // Now the real (accepted) FOR-partner sale: NO payment legs at all —
        // the full $100 goes on the partner's tab.
        const res = await w.api.sales.process({
          client_id: null,
          partnerId,
          partnerMode: "FOR",
          items: [{ product_id: productId, quantity: 1, price: 100 }],
          total_amount: 100,
          discount: 0,
          final_amount: 100,
          payment_usd: 0,
          payment_lbp: 0,
          payments: [],
          change_given_usd: 0,
          change_given_lbp: 0,
          exchange_rate: 90000,
        });

        return {
          ok: res.success,
          error: res.error ?? null,
          partnerId,
          partnerBalBefore,
          partnerBalAfterSale: await balUsd(),
          rejectOk: rejected.success,
          rejectError: rejected.error ?? null,
          partnerBalAfterReject,
        };
      },
      { productId, name: NAME },
    );

    // THE failing-first assertion (rule 17): the CASH-leg submission in
    // partner mode must be rejected. On committed code this is `true` and
    // the remainder ($60) is booked — that is the exact bug this spec guards.
    expect(result.rejectOk).toBe(false);
    expect(result.rejectError ?? "").toContain("no counter payment");
    // The rejected attempt is a no-op — the partner balance must not have
    // moved at all as a side effect of the rejected call.
    expect(result.partnerBalAfterReject - result.partnerBalBefore).toBeCloseTo(
      0,
      2,
    );

    expect(result.error).toBeNull();
    expect(result.ok).toBe(true);

    // Routing: the partner now owes the FULL $100 (never a "remainder after
    // cash" figure) — booked as FOR_POS DEBIT (positive balance = partner
    // owes the shop).
    expect(result.partnerBalAfterSale - result.partnerBalBefore).toBeCloseTo(
      100,
      2,
    );

    // No counter cash was taken — the General drawer is untouched.
    const drawerAfterSale = await generalUsd(appPage);
    expect(drawerAfterSale - drawerBefore).toBeCloseTo(0, 2);

    // Reversal symmetry (rule 20): voiding the SALE writes the negating
    // partner_ledger CREDIT → partner balance nets back to exactly 0.
    const netted = await appPage.evaluate(
      async ({ name, partnerId, partnerBalBefore }) => {
        const w = window as unknown as Api;
        const row = (await w.api.transactions.getRecent(100)).find(
          (t) => t.type === "SALE" && (t.summary ?? "").includes(name),
        );
        const voided = row
          ? await w.api.transactions.void(row.id)
          : { success: false, error: "sale txn not found" };
        const after = (await w.api.partners.getBalance(partnerId)).usd;
        return {
          ok: voided.success,
          error: voided.error ?? null,
          netPartnerDelta: after - partnerBalBefore,
        };
      },
      {
        name: NAME,
        partnerId: result.partnerId,
        partnerBalBefore: result.partnerBalBefore,
      },
    );

    expect(netted.error).toBeNull();
    expect(netted.ok).toBe(true);
    expect(netted.netPartnerDelta).toBeCloseTo(0, 2);

    // The drawer stays untouched through the void too (nothing was ever
    // taken from it).
    const drawerAfterVoid = await generalUsd(appPage);
    expect(drawerAfterVoid - drawerBefore).toBeCloseTo(0, 2);
  });
});
