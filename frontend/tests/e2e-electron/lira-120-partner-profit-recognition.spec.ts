/**
 * E2E: LIRA-120 (PFT-6 + PFT-6b) — for-partner profit is recognized when the
 * partner SETTLES, and a settlement MOVES REAL MONEY into the drawer.
 *
 * Owner decisions (docs/plans/done_plans/PARTNER_FOR_TRANSACTIONS_PLAN.md):
 *   - Model A (2026-07-13): for-partner margin/markup/commission is real only
 *     once the partner pays — EXCEPT iPick/Katsh (immediate).
 *   - PFT-6b (2026-07-14): a settlement credits/debits the method's drawer
 *     (CASH→General) with a unified PARTNER_SETTLEMENT transaction.
 *
 * Mechanism under guard: SETTLEMENT rows apply FIFO coverage to the
 * partner's FOR_% ledger rows (v128 covered_amount); ProfitRepository's
 * partner gates (notPartnerPending / salePaidOrPartnerSettled) exclude
 * uncovered for-partner sources from realized profit.
 *
 * Rule 17 (failing-first) — on pre-PFT-6 code:
 *   - the "recharge profit is 0 while unsettled" assert FAILS (recharge had
 *     NO pay gate → markup counted immediately);
 *   - the "FS commission is 0 while unsettled" assert FAILS (OMT_APP rows are
 *     is_settled=1 → counted immediately);
 *   - the "General +settled amount" assert FAILS (settle moved no money);
 *   - the "sales profit appears after settling" assert FAILS (settlement
 *     never opened the saleFullyPaid gate — the margin was stranded).
 *   Katsh stays immediate on BOTH (owner-exception regression guard).
 *
 * Rule 15: fresh partner per test; all asserts are deltas on summary fields,
 * getBalance, and named drawers.
 */

import { test, expect, seedProduct } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

const FROM = "2000-01-01";
const TO = "2099-12-31";

type Summary = {
  sales: { profit_usd: number };
  financial_services: { commission_usd: number };
  mobile_services: { profit_usd: number };
  recharges: { profit_usd: number };
  deferred: {
    partner_profit_usd: number;
    partner_profit_lbp: number;
    client_debt_profit_usd: number;
    client_debt_profit_lbp: number;
  };
};

type Api = {
  api: {
    profits: { summary: (f: string, t: string) => Promise<Summary> };
    partners: {
      create: (d: {
        name: string;
        phone?: string;
      }) => Promise<{
        success: boolean;
        data?: { id: number };
        error?: string;
      }>;
      getBalance: (id: number) => Promise<{ usd: number; lbp: number }>;
      settle: (d: {
        partnerId: number;
        amount: number;
        currency: string;
        settlementMethod: string;
        notes?: string;
      }) => Promise<{ success: boolean; error?: string }>;
    };
    sales: {
      process: (d: unknown) => Promise<{ success: boolean; error?: string }>;
    };
    recharge: {
      process: (d: unknown) => Promise<{ success: boolean; error?: string }>;
      getDrawerBalances: () => Promise<
        Array<{ name: string; usdBalance: number }>
      >;
    };
    omt: {
      addTransaction: (
        d: unknown,
      ) => Promise<{ success: boolean; error?: string }>;
    };
  };
};

async function summaryOf(page: Page): Promise<Summary> {
  return page.evaluate(
    async ({ FROM, TO }) => {
      const w = window as unknown as Api;
      return w.api.profits.summary(FROM, TO);
    },
    { FROM, TO },
  );
}

async function generalUsd(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const w = window as unknown as Api;
    const rows = await w.api.recharge.getDrawerBalances();
    return rows.find((d) => d.name === "General")?.usdBalance ?? 0;
  });
}

async function createPartner(page: Page, label: string): Promise<number> {
  return page.evaluate(async (l) => {
    const w = window as unknown as Api;
    const c = await w.api.partners.create({
      name: `${l} ${Date.now()}`,
      phone: `${Date.now()}`.slice(-8),
    });
    if (!c.success || !c.data) throw new Error(c.error ?? "create failed");
    return c.data.id;
  }, label);
}

test.describe("LIRA-120 — partner settlement realizes profit and moves money", () => {
  test("pending until settled (sale/recharge/FS), Katsh immediate; settle → profit + General cash", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const partnerId = await createPartner(appPage, "L120");
    const productId = await seedProduct(appPage, {
      name: `L120 ${ts}`,
      cost_price: 60,
      sell_price: 100,
      quantity: 5,
    });

    const s0 = await summaryOf(appPage);

    // Four for-partner transactions, one per profit stream:
    //   POS margin 40 | recharge markup 37.89 | OMT_APP commission 2 |
    //   Katsh margin 5.89 (owner exception: immediate).
    const created = await appPage.evaluate(
      async ({ partnerId, productId, ts }) => {
        const w = window as unknown as Api;
        const sale = await w.api.sales.process({
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
        const recharge = await w.api.recharge.process({
          provider: "MTC",
          type: "VOUCHER",
          amount: 137.89,
          cost: 100,
          price: 137.89,
          currency: "USD",
          partnerId,
          partnerMode: "FOR",
          note: `L120 recharge ${ts}`,
        });
        const fs = await w.api.omt.addTransaction({
          provider: "OMT_APP",
          serviceType: "SEND",
          amount: 20.41,
          currency: "USD",
          commission: 2,
          partnerId,
          partnerMode: "FOR",
          payments: [
            {
              method: "CASH",
              currencyCode: "USD",
              amount: 22.41,
              direction: "OUT",
            },
          ],
        });
        const katsh = await w.api.omt.addTransaction({
          provider: "Katsh",
          serviceType: "SEND",
          amount: 50.89,
          currency: "USD",
          cost: 45,
          price: 50.89,
          partnerId,
          partnerMode: "FOR",
        });
        return {
          errors: [sale, recharge, fs, katsh]
            .map((r) => r.error ?? null)
            .filter(Boolean),
          bal: (await w.api.partners.getBalance(partnerId)).usd,
        };
      },
      { partnerId, productId, ts },
    );
    expect(created.errors).toEqual([]);
    // 100 + 137.89 + 22.41 + 50.89 — the partner owes it all.
    expect(created.bal).toBeCloseTo(311.19, 2);

    // ── BEFORE settlement: everything deferred except Katsh ──────────────
    const s1 = await summaryOf(appPage);
    // Failing-first (pre-PFT-6 counted these immediately):
    expect(s1.recharges.profit_usd - s0.recharges.profit_usd).toBeCloseTo(0, 2);
    expect(
      s1.financial_services.commission_usd -
        s0.financial_services.commission_usd,
    ).toBeCloseTo(0, 2);
    // Sale margin pending (paid_usd = 0 — same pre/post, sanity).
    expect(s1.sales.profit_usd - s0.sales.profit_usd).toBeCloseTo(0, 2);
    // Owner exception: Katsh margin is IMMEDIATE (regression guard).
    expect(
      s1.mobile_services.profit_usd - s0.mobile_services.profit_usd,
    ).toBeCloseTo(5.89, 2);
    // Deferred-profit visibility: sale 40 + recharge 37.89 + OMT_APP 2 sit in
    // the deferred bucket while pending; Katsh (5.89) is EXCLUDED — immediate.
    expect(
      s1.deferred.partner_profit_usd - s0.deferred.partner_profit_usd,
    ).toBeCloseTo(79.89, 2);

    // ── Settle the full USD balance in CASH ──────────────────────────────
    const generalBeforeSettle = await generalUsd(appPage);
    const settled = await appPage.evaluate(async (partnerId) => {
      const w = window as unknown as Api;
      const r = await w.api.partners.settle({
        partnerId,
        amount: 311.19,
        currency: "USD",
        settlementMethod: "CASH",
        notes: "L120 full settle",
      });
      return {
        ok: r.success,
        error: r.error ?? null,
        bal: (await w.api.partners.getBalance(partnerId)).usd,
      };
    }, partnerId);
    expect(settled.error).toBeNull();
    expect(settled.ok).toBe(true);
    expect(settled.bal).toBeCloseTo(0, 2);

    // PFT-6b failing-first: the partner's cash lands in General.
    const generalAfterSettle = await generalUsd(appPage);
    expect(generalAfterSettle - generalBeforeSettle).toBeCloseTo(311.19, 2);

    // ── AFTER settlement: the deferred profit realizes (dated at source) ──
    const s2 = await summaryOf(appPage);
    expect(s2.sales.profit_usd - s0.sales.profit_usd).toBeCloseTo(40, 2);
    expect(s2.recharges.profit_usd - s0.recharges.profit_usd).toBeCloseTo(
      37.89,
      2,
    );
    expect(
      s2.financial_services.commission_usd -
        s0.financial_services.commission_usd,
    ).toBeCloseTo(2, 2);
    expect(
      s2.mobile_services.profit_usd - s0.mobile_services.profit_usd,
    ).toBeCloseTo(5.89, 2);
    // Deferred-profit visibility: fully settled → the bucket returns to baseline.
    expect(
      s2.deferred.partner_profit_usd - s0.deferred.partner_profit_usd,
    ).toBeCloseTo(0, 2);
  });

  test("partial settlement keeps the source pending; completing it realizes (FIFO)", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const partnerId = await createPartner(appPage, "L120P");

    const created = await appPage.evaluate(
      async ({ partnerId, ts }) => {
        const w = window as unknown as Api;
        const r = await w.api.recharge.process({
          provider: "MTC",
          type: "VOUCHER",
          amount: 80.13,
          cost: 50,
          price: 80.13,
          currency: "USD",
          partnerId,
          partnerMode: "FOR",
          note: `L120P ${ts}`,
        });
        return { error: r.error ?? null };
      },
      { partnerId, ts },
    );
    expect(created.error).toBeNull();

    const s0 = await summaryOf(appPage);

    // Half-settle: the FOR_RECHARGE row stays partially covered → pending.
    const half = await appPage.evaluate(async (partnerId) => {
      const w = window as unknown as Api;
      const r = await w.api.partners.settle({
        partnerId,
        amount: 40,
        currency: "USD",
        settlementMethod: "CASH",
      });
      return { ok: r.success, error: r.error ?? null };
    }, partnerId);
    expect(half.error).toBeNull();
    expect(half.ok).toBe(true);

    const s1 = await summaryOf(appPage);
    expect(s1.recharges.profit_usd - s0.recharges.profit_usd).toBeCloseTo(0, 2);

    // Complete the settlement → fully covered → markup realizes.
    const rest = await appPage.evaluate(async (partnerId) => {
      const w = window as unknown as Api;
      const r = await w.api.partners.settle({
        partnerId,
        amount: 40.13,
        currency: "USD",
        settlementMethod: "CASH",
      });
      return {
        ok: r.success,
        error: r.error ?? null,
        bal: (await w.api.partners.getBalance(partnerId)).usd,
      };
    }, partnerId);
    expect(rest.error).toBeNull();
    expect(rest.ok).toBe(true);
    expect(rest.bal).toBeCloseTo(0, 2);

    const s2 = await summaryOf(appPage);
    expect(s2.recharges.profit_usd - s0.recharges.profit_usd).toBeCloseTo(
      30.13,
      2,
    );
  });
});
