/**
 * E2E: LIRA-118 — for-partner LIFECYCLE. Mirrors the owner's mental model:
 * "create a partner, do transactions, check the partner page balance after
 * each." This composes the already-built + already-guarded FOR-partner flows
 * (lira-113 POS, lira-115 recharge, lira-116 loto) plus the manual ledger
 * entry (recordTransaction) and settlement (settle) primitives, and walks
 * the SAME partner's balance through every one of them in sequence, then
 * proves settlement zeroes it out per currency.
 *
 * Source of truth: docs/plans/PARTNER_FOR_TRANSACTIONS_PLAN.md, "⭐ VALIDATED
 * FLOW CATALOG" — a FOR-partner transaction has NO walk-in customer and
 * takes NO counter cash; the partner owes (or is owed) the FULL amount,
 * tracked on the Partners page (window.api.partners.getBalance) and settled
 * there. getBalance = SUM(DEBIT) − SUM(CREDIT) per currency; positive means
 * the partner owes the shop (packages/core/src/repositories/PartnerRepository.ts
 * getBalance()).
 *
 * BUILT + covered elsewhere (composed here, not re-guarded — rule 17 does
 * not apply to this spec: it introduces no fix and has no "pre-fix code" to
 * fail against):
 *   - POS sale for partner books the FULL sale price (lira-113/114).
 *   - Recharge (MTC/Alfa) for partner books the FULL price (lira-115).
 *   - Loto ticket for partner books the FULL sale_amount, LBP only, and has
 *     NO void path (LOTO is in NON_REVERSIBLE_TRANSACTION_TYPES) (lira-116).
 *   - Manual ledger entries (partners:record-transaction) and settlement
 *     (partners:settle) are exercised directly against the ledger here for
 *     the first time in an e2e spec.
 *
 * NOT built yet — NOT tested here (see cases_pending in the task handoff):
 *   - Financial-service SEND/RECEIVE for a partner (OMT System, OMT App,
 *     Whish App, Binance, iPick, Katsh, bills).
 *   - Settlement → profit recognition (PFT-6).
 *
 * Money invariants under guard (rule 15 — identity + delta only, never row
 * position or a global total): every assertion below reads
 * window.api.partners.getBalance(partnerId) for THIS spec's own
 * freshly-created partner (identity = the returned partnerId). Absolute
 * values are safe here because the partner is brand new with an empty
 * ledger — there is no shared-DB leakage to guard against, unlike a global
 * "most recent row" query.
 *
 * Running-balance walkthrough (TEST 1, all amounts on the SAME partner):
 *   0. create                              → { usd: 0,   lbp: 0      }
 *   1. POS sale $100 (no legs)             → { usd: 100, lbp: 0      }
 *   2. Recharge $50 (no legs)              → { usd: 150, lbp: 0      }
 *   3. Loto 500,000 LBP (no legs)          → { usd: 150, lbp: 500000 }
 *   4. Manual ADJUSTMENT DEBIT  $30        → { usd: 180, lbp: 500000 }
 *   5. Manual ADJUSTMENT CREDIT $20        → { usd: 160, lbp: 500000 }
 *   6. Settle USD 160 (CASH)               → { usd: 0,   lbp: 500000 }
 *   7. Settle LBP 500,000 (CASH)           → { usd: 0,   lbp: 0      }
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
      getBalance: (
        partnerId: number,
      ) => Promise<{ usd: number; lbp: number; usdt: number }>;
      recordTransaction: (d: {
        partnerId: number;
        transactionType?: "ADJUSTMENT" | "SETTLEMENT";
        amount: number;
        currency: string;
        direction: "DEBIT" | "CREDIT";
        notes?: string;
      }) => Promise<{
        success: boolean;
        data?: { id: number; direction: string; amount: number };
        error?: string;
      }>;
      settle: (d: {
        partnerId: number;
        amount: number;
        currency: string;
        settlementMethod: string;
        notes?: string;
      }) => Promise<{
        success: boolean;
        data?: { id: number; direction: string; amount: number };
        error?: string;
      }>;
    };
    sales: {
      process: (
        d: unknown,
      ) => Promise<{ success: boolean; id?: number; error?: string }>;
    };
    recharge: {
      process: (
        d: unknown,
      ) => Promise<{ success: boolean; id?: number; error?: string }>;
    };
    loto: {
      sell: (
        d: unknown,
      ) => Promise<{ success: boolean; ticket?: { id: number }; error?: string }>;
    };
    transactions: {
      getRecent: (
        limit: number,
      ) => Promise<Array<{ id: number; type: string; summary: string | null }>>;
      void: (id: number) => Promise<{ success: boolean; error?: string }>;
    };
  };
};

async function createPartner(appPage: Page, label: string): Promise<number> {
  const ts = Date.now();
  return appPage.evaluate(
    async ({ label, ts }) => {
      const w = window as unknown as Api;
      const created = await w.api.partners.create({
        name: `${label} ${ts}`,
        phone: `${label}${ts}`,
      });
      if (!created.success || !created.data) {
        throw new Error(created.error ?? "partner create failed");
      }
      return created.data.id;
    },
    { label, ts },
  );
}

async function getBalance(
  appPage: Page,
  partnerId: number,
): Promise<{ usd: number; lbp: number }> {
  return appPage.evaluate(async (id) => {
    const w = window as unknown as Api;
    const b = await w.api.partners.getBalance(id);
    return { usd: b.usd, lbp: b.lbp };
  }, partnerId);
}

/**
 * Assert BOTH currency fields against expected values with float-safe
 * tolerance (mirrors lira-113/115's toBeCloseTo(x, 2) for USD and
 * lira-116's toBeCloseTo(x, 0) for LBP) while still catching cross-currency
 * leakage (the field that should NOT have moved is asserted too).
 */
function expectBalance(
  actual: { usd: number; lbp: number },
  expected: { usd: number; lbp: number },
): void {
  expect(actual.usd).toBeCloseTo(expected.usd, 2);
  expect(actual.lbp).toBeCloseTo(expected.lbp, 0);
}

test.describe("LIRA-118 — for-partner lifecycle: balance accrues across every built transaction type, then settles", () => {
  test("partner balance accrues across every built transaction type, then settles to zero", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const PARTNER_NAME = `L118 Lifecycle ${ts}`;
    const PRODUCT_NAME = `L118 Product ${ts}`;

    // Step 1 — create ONE partner; balance starts at exactly zero.
    const partnerId = await createPartner(appPage, PARTNER_NAME);
    const step1 = await getBalance(appPage, partnerId);
    expectBalance(step1, { usd: 0, lbp: 0 });

    // Step 2 — POS sale for the partner: $100 product, no payment legs at
    // all (no walk-in customer in FOR-partner mode). Full price books to
    // the partner (lira-113 pattern).
    const productId = await seedProduct(appPage, {
      name: PRODUCT_NAME,
      cost_price: 60,
      sell_price: 100,
      quantity: 5,
    });

    const saleResult = await appPage.evaluate(
      async ({ productId, partnerId }) => {
        const w = window as unknown as Api;
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
        return { ok: res.success, error: res.error ?? null };
      },
      { productId, partnerId },
    );
    expect(saleResult.error).toBeNull();
    expect(saleResult.ok).toBe(true);

    const step2 = await getBalance(appPage, partnerId);
    expectBalance(step2, { usd: 100, lbp: 0 });

    // Step 3 — mobile recharge (MTC VOUCHER) for the partner: $50, USD, no
    // payment legs. Full price books to the partner (lira-115 pattern).
    const rechargeResult = await appPage.evaluate(
      async ({ partnerId, ts }) => {
        const w = window as unknown as Api;
        const res = await w.api.recharge.process({
          provider: "MTC",
          type: "VOUCHER",
          amount: 50,
          cost: 0,
          price: 50,
          currency: "USD",
          partnerId,
          partnerMode: "FOR",
          note: `L118 recharge ${ts}`,
        });
        return { ok: res.success, error: res.error ?? null };
      },
      { partnerId, ts },
    );
    expect(rechargeResult.error).toBeNull();
    expect(rechargeResult.ok).toBe(true);

    const step3 = await getBalance(appPage, partnerId);
    expectBalance(step3, { usd: 150, lbp: 0 });

    // Step 4 — Loto ticket for the partner: 500,000 LBP sale_amount, no
    // payment legs. Full LBP amount books to the partner (lira-116
    // pattern); USD side of the balance must not move.
    const lotoResult = await appPage.evaluate(
      async ({ partnerId, ts }) => {
        const w = window as unknown as Api;
        const res = await w.api.loto.sell({
          sale_amount: 500000,
          partnerId,
          partnerMode: "FOR",
          exchange_rate: 100000,
          note: `L118 loto ${ts}`,
        });
        return { ok: res.success, error: res.error ?? null };
      },
      { partnerId, ts },
    );
    expect(lotoResult.error).toBeNull();
    expect(lotoResult.ok).toBe(true);

    const step4 = await getBalance(appPage, partnerId);
    expectBalance(step4, { usd: 150, lbp: 500000 });

    // Step 5 — manual DEBIT via recordTransaction (ADJUSTMENT, USD, $30):
    // DEBIT increases what the partner owes (getBalance = DEBIT − CREDIT).
    const debitResult = await appPage.evaluate(async (partnerId) => {
      const w = window as unknown as Api;
      const res = await w.api.partners.recordTransaction({
        partnerId,
        transactionType: "ADJUSTMENT",
        amount: 30,
        currency: "USD",
        direction: "DEBIT",
        notes: "L118 manual debit",
      });
      return { ok: res.success, error: res.error ?? null };
    }, partnerId);
    expect(debitResult.error).toBeNull();
    expect(debitResult.ok).toBe(true);

    const step5 = await getBalance(appPage, partnerId);
    expectBalance(step5, { usd: 180, lbp: 500000 });

    // Step 6 — manual CREDIT via recordTransaction (ADJUSTMENT, USD, $20):
    // CREDIT decreases what the partner owes.
    const creditResult = await appPage.evaluate(async (partnerId) => {
      const w = window as unknown as Api;
      const res = await w.api.partners.recordTransaction({
        partnerId,
        transactionType: "ADJUSTMENT",
        amount: 20,
        currency: "USD",
        direction: "CREDIT",
        notes: "L118 manual credit",
      });
      return { ok: res.success, error: res.error ?? null };
    }, partnerId);
    expect(creditResult.error).toBeNull();
    expect(creditResult.ok).toBe(true);

    const step6 = await getBalance(appPage, partnerId);
    expectBalance(step6, { usd: 160, lbp: 500000 });

    // Step 7a — settle the USD balance in full (partners.settle books the
    // settlement amount in the sign-derived direction; amount must equal
    // the current balance to net exactly to zero — PartnerService.settle).
    const settleUsdResult = await appPage.evaluate(async (partnerId) => {
      const w = window as unknown as Api;
      const res = await w.api.partners.settle({
        partnerId,
        amount: 160,
        currency: "USD",
        settlementMethod: "CASH",
        notes: "L118 settle USD",
      });
      return { ok: res.success, error: res.error ?? null };
    }, partnerId);
    expect(settleUsdResult.error).toBeNull();
    expect(settleUsdResult.ok).toBe(true);

    const step7a = await getBalance(appPage, partnerId);
    expectBalance(step7a, { usd: 0, lbp: 500000 });

    // Step 7b — settle the LBP balance in full.
    const settleLbpResult = await appPage.evaluate(async (partnerId) => {
      const w = window as unknown as Api;
      const res = await w.api.partners.settle({
        partnerId,
        amount: 500000,
        currency: "LBP",
        settlementMethod: "CASH",
        notes: "L118 settle LBP",
      });
      return { ok: res.success, error: res.error ?? null };
    }, partnerId);
    expect(settleLbpResult.error).toBeNull();
    expect(settleLbpResult.ok).toBe(true);

    const step7b = await getBalance(appPage, partnerId);
    expectBalance(step7b, { usd: 0, lbp: 0 });
  });

  test("voiding a for-partner POS sale nets the partner balance back to 0", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const PARTNER_NAME = `L118 Void ${ts}`;
    const PRODUCT_NAME = `L118 VoidProduct ${ts}`;

    const partnerId = await createPartner(appPage, PARTNER_NAME);
    const before = await getBalance(appPage, partnerId);
    expectBalance(before, { usd: 0, lbp: 0 });

    const productId = await seedProduct(appPage, {
      name: PRODUCT_NAME,
      cost_price: 60,
      sell_price: 100,
      quantity: 5,
    });

    const saleResult = await appPage.evaluate(
      async ({ productId, partnerId }) => {
        const w = window as unknown as Api;
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
        return { ok: res.success, error: res.error ?? null };
      },
      { productId, partnerId },
    );
    expect(saleResult.error).toBeNull();
    expect(saleResult.ok).toBe(true);

    const afterSale = await getBalance(appPage, partnerId);
    expectBalance(afterSale, { usd: 100, lbp: 0 });

    // Find the SALE transaction by identity (type + summary containing the
    // unique product name — never by row position, rule 15) and void it.
    const voided = await appPage.evaluate(async (productName) => {
      const w = window as unknown as Api;
      const row = (await w.api.transactions.getRecent(100)).find(
        (t) => t.type === "SALE" && (t.summary ?? "").includes(productName),
      );
      const res = row
        ? await w.api.transactions.void(row.id)
        : { success: false, error: "sale txn not found" };
      return { ok: res.success, error: res.error ?? null };
    }, PRODUCT_NAME);
    expect(voided.error).toBeNull();
    expect(voided.ok).toBe(true);

    const afterVoid = await getBalance(appPage, partnerId);
    expectBalance(afterVoid, { usd: 0, lbp: 0 });
  });

  test("a counter payment on a for-partner sale is rejected (consolidated guard)", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const PARTNER_NAME = `L118 Reject ${ts}`;
    const PRODUCT_NAME = `L118 RejectProduct ${ts}`;

    const partnerId = await createPartner(appPage, PARTNER_NAME);
    const before = await getBalance(appPage, partnerId);
    expectBalance(before, { usd: 0, lbp: 0 });

    const productId = await seedProduct(appPage, {
      name: PRODUCT_NAME,
      cost_price: 60,
      sell_price: 100,
      quantity: 5,
    });

    // A for-partner sale takes NO counter payment at all — a $40 CASH IN
    // leg (POS legs use snake_case currency_code) must be rejected outright,
    // not accepted and partially booked as a "remainder."
    const rejected = await appPage.evaluate(
      async ({ productId, partnerId }) => {
        const w = window as unknown as Api;
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
        return { ok: res.success, error: res.error ?? null };
      },
      { productId, partnerId },
    );

    expect(rejected.ok).toBe(false);
    expect(rejected.error ?? "").toContain("no counter payment");

    // Nothing moved — the rejected attempt is a full no-op on the partner
    // ledger.
    const after = await getBalance(appPage, partnerId);
    expectBalance(after, { usd: 0, lbp: 0 });
  });
});
