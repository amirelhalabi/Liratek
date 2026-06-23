/**
 * E2E: Session basket payment allocation — no cross-item cash bleed (#2) and
 * gift-card realization (#3).
 *
 * A session basket is paid with ONE pooled payment, so the basket recorder must
 * decide which value realizes which item. Two regressions are guarded here:
 *
 *   #2 — Cross-item cash bleed. A basket holding a SALE charged to the customer's
 *        account + a NON-sale item paid CASH must NOT let the cash settle the
 *        sale. SessionPaymentService.backfillSaleSettlement allocates
 *        "account-debt-to-sales-first": the on-account debt is attributed to the
 *        sales total, leaving the sale PENDING (paid_usd ≈ 0). The CASH leg
 *        settled the service, not the sale.
 *
 *   #3 — Gift-card realization. A GIFT_CARD leg is debt-like for drawer purposes
 *        but is PREPAID/collected value, so it is EXCLUDED from the account debt
 *        in the allocation. A gift-card-paid SALE therefore realizes
 *        (paid_usd ≈ amount) instead of being stuck pending.
 *
 * Driven through real main-process IPC (window.api.session.checkout). The sale's
 * paid state is read back via window.api.sales.get(saleId) — the checkout result
 * exposes the sale's source id as results[].transactionId for SALE items.
 */

import { test, expect, seedClient, seedProduct } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

const RATE = 90000;

type CheckoutResultItem = {
  cartItemId: string;
  module: string;
  transactionId: number;
  success: boolean;
  error?: string;
};

type CheckoutPaymentLeg = {
  method: string;
  currency_code: string;
  amount: number;
  direction: "IN" | "OUT";
  voucher_code?: string;
};

type SaleRow = {
  id: number;
  final_amount_usd: number;
  paid_usd: number;
  paid_lbp: number;
};

type Api = {
  api: {
    session: {
      start: (data: {
        customer_name: string;
        customer_phone?: string;
        started_by: string;
      }) => Promise<{ success: boolean; sessionId?: number; error?: string }>;
      checkout: (data: {
        sessionId: number;
        cartItems: Array<{
          id: string;
          module: string;
          label: string;
          amount: number;
          currency: string;
          formData: Record<string, unknown>;
          ipcChannel: string;
        }>;
        paidByMethod: string;
        payments: CheckoutPaymentLeg[];
        exchangeRate: number;
        userId: number;
      }) => Promise<{
        success: boolean;
        results?: CheckoutResultItem[];
        error?: string;
      }>;
    };
    sales: {
      get: (saleId: number) => Promise<unknown>;
    };
    vouchers: {
      create: (data: {
        clientId: number;
        amount: number;
        currency?: "USD" | "LBP";
      }) => Promise<{
        success: boolean;
        voucher?: { code: string };
        error?: string;
      }>;
    };
  };
};

/** Narrow the opaque sales.get() result to the paid-state fields we assert on. */
function asSaleRow(raw: unknown): SaleRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "number") return null;
  return {
    id: r.id,
    final_amount_usd: Number(r.final_amount_usd ?? 0),
    paid_usd: Number(r.paid_usd ?? 0),
    paid_lbp: Number(r.paid_lbp ?? 0),
  };
}

test.describe("Session basket payment allocation — no cash bleed, gift-card realizes", () => {
  test("#2 cash for a non-sale item does not bleed into an on-account sale", async ({
    appPage,
  }) => {
    // Session needs a resolvable client: the CUSTOMER_ACCOUNT leg creates ONE
    // basket debt entry, which requires a client.
    const clientId = await seedClient(appPage, {
      name: "E2E Alloc Bleed",
      phone: "03700001",
    });
    expect(clientId).toBeGreaterThan(0);

    // A product priced so a single unit is a clean $50 sale.
    const productId = await seedProduct(appPage, {
      name: "E2E Alloc Product 50",
      cost_price: 20,
      sell_price: 50,
      quantity: 10,
    });
    expect(productId).toBeGreaterThan(0);

    const result = await appPage.evaluate(
      async ({ productId, rate }) => {
        const w = window as unknown as Api;

        const started = await w.api.session.start({
          customer_name: "E2E Alloc Bleed",
          customer_phone: "03700001",
          started_by: "admin",
        });
        const sessionId = started.sessionId;
        if (!sessionId) {
          return { error: started.error ?? "no sessionId" } as const;
        }

        // SALE item, created in deferred mode (payment_usd/lbp = 0 → the basket
        // recorder owns the customer payment). It starts PENDING.
        const saleItem = {
          id: "e2e-alloc-sale",
          module: "pos",
          label: "E2E Alloc Sale",
          amount: 50,
          currency: "USD",
          ipcChannel: "sales:process",
          formData: {
            client_id: null,
            items: [{ product_id: productId, quantity: 1, price: 50 }],
            total_amount: 50,
            discount: 0,
            final_amount: 50,
            payment_usd: 0,
            payment_lbp: 0,
            exchange_rate: rate,
            status: "completed",
          } as Record<string, unknown>,
        };

        // NON-sale item (custom service) paid by CASH.
        const serviceItem = {
          id: "e2e-alloc-svc",
          module: "custom_service",
          label: "E2E Alloc Service",
          amount: 30,
          currency: "USD",
          ipcChannel: "custom-services:add",
          formData: {
            description: "E2E Alloc Service",
            cost_usd: 0,
            cost_lbp: 0,
            price_usd: 30,
            price_lbp: 0,
            paid_by: "CASH",
          } as Record<string, unknown>,
        };

        const checkout = await w.api.session.checkout({
          sessionId,
          cartItems: [saleItem, serviceItem],
          paidByMethod: "CASH",
          // $30 CASH (settles the service) + $50 charged to the customer account.
          payments: [
            {
              method: "CASH",
              currency_code: "USD",
              amount: 30,
              direction: "IN",
            },
            {
              method: "CUSTOMER_ACCOUNT",
              currency_code: "USD",
              amount: 50,
              direction: "IN",
            },
          ],
          exchangeRate: rate,
          userId: 1,
        });

        if (!checkout.success) {
          return { error: checkout.error ?? "checkout failed" } as const;
        }

        const saleResult = (checkout.results ?? []).find(
          (r) => r.cartItemId === "e2e-alloc-sale",
        );
        if (!saleResult) {
          return { error: "sale result missing from checkout" } as const;
        }

        const sale = await w.api.sales.get(saleResult.transactionId);
        return {
          checkoutOk: checkout.success,
          saleId: saleResult.transactionId,
          sale,
        } as const;
      },
      { productId, rate: RATE },
    );

    expect(result.error).toBeUndefined();
    expect(result.checkoutOk).toBe(true);

    const sale = asSaleRow(result.sale);
    expect(sale).not.toBeNull();
    // The sale's goods value is $50…
    expect(sale?.final_amount_usd).toBeCloseTo(50, 2);
    // …but the $50 on-account debt is attributed to it, so the $30 CASH (which
    // settled the SERVICE) must NOT realize the sale: it stays PENDING.
    expect(sale?.paid_usd ?? 0).toBeCloseTo(0, 2);
    expect(sale?.paid_lbp ?? 0).toBeCloseTo(0, 2);
  });

  test("#3 a gift-card-paid sale realizes", async ({ appPage }) => {
    const clientId = await seedClient(appPage, {
      name: "E2E Alloc GiftCard",
      phone: "03700002",
    });
    expect(clientId).toBeGreaterThan(0);

    const productId = await seedProduct(appPage, {
      name: "E2E Alloc Product 40",
      cost_price: 15,
      sell_price: 40,
      quantity: 10,
    });
    expect(productId).toBeGreaterThan(0);

    const result = await appPage.evaluate(
      async ({ clientId, productId, rate }) => {
        const w = window as unknown as Api;

        // Mint a $40 gift card for this client.
        const voucher = await w.api.vouchers.create({
          clientId,
          amount: 40,
          currency: "USD",
        });
        if (!voucher.success || !voucher.voucher?.code) {
          return { error: voucher.error ?? "voucher create failed" } as const;
        }
        const code = voucher.voucher.code;

        const started = await w.api.session.start({
          customer_name: "E2E Alloc GiftCard",
          customer_phone: "03700002",
          started_by: "admin",
        });
        const sessionId = started.sessionId;
        if (!sessionId) {
          return { error: started.error ?? "no sessionId" } as const;
        }

        const saleItem = {
          id: "e2e-alloc-gc-sale",
          module: "pos",
          label: "E2E Alloc GiftCard Sale",
          amount: 40,
          currency: "USD",
          ipcChannel: "sales:process",
          formData: {
            client_id: null,
            items: [{ product_id: productId, quantity: 1, price: 40 }],
            total_amount: 40,
            discount: 0,
            final_amount: 40,
            payment_usd: 0,
            payment_lbp: 0,
            exchange_rate: rate,
            status: "completed",
          } as Record<string, unknown>,
        };

        const checkout = await w.api.session.checkout({
          sessionId,
          cartItems: [saleItem],
          paidByMethod: "GIFT_CARD",
          // Whole basket paid by redeeming the $40 gift card.
          payments: [
            {
              method: "GIFT_CARD",
              currency_code: "USD",
              amount: 40,
              direction: "IN",
              voucher_code: code,
            },
          ],
          exchangeRate: rate,
          userId: 1,
        });

        if (!checkout.success) {
          return { error: checkout.error ?? "checkout failed" } as const;
        }

        const saleResult = (checkout.results ?? []).find(
          (r) => r.cartItemId === "e2e-alloc-gc-sale",
        );
        if (!saleResult) {
          return { error: "sale result missing from checkout" } as const;
        }

        const sale = await w.api.sales.get(saleResult.transactionId);
        return {
          checkoutOk: checkout.success,
          saleId: saleResult.transactionId,
          sale,
        } as const;
      },
      { clientId, productId, rate: RATE },
    );

    expect(result.error).toBeUndefined();
    expect(result.checkoutOk).toBe(true);

    const sale = asSaleRow(result.sale);
    expect(sale).not.toBeNull();
    expect(sale?.final_amount_usd).toBeCloseTo(40, 2);
    // Gift-card value is prepaid/collected, so it is EXCLUDED from the account
    // debt in the allocation → the sale REALIZES (paid_usd ≈ $40).
    expect(sale?.paid_usd ?? 0).toBeCloseTo(40, 2);
  });
});

// Keep a typed reference to Page so the import is always used.
export type _SessionAllocationSpecPage = Page;
