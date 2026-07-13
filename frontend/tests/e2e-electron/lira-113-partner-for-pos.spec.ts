/**
 * E2E: LIRA-113 (PFT-2) — a POS sale "for the partner" books its unpaid
 * remainder to partner_ledger (FOR_POS DEBIT) instead of a client's
 * debt_ledger, and voiding the sale reverses that partner row to net 0.
 *
 * Owner ask (docs/plans/PARTNER_FOR_TRANSACTIONS_PLAN.md, PFT-2): a
 * FOR-partner transaction is a normal sale — same stock, same sell-price, cash
 * collected to the drawer as usual — with ONE difference: the remainder the
 * customer did NOT pay lands on the selected partner's account, not a client's.
 * No partner is a client here (client_id === null), so pre-PFT-2 the remainder
 * had nowhere to go but debt_ledger, which throws for an anonymous client.
 *
 * Money invariants under guard (rule 15 — deltas + identity only):
 *   - routing: partner balance (USD) rises by exactly the remainder ($60 on a
 *     $100 sale paid $40 cash); the drawer still takes the $40 cash.
 *   - reversal (rule 20): voiding the SALE transaction writes the negating
 *     partner_ledger CREDIT so the partner balance nets back to exactly 0.
 *
 * Rule 17 (failing-first): with the PFT-2 core files stash-reverted, the
 * validator strips partnerId/partnerMode, the sale takes the client-debt branch
 * with a null client_id, and process() fails with "Cannot create debt for
 * anonymous client" — the `result.ok === true` assertion below fails. Proof run
 * recorded in the plan.
 */

import { test, expect, seedProduct } from "./fixtures";
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

test.describe("LIRA-113 — POS sale for a partner books the remainder to partner_ledger", () => {
  test("remainder → partner FOR_POS DEBIT (not client debt); cash to drawer; void nets partner to 0", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const NAME = `L113 PartnerPOS ${ts}`;
    // cost 60, sell 100; customer pays $40 CASH now → partner owes the $60
    // remainder on their account.
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
          };
        }
        const partnerId = created.data.id;
        const balUsd = async () =>
          (await w.api.partners.getBalance(partnerId)).usd;

        const partnerBalBefore = await balUsd();

        const res = await w.api.sales.process({
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
            { method: "CASH", currency_code: "USD", amount: 40, direction: "IN" },
          ],
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
        };
      },
      { productId, name: NAME },
    );

    expect(result.error).toBeNull();
    expect(result.ok).toBe(true);

    // Routing: the partner now owes the $60 remainder — booked as FOR_POS
    // DEBIT (positive balance = partner owes the shop). Pre-PFT-2 this path
    // throws for the anonymous client, so process() never reaches here.
    expect(result.partnerBalAfterSale - result.partnerBalBefore).toBeCloseTo(
      60,
      2,
    );

    // The drawer still takes the $40 cash the customer paid.
    const drawerAfterSale = await generalUsd(appPage);
    expect(drawerAfterSale - drawerBefore).toBeCloseTo(40, 2);

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

    // And the drawer gives the $40 cash back on void.
    const drawerAfterVoid = await generalUsd(appPage);
    expect(drawerAfterVoid - drawerBefore).toBeCloseTo(0, 2);
  });
});
