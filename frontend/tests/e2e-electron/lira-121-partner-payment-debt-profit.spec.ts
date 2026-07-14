/**
 * E2E: LIRA-121 — the three owner decisions of 2026-07-14:
 *
 *  1. PFT-7b "cash moved": the Partners Add-credit/debt entry can record a
 *     PHYSICAL cash event — the drawer moves with it (add debt = cash OUT to
 *     the partner, add credit = cash IN), booked as a PARTNER_PAYMENT
 *     transaction; a paper entry (unticked) never touches the drawer.
 *  2. DBT-1 "client-account service profit waits": a recharge charged to a
 *     CLIENT's account counts its markup only after the client repays
 *     (repayment FIFO coverage on debt_ledger, v129), consistent with
 *     products and partners.
 *  3. DBT-2 "side views match": the by-user profit view excludes pending
 *     partner profit and shows it once the partner settles.
 *
 * Rule 17 (failing-first) — with ProfitRepository/DebtRepository/
 * PartnerRepository/PartnerService reverted to the pre-DBT state:
 *  - (1) the cash-moved entries leave General unchanged (deltas 0 vs ±);
 *  - (2) the account recharge's markup counts IMMEDIATELY (delta = markup
 *    while unpaid, and the after-repayment delta assert sees no change);
 *  - (3) the by-user view counts the partner markup immediately.
 *
 * Rule 15: fresh partner/client per test; delta + identity asserts only.
 */

import { test, expect, seedClient } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

const FROM = "2000-01-01";
const TO = "2099-12-31";

type Api = {
  api: {
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
      recordTransaction: (d: unknown) => Promise<{
        success: boolean;
        error?: string;
      }>;
      settle: (d: unknown) => Promise<{ success: boolean; error?: string }>;
    };
    recharge: {
      process: (d: unknown) => Promise<{ success: boolean; error?: string }>;
      getDrawerBalances: () => Promise<
        Array<{ name: string; usdBalance: number }>
      >;
    };
    debt: {
      addRepayment: (d: {
        clientId: number;
        amountUSD: number;
        amountLBP: number;
      }) => Promise<{ success: boolean; error?: string }>;
    };
    profits: {
      summary: (
        f: string,
        t: string,
      ) => Promise<{
        recharges: { profit_usd: number };
        deferred: {
          partner_profit_usd: number;
          partner_profit_lbp: number;
          client_debt_profit_usd: number;
          client_debt_profit_lbp: number;
        };
      }>;
      byUser: (
        f: string,
        t: string,
      ) => Promise<Array<{ user_id: number; profit_usd: number }>>;
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

async function rechargeProfitUsd(page: Page): Promise<number> {
  return page.evaluate(
    async ({ FROM, TO }) => {
      const w = window as unknown as Api;
      return (await w.api.profits.summary(FROM, TO)).recharges.profit_usd;
    },
    { FROM, TO },
  );
}

async function clientDebtDeferredUsd(page: Page): Promise<number> {
  return page.evaluate(
    async ({ FROM, TO }) => {
      const w = window as unknown as Api;
      return (await w.api.profits.summary(FROM, TO)).deferred
        .client_debt_profit_usd;
    },
    { FROM, TO },
  );
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

test.describe("LIRA-121 — partner cash-moved entries, client-debt profit deferral, gated side views", () => {
  test("PFT-7b: cash-moved add-debt/add-credit move General; a paper entry does not", async ({
    appPage,
  }) => {
    const partnerId = await createPartner(appPage, "L121C");
    const balBefore = await appPage.evaluate(
      async (id) =>
        (await (window as unknown as Api).api.partners.getBalance(id)).usd,
      partnerId,
    );
    const generalBefore = await generalUsd(appPage);

    // Cash-moved DEBIT $50: advance handed to the partner → General −50.
    const r1 = await appPage.evaluate(async (partnerId) => {
      const w = window as unknown as Api;
      return w.api.partners.recordTransaction({
        partnerId,
        transactionType: "ADJUSTMENT",
        amount: 50,
        currency: "USD",
        direction: "DEBIT",
        moveCash: true,
        notes: "L121 cash advance",
      });
    }, partnerId);
    expect(r1.error ?? null).toBeNull();
    expect(r1.success).toBe(true);
    // Failing-first: pre-PFT-7b moveCash is ignored → General delta 0.
    expect((await generalUsd(appPage)) - generalBefore).toBeCloseTo(-50, 2);

    // Cash-moved CREDIT $30: partner hands cash in → General −50+30 = −20.
    const r2 = await appPage.evaluate(async (partnerId) => {
      const w = window as unknown as Api;
      return w.api.partners.recordTransaction({
        partnerId,
        transactionType: "ADJUSTMENT",
        amount: 30,
        currency: "USD",
        direction: "CREDIT",
        moveCash: true,
      });
    }, partnerId);
    expect(r2.success).toBe(true);
    expect((await generalUsd(appPage)) - generalBefore).toBeCloseTo(-20, 2);

    // Paper DEBIT $20 (no moveCash): tab moves, the drawer does NOT.
    const r3 = await appPage.evaluate(async (partnerId) => {
      const w = window as unknown as Api;
      return w.api.partners.recordTransaction({
        partnerId,
        transactionType: "ADJUSTMENT",
        amount: 20,
        currency: "USD",
        direction: "DEBIT",
      });
    }, partnerId);
    expect(r3.success).toBe(true);
    expect((await generalUsd(appPage)) - generalBefore).toBeCloseTo(-20, 2);

    // The tab tracked all three: +50 − 30 + 20 = +40.
    const balAfter = await appPage.evaluate(
      async (id) =>
        (await (window as unknown as Api).api.partners.getBalance(id)).usd,
      partnerId,
    );
    expect(balAfter - balBefore).toBeCloseTo(40, 2);
  });

  test("DBT-1: a recharge on a client's account defers its markup until the client repays", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const clientId = await seedClient(appPage, {
      name: `L121 Client ${ts}`,
      phone: `71${`${ts}`.slice(-6)}`,
    });

    const p0 = await rechargeProfitUsd(appPage);
    const d0 = await clientDebtDeferredUsd(appPage);

    // MTC voucher, cost 60 / price 90.17 (markup 30.17), fully on account.
    const created = await appPage.evaluate(
      async ({ clientId, ts }) => {
        const w = window as unknown as Api;
        return w.api.recharge.process({
          provider: "MTC",
          type: "VOUCHER",
          amount: 90.17,
          cost: 60,
          price: 90.17,
          currency: "USD",
          clientId,
          payments: [
            {
              method: "CUSTOMER_ACCOUNT",
              currencyCode: "USD",
              amount: 90.17,
              direction: "IN",
            },
          ],
          note: `L121 account recharge ${ts}`,
        });
      },
      { clientId, ts },
    );
    expect(created.error ?? null).toBeNull();
    expect(created.success).toBe(true);

    // Failing-first (DBT-1): pre-fix the markup counted immediately (+30.17).
    expect((await rechargeProfitUsd(appPage)) - p0).toBeCloseTo(0, 2);
    // Deferred-profit visibility: the markup sits in the client-debt bucket
    // while the account charge is uncovered.
    expect((await clientDebtDeferredUsd(appPage)) - d0).toBeCloseTo(30.17, 2);

    // Client repays in full → repayment FIFO covers the charge → realized.
    const repaid = await appPage.evaluate(async (clientId) => {
      const w = window as unknown as Api;
      return w.api.debt.addRepayment({
        clientId,
        amountUSD: 90.17,
        amountLBP: 0,
      });
    }, clientId);
    expect(repaid.error ?? null).toBeNull();
    expect(repaid.success).toBe(true);

    expect((await rechargeProfitUsd(appPage)) - p0).toBeCloseTo(30.17, 2);
    // Deferred-profit visibility: fully repaid → the bucket returns to baseline.
    expect((await clientDebtDeferredUsd(appPage)) - d0).toBeCloseTo(0, 2);
  });

  test("DBT-2: the by-user view excludes pending partner profit and realizes it on settlement", async ({
    appPage,
  }) => {
    const partnerId = await createPartner(appPage, "L121U");

    const userProfit = async () =>
      appPage.evaluate(
        async ({ FROM, TO }) => {
          const w = window as unknown as Api;
          const rows = await w.api.profits.byUser(FROM, TO);
          return rows.reduce((s, r) => s + r.profit_usd, 0);
        },
        { FROM, TO },
      );

    const u0 = await userProfit();

    // For-partner MTC voucher, cost 40 / price 65.19 (markup 25.19).
    const created = await appPage.evaluate(async (partnerId) => {
      const w = window as unknown as Api;
      return w.api.recharge.process({
        provider: "MTC",
        type: "VOUCHER",
        amount: 65.19,
        cost: 40,
        price: 65.19,
        currency: "USD",
        partnerId,
        partnerMode: "FOR",
      });
    }, partnerId);
    expect(created.error ?? null).toBeNull();
    expect(created.success).toBe(true);

    // Failing-first (DBT-2): pre-fix the by-user ELSE arm counted +25.19 now.
    expect((await userProfit()) - u0).toBeCloseTo(0, 2);

    // Settle the partner in full → the by-user view realizes the markup.
    const settled = await appPage.evaluate(async (partnerId) => {
      const w = window as unknown as Api;
      return w.api.partners.settle({
        partnerId,
        amount: 65.19,
        currency: "USD",
        settlementMethod: "CASH",
      });
    }, partnerId);
    expect(settled.error ?? null).toBeNull();
    expect(settled.success).toBe(true);

    expect((await userProfit()) - u0).toBeCloseTo(25.19, 2);
  });
});
