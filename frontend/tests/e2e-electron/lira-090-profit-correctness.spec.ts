/**
 * E2E: LIRA-090 — profit-correctness audit (6 module fixes + refund netting)
 *
 * Validates the profit-audit changes end-to-end through real main-process IPC,
 * reading the admin `profits.summary` object (getSummary) before/after each
 * action and asserting the affected tab's DELTA. Shared accumulating DB → every
 * assertion is a delta on a specific field, never an absolute total (rule 15).
 *
 * Covered:
 *   Fix 1  refund reverses profit                → recharge in, then refund out, net 0
 *   Fix 2  POS discount reduces profit           → discounted sale stamps margin − discount
 *   Fix 3  recharge LBP SMS cost is converted    → LBP transfer profit deducts a real (large) sum
 *   Fix 4  LBP maintenance profit is counted     → maintenance.profit_lbp delta
 *   Fix 5  loto commission reaches profits       → loto.profit_lbp delta
 *   review per-item refund of a discounted sale  → nets to zero (no phantom discount loss)
 *
 * pmFee (Fix 6) is unit-covered (it needs a wallet-leg FS flow that is fiddly to
 * drive reliably headless); the summary field is asserted present here.
 */

import { test, expect, seedProduct } from "./fixtures";

test.describe.configure({ retries: 0 });

const FROM = "2000-01-01";
const TO = "2099-12-31";

type Summary = {
  sales: { profit_usd: number };
  recharges: { profit_usd: number; profit_lbp: number };
  maintenance: { profit_lbp: number };
  loto: { profit_lbp: number; count: number };
  financial_services: { pm_fee_usd: number };
};

type Api = {
  api: {
    profits: { summary: (from: string, to: string) => Promise<Summary> };
    recharge: {
      process: (
        d: Record<string, unknown>,
      ) => Promise<{ success: boolean; error?: string }>;
    };
    maintenance: {
      save: (
        d: Record<string, unknown>,
      ) => Promise<{ success: boolean; error?: string }>;
    };
    loto: {
      sell: (
        d: Record<string, unknown>,
      ) => Promise<{ success: boolean; error?: string }>;
    };
    sales: {
      process: (
        d: unknown,
      ) => Promise<{ success: boolean; id?: number; error?: string }>;
      // getSaleItems returns the raw array (no success envelope).
      getItems: (saleId: number) => Promise<Array<{ id: number }>>;
      refundItem: (
        saleId: number,
        saleItemId: number,
        qty: number,
      ) => Promise<{ success: boolean; error?: string }>;
      refund: (saleId: number) => Promise<{ success: boolean; error?: string }>;
    };
    transactions: {
      getRecent: (
        limit: number,
      ) => Promise<Array<{ id: number; type: string; summary: string | null }>>;
      refund: (id: number) => Promise<{ success: boolean; error?: string }>;
    };
  };
};

async function summary(
  appPage: import("@playwright/test").Page,
): Promise<Summary> {
  return appPage.evaluate(
    ({ FROM, TO }) => (window as unknown as Api).api.profits.summary(FROM, TO),
    { FROM, TO },
  );
}

test.describe("LIRA-090 — profit correctness", () => {
  test("Fix 1: a refund reverses the module's profit (net 0)", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(
      async ({ FROM, TO }) => {
        const w = window as unknown as Api;
        const s = () => w.api.profits.summary(FROM, TO);

        // Distinctive price → the RECHARGE summary carries "$12.37", used as the
        // row identity (the summary does NOT include the phone). Profit = 2.37.
        const price = 12.37;
        const before = (await s()).recharges.profit_usd;
        const res = await w.api.recharge.process({
          provider: "MTC",
          type: "DAYS",
          amount: 10,
          cost: 10,
          price,
          currency: "USD",
          phoneNumber: `P90-REF-${Date.now()}`,
          paid_by_method: "CASH",
        });
        const afterSale = (await s()).recharges.profit_usd;

        // Newest RECHARGE row carrying the distinctive price is mine (getRecent
        // is DESC), then refund it via the generic transactions:refund.
        const row = (await w.api.transactions.getRecent(100)).find(
          (t) => t.type === "RECHARGE" && (t.summary ?? "").includes("12.37"),
        );
        const refund = row
          ? await w.api.transactions.refund(row.id)
          : { success: false, error: "recharge txn not found" };
        const afterRefund = (await s()).recharges.profit_usd;

        return {
          ok: res.success && refund.success,
          error: res.error ?? refund.error ?? null,
          bookedDelta: afterSale - before,
          netDelta: afterRefund - before,
        };
      },
      { FROM, TO },
    );

    expect(result.error).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.bookedDelta).toBeCloseTo(2.37, 2); // profit stamped on sale
    expect(result.netDelta).toBeCloseTo(0, 2); // refund removes it (notRefunded gate)
  });

  test("Fix 2: a discounted POS sale stamps profit = margin − discount", async ({
    appPage,
  }) => {
    // cost 60, sell 100 → gross margin 40; $10 discount → profit 30.
    const productId = await seedProduct(appPage, {
      name: `P90 discount ${Date.now()}`,
      cost_price: 60,
      sell_price: 100,
      quantity: 10,
    });

    const result = await appPage.evaluate(
      async ({ FROM, TO, productId }) => {
        const w = window as unknown as Api;
        const s = () => w.api.profits.summary(FROM, TO);

        const before = (await s()).sales.profit_usd;
        const res = await w.api.sales.process({
          client_id: null,
          items: [{ product_id: productId, quantity: 1, price: 100 }],
          total_amount: 100,
          discount: 10,
          final_amount: 90,
          payment_usd: 90,
          payment_lbp: 0,
          exchange_rate: 90000,
        });
        const after = (await s()).sales.profit_usd;
        return {
          ok: res.success,
          error: res.error ?? null,
          delta: after - before,
        };
      },
      { FROM, TO, productId },
    );

    expect(result.error).toBeNull();
    expect(result.ok).toBe(true);
    // Pre-fix this was 40 (the discount was ignored). Now 30.
    expect(result.delta).toBeCloseTo(30, 2);
  });

  test("review: refunding a discounted sale nets its profit to zero", async ({
    appPage,
  }) => {
    // 2 units cost 60 sell 100 → gross 80; $20 discount → SALE profit 60.
    const productId = await seedProduct(appPage, {
      name: `P90 refund-discount ${Date.now()}`,
      cost_price: 60,
      sell_price: 100,
      quantity: 10,
    });

    const result = await appPage.evaluate(
      async ({ FROM, TO, productId }) => {
        const w = window as unknown as Api;
        const s = () => w.api.profits.summary(FROM, TO);

        const before = (await s()).sales.profit_usd;
        const sale = await w.api.sales.process({
          client_id: null,
          items: [{ product_id: productId, quantity: 2, price: 100 }],
          total_amount: 200,
          discount: 20,
          final_amount: 180,
          payment_usd: 180,
          payment_lbp: 0,
          exchange_rate: 90000,
        });
        const afterSale = (await s()).sales.profit_usd;

        // Fully refund the sale item by item.
        const items = sale.id ? await w.api.sales.getItems(sale.id) : [];
        let refundOk = items.length > 0;
        for (const it of items) {
          const r = await w.api.sales.refundItem(sale.id!, it.id, 2);
          refundOk = refundOk && r.success;
        }
        const afterRefund = (await s()).sales.profit_usd;

        return {
          ok: sale.success && refundOk,
          error: sale.error ?? null,
          bookedDelta: afterSale - before,
          netDelta: afterRefund - before,
        };
      },
      { FROM, TO, productId },
    );

    expect(result.error).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.bookedDelta).toBeCloseTo(60, 2); // 80 gross − 20 discount
    // Pre-fix the per-item refund gave back gross margin (80), leaving −20.
    expect(result.netDelta).toBeCloseTo(0, 2);
  });

  test("Fix 3: an LBP credit transfer deducts a converted (large) SMS cost", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(
      async ({ FROM, TO }) => {
        const w = window as unknown as Api;
        const s = () => w.api.profits.summary(FROM, TO);

        const before = (await s()).recharges.profit_lbp;
        // 6 USD-equiv credits, priced 600,000 LBP, cost 540,000 LBP → gross 60,000.
        // 2 SMS × $0.16 = $0.32, CONVERTED to LBP (tens of thousands), not $0.32.
        const res = await w.api.recharge.process({
          provider: "MTC",
          type: "CREDIT_TRANSFER",
          amount: 6,
          cost: 540000,
          price: 600000,
          currency: "LBP",
          phoneNumber: `P90-LBP-${Date.now()}`,
          paid_by_method: "CASH",
        });
        const after = (await s()).recharges.profit_lbp;
        return {
          ok: res.success,
          error: res.error ?? null,
          delta: after - before,
        };
      },
      { FROM, TO },
    );

    expect(result.error).toBeNull();
    expect(result.ok).toBe(true);
    // Gross commission is 60,000 LBP. Post-fix the SMS cost is converted to LBP,
    // so a large chunk (tens of thousands) is deducted. Pre-fix only $0.32 was
    // subtracted, leaving ~59,999.68. Assert the deduction is real & bounded.
    const deducted = 60000 - result.delta;
    expect(deducted).toBeGreaterThan(5000); // pre-fix ≈ 0.32 → fails
    expect(deducted).toBeLessThan(60000); // profit stays positive
    expect(result.delta).toBeGreaterThan(0);
  });

  test("Fix 4: an LBP maintenance job counts LBP profit", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(
      async ({ FROM, TO }) => {
        const w = window as unknown as Api;
        const s = () => w.api.profits.summary(FROM, TO);

        const before = (await s()).maintenance.profit_lbp;
        // LBP job: cost 500,000, price 900,000 → profit 400,000 LBP.
        const res = await w.api.maintenance.save({
          device_name: "P90 LBP phone",
          issue_description: "battery",
          client_name: `P90 MAINT ${Date.now()}`,
          client_phone: "70111222",
          // The maintenance Zod schema requires cost_usd/price_usd; for an LBP
          // job they are 0 (profit = final_amount_lbp − cost_lbp = 400,000).
          cost_usd: 0,
          price_usd: 0,
          cost_lbp: 500000,
          price_lbp: 900000,
          final_amount_lbp: 900000,
          currency: "LBP",
          exchange_rate: 90000,
          status: "Delivered_Paid",
          payments: [{ method: "CASH", currency_code: "LBP", amount: 900000 }],
        });
        const after = (await s()).maintenance.profit_lbp;
        return {
          ok: res.success,
          error: res.error ?? null,
          delta: after - before,
        };
      },
      { FROM, TO },
    );

    expect(result.error).toBeNull();
    expect(result.ok).toBe(true);
    // Pre-fix maintenance only summed profit_usd → LBP jobs were invisible.
    expect(result.delta).toBeCloseTo(400000, 0);
  });

  test("Fix 5: a loto ticket's commission reaches the profits page", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(
      async ({ FROM, TO }) => {
        const w = window as unknown as Api;
        const s = () => w.api.profits.summary(FROM, TO);

        const before = await s();
        // 500,000 LBP ticket, commission rate pinned to 4.45% → 22,250 LBP.
        const res = await w.api.loto.sell({
          ticket_number: `P90-LOTO-${Date.now()}`,
          sale_amount: 500000,
          commission_rate: 0.0445,
          payment_method: "CASH",
          payments: [{ method: "CASH", currencyCode: "LBP", amount: 500000 }],
        });
        const after = await s();
        return {
          ok: res.success,
          error: res.error ?? null,
          profitDelta: after.loto.profit_lbp - before.loto.profit_lbp,
          countDelta: after.loto.count - before.loto.count,
        };
      },
      { FROM, TO },
    );

    expect(result.error).toBeNull();
    expect(result.ok).toBe(true);
    // Pre-fix loto was entirely absent from the profits page.
    expect(result.countDelta).toBe(1);
    expect(result.profitDelta).toBeCloseTo(500000 * 0.0445, 0);
  });

  test("Fix 6: the summary exposes a payment-method-fee profit field", async ({
    appPage,
  }) => {
    const s = await summary(appPage);
    // The field exists and is a finite number (unit tests cover the value; a
    // wallet-fee flow is out of scope for a headless IPC delta here).
    expect(typeof s.financial_services.pm_fee_usd).toBe("number");
    expect(Number.isFinite(s.financial_services.pm_fee_usd)).toBe(true);
  });
});
