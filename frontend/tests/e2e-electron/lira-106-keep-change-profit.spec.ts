/**
 * E2E: LIRA-106 (T3, KC-1) — "Keep change": the shop returns nothing and the
 * kept change books as PROFIT on the sale transaction.
 *
 * Owner ask (docs/plans/done_plans/T3_KEEP_CHANGE_PLAN.md): when a customer overpays,
 * the operator can keep the extra — the drawer keeps the FULL tender (no OUT
 * legs) and the kept amounts join the per-currency profit stamp
 * (transactions.profit_usd / profit_lbp).
 *
 * Money invariants under guard (rule 15 — deltas + identity only):
 *   - drawer: General keeps the full tender (+150 on a $100 sale paid $150)
 *   - profit: margin + kept change (40 + 50 = 90), not just the margin
 *   - reversal (rule 20): the generic refund negates the WHOLE stamp and
 *     returns the full tender → profit AND drawer net to exactly 0
 *
 * Rule 17: with the schema/repo changes stash-reverted, the kept_change_*
 * fields are stripped by validation and the profit delta is 40 — the profit
 * assertion below fails (proof run recorded in the plan).
 */

import { test, expect, seedProduct } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

const FROM = "2000-01-01";
const TO = "2099-12-31";

type Api = {
  api: {
    profits: {
      summary: (
        from: string,
        to: string,
      ) => Promise<{ sales: { profit_usd: number } }>;
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
      refund: (id: number) => Promise<{ success: boolean; error?: string }>;
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

test.describe("LIRA-106 — keep change books as profit", () => {
  test("kept change joins the profit stamp, drawer keeps the tender, refund nets both to 0", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const NAME = `L106 KeepChange ${ts}`;
    // cost 60, sell 100 → margin 40; paid $150 CASH, kept change $50 →
    // profit stamp 90.
    const productId = await seedProduct(appPage, {
      name: NAME,
      cost_price: 60,
      sell_price: 100,
      quantity: 5,
    });

    const drawerBefore = await generalUsd(appPage);

    const result = await appPage.evaluate(
      async ({ FROM, TO, productId }) => {
        const w = window as unknown as Api;
        const s = async () => (await w.api.profits.summary(FROM, TO)).sales
          .profit_usd;

        const before = await s();
        const res = await w.api.sales.process({
          client_id: null,
          items: [{ product_id: productId, quantity: 1, price: 100 }],
          total_amount: 100,
          discount: 0,
          final_amount: 100,
          payment_usd: 150,
          payment_lbp: 0,
          // Full tender as one IN leg; keep-change means NO OUT legs and
          // change_given_* stays 0 — the $50 extra is kept as profit.
          payments: [
            {
              method: "CASH",
              currency_code: "USD",
              amount: 150,
              direction: "IN",
            },
          ],
          change_given_usd: 0,
          change_given_lbp: 0,
          kept_change_usd: 50,
          kept_change_lbp: 0,
          exchange_rate: 90000,
        });
        const afterSale = await s();

        return {
          ok: res.success,
          error: res.error ?? null,
          saleDelta: afterSale - before,
          before,
        };
      },
      { FROM, TO, productId },
    );

    expect(result.error).toBeNull();
    expect(result.ok).toBe(true);
    // Margin 40 + kept 50. Pre-fix (schema strips kept_change_*): 40.
    expect(result.saleDelta).toBeCloseTo(90, 2);

    // Drawer keeps the FULL tender — nothing was returned.
    const drawerAfterSale = await generalUsd(appPage);
    expect(drawerAfterSale - drawerBefore).toBeCloseTo(150, 2);

    // Reversal symmetry (rule 20): generic refund negates the whole stamp
    // (margin AND kept change) and hands the full tender back.
    const netted = await appPage.evaluate(
      async ({ FROM, TO, name, before }) => {
        const w = window as unknown as Api;
        const row = (await w.api.transactions.getRecent(100)).find(
          (t) => t.type === "SALE" && (t.summary ?? "").includes(name),
        );
        const refund = row
          ? await w.api.transactions.refund(row.id)
          : { success: false, error: "sale txn not found" };
        const after = (await w.api.profits.summary(FROM, TO)).sales.profit_usd;
        return {
          ok: refund.success,
          error: refund.error ?? null,
          netProfitDelta: after - before,
        };
      },
      { FROM, TO, name: NAME, before: result.before },
    );

    expect(netted.error).toBeNull();
    expect(netted.ok).toBe(true);
    expect(netted.netProfitDelta).toBeCloseTo(0, 2);

    const drawerAfterRefund = await generalUsd(appPage);
    expect(drawerAfterRefund - drawerBefore).toBeCloseTo(0, 2);
  });
});
