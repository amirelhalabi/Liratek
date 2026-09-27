/**
 * lira-web-037 — LIRA-232 session-basket single-item refund, REST twin of
 * the desktop `lira-232-session-item-refund.spec.ts` (rule 19 — dual
 * transport). Drives the preview + refund REST routes directly
 * (`GET`/`POST /api/transactions/session-basket/:sessionId/items/refund*`),
 * the same pure-REST style `lira-web-018` uses for session-basket checkout
 * — no REST route exposes clicking through the Transactions/POS UI, so this
 * file proves the WEB TRANSPORT half of the contract (rule 19: same core
 * service, same envelope) rather than re-driving the browser UI the desktop
 * spec already covers.
 *
 * Scenario (account basket): a session sells ONE product, checked out
 * entirely on the client's CUSTOMER_ACCOUNT. The preview reports the item's
 * own amount, the FULL account reduction (the item's price <= what's owed),
 * a zero remainder, and no default legs; the refund itself nets the client's
 * debt back to 0, restocks the product, and leaves General untouched.
 *
 * Scenario (cash basket): a session sells ONE product paid CASH. The preview
 * reports a zero account reduction and ONE default CASH leg for the full
 * price; the refund moves General DOWN by exactly that amount.
 *
 * NOT RUN by this build — the owner runs the e2e cycle.
 */
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

type Debtor = { id: number; full_name: string; total_debt_usd: number };

test.describe("LIRA-232 (web) — session basket item refund over REST", () => {
  test("account basket: preview + refund net the client's debt to 0 and restock the product", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const token = await page.evaluate(() =>
      localStorage.getItem("liratek.jwt"),
    );
    const auth = { Authorization: `Bearer ${token}` };
    const ts = Date.now();
    const clientName = `L232W Account ${ts}`;
    const productName = `L232W Widget ${ts}`;

    const drawers = async (): Promise<{ general: number }> => {
      const r = await (
        await page.request.get(`${BACKEND_URL}/api/dashboard/drawer-balances`, {
          headers: auth,
        })
      ).json();
      expect(r.success, JSON.stringify(r)).toBeTruthy();
      return { general: r.balances.generalDrawer.usd as number };
    };

    const debtUsdFor = async (name: string): Promise<number> => {
      const r = await (
        await page.request.get(`${BACKEND_URL}/api/debts/debtors`, {
          headers: auth,
        })
      ).json();
      expect(r.success, JSON.stringify(r)).toBeTruthy();
      const row = (r.debtors as Debtor[]).find((d) => d.full_name === name);
      return row?.total_debt_usd ?? 0;
    };

    const stockOf = async (id: number): Promise<number> => {
      const r = await (
        await page.request.get(`${BACKEND_URL}/api/inventory/products/${id}`, {
          headers: auth,
        })
      ).json();
      expect(r.success, JSON.stringify(r)).toBeTruthy();
      return r.product.stock_quantity as number;
    };

    // Seed a product over REST (createProductSchema's REST field names —
    // see helpers/seed.ts's own webPost branch for the same mapping).
    const productRes = await (
      await page.request.post(`${BACKEND_URL}/api/inventory/products`, {
        headers: auth,
        data: {
          name: productName,
          cost_price_usd: 15,
          retail_price_usd: 60,
          stock: 5,
          category: "General",
          min_stock_threshold: 0,
        },
      })
    ).json();
    expect(productRes.success, JSON.stringify(productRes)).toBeTruthy();
    const productId = (productRes.id ?? productRes.data?.id) as number;
    expect(productId).toBeTruthy();

    const stockBefore = await stockOf(productId);
    const drawerBefore = await drawers();

    // Start the session + checkout the sale entirely on CUSTOMER_ACCOUNT
    // (mirrors lira-web-018's own session-checkout REST pattern).
    const started = await (
      await page.request.post(`${BACKEND_URL}/api/sessions/start`, {
        headers: auth,
        data: {
          customer_name: clientName,
          customer_phone: `73${String(ts).slice(-6)}`,
        },
      })
    ).json();
    expect(started.success, JSON.stringify(started)).toBeTruthy();
    const sessionId = started.sessionId as number;

    const checkout = await (
      await page.request.post(`${BACKEND_URL}/api/sessions/checkout`, {
        headers: auth,
        data: {
          sessionId,
          cartItems: [
            {
              id: "l232w-sale",
              module: "pos",
              label: "L232W Sale",
              amount: 60,
              currency: "USD",
              ipcChannel: "sales:process",
              formData: {
                client_id: null,
                items: [{ product_id: productId, quantity: 1, price: 60 }],
                total_amount: 60,
                discount: 0,
                final_amount: 60,
                payment_usd: 0,
                payment_lbp: 0,
                exchange_rate: 90000,
                status: "completed",
              },
            },
          ],
          payments: [
            { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 60 },
          ],
          exchangeRate: 90000,
          userId: 1,
        },
      })
    ).json();
    expect(checkout.success, JSON.stringify(checkout)).toBeTruthy();
    const saleResult = (
      checkout.results as Array<{
        cartItemId: string;
        transactionId: number;
      }>
    ).find((r) => r.cartItemId === "l232w-sale");
    expect(saleResult).toBeTruthy();
    // Round-2 review (finding 7) — `checkout.results[].transactionId` is the
    // SALE'S OWN id (`SessionCheckoutService.ts` ~495/545: `transactionId:
    // result.sourceId`), NOT the unified `customer_session_transactions`
    // member id `refund-preview`/`refund` below require. Resolve the real
    // unified id the way the app itself does (SaleDetailModal.tsx, finding
    // 1's contract) — `GET /api/sales/:saleId/refund-preview` now returns
    // `sessionId`/`sessionTransactionId` when the sale is session-linked.
    const saleId = saleResult!.transactionId;
    const saleRefundPreview = await (
      await page.request.get(
        `${BACKEND_URL}/api/sales/${saleId}/refund-preview`,
        { headers: auth },
      )
    ).json();
    expect(
      saleRefundPreview.success,
      JSON.stringify(saleRefundPreview),
    ).toBeTruthy();
    expect(saleRefundPreview.sessionLinked).toBe(true);
    expect(saleRefundPreview.sessionId).toBe(sessionId);
    const transactionId = saleRefundPreview.sessionTransactionId as number;
    expect(transactionId).toBeTruthy();

    await expect
      .poll(async () => debtUsdFor(clientName), { timeout: 10_000 })
      .toBeCloseTo(60, 2);
    expect(await stockOf(productId)).toBe(stockBefore - 1);
    expect((await drawers()).general).toBeCloseTo(drawerBefore.general, 2);

    // ── Preview ───────────────────────────────────────────────────────────
    const preview = await (
      await page.request.get(
        `${BACKEND_URL}/api/transactions/session-basket/${sessionId}/items/refund-preview?transactionId=${transactionId}`,
        { headers: auth },
      )
    ).json();
    expect(preview.success, JSON.stringify(preview)).toBeTruthy();
    expect(preview.itemAmountUsd).toBeCloseTo(60, 2);
    expect(preview.itemAmountLbp).toBeCloseTo(0, 2);
    expect(preview.accountReductionUsd).toBeCloseTo(60, 2);
    expect(preview.accountReductionLbp).toBeCloseTo(0, 2);
    expect(preview.remainderUsd).toBeCloseTo(0, 2);
    expect(preview.remainderLbp).toBeCloseTo(0, 2);
    expect(preview.defaultLegs).toEqual([]);

    // ── Refund (no override — remainder is 0, nothing to hand back) ────────
    const refund = await (
      await page.request.post(
        `${BACKEND_URL}/api/transactions/session-basket/${sessionId}/items/refund`,
        {
          headers: auth,
          data: { transactionId, clientDay: new Date().toISOString().slice(0, 10) },
        },
      )
    ).json();
    expect(refund.success, JSON.stringify(refund)).toBeTruthy();
    expect(refund.accountReductionUsd).toBeCloseTo(60, 2);
    expect(refund.remainderUsd).toBeCloseTo(0, 2);
    expect(refund.legs).toEqual([]);

    await expect
      .poll(async () => debtUsdFor(clientName), { timeout: 10_000 })
      .toBeCloseTo(0, 2);
    expect(await stockOf(productId)).toBe(stockBefore);
    expect((await drawers()).general).toBeCloseTo(drawerBefore.general, 2);
  });

  test("cash basket: the preview pre-fills a default CASH leg and the refund moves General down by exactly the item", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const token = await page.evaluate(() =>
      localStorage.getItem("liratek.jwt"),
    );
    const auth = { Authorization: `Bearer ${token}` };
    const ts = Date.now();
    const clientName = `L232W Cash ${ts}`;
    const productName = `L232W Cash Widget ${ts}`;

    const drawers = async (): Promise<{ general: number }> => {
      const r = await (
        await page.request.get(`${BACKEND_URL}/api/dashboard/drawer-balances`, {
          headers: auth,
        })
      ).json();
      expect(r.success, JSON.stringify(r)).toBeTruthy();
      return { general: r.balances.generalDrawer.usd as number };
    };

    const productRes = await (
      await page.request.post(`${BACKEND_URL}/api/inventory/products`, {
        headers: auth,
        data: {
          name: productName,
          cost_price_usd: 5,
          retail_price_usd: 25,
          stock: 5,
          category: "General",
          min_stock_threshold: 0,
        },
      })
    ).json();
    expect(productRes.success, JSON.stringify(productRes)).toBeTruthy();
    const productId = (productRes.id ?? productRes.data?.id) as number;

    const drawerBefore = await drawers();

    const started = await (
      await page.request.post(`${BACKEND_URL}/api/sessions/start`, {
        headers: auth,
        data: {
          customer_name: clientName,
          customer_phone: `74${String(ts).slice(-6)}`,
        },
      })
    ).json();
    expect(started.success, JSON.stringify(started)).toBeTruthy();
    const sessionId = started.sessionId as number;

    const checkout = await (
      await page.request.post(`${BACKEND_URL}/api/sessions/checkout`, {
        headers: auth,
        data: {
          sessionId,
          cartItems: [
            {
              id: "l232w-cash-sale",
              module: "pos",
              label: "L232W Cash Sale",
              amount: 25,
              currency: "USD",
              ipcChannel: "sales:process",
              formData: {
                client_id: null,
                items: [{ product_id: productId, quantity: 1, price: 25 }],
                total_amount: 25,
                discount: 0,
                final_amount: 25,
                payment_usd: 0,
                payment_lbp: 0,
                exchange_rate: 90000,
                status: "completed",
              },
            },
          ],
          payments: [{ method: "CASH", currency_code: "USD", amount: 25 }],
          exchangeRate: 90000,
          userId: 1,
        },
      })
    ).json();
    expect(checkout.success, JSON.stringify(checkout)).toBeTruthy();
    const saleResult = (
      checkout.results as Array<{
        cartItemId: string;
        transactionId: number;
      }>
    ).find((r) => r.cartItemId === "l232w-cash-sale");
    expect(saleResult).toBeTruthy();
    // Round-2 review (finding 7) — same fix as the account-basket scenario
    // above: resolve the REAL unified member id off the sale refund preview,
    // never `checkout.results[].transactionId` (the sale's own id).
    const saleId = saleResult!.transactionId;
    const saleRefundPreview = await (
      await page.request.get(
        `${BACKEND_URL}/api/sales/${saleId}/refund-preview`,
        { headers: auth },
      )
    ).json();
    expect(
      saleRefundPreview.success,
      JSON.stringify(saleRefundPreview),
    ).toBeTruthy();
    expect(saleRefundPreview.sessionLinked).toBe(true);
    expect(saleRefundPreview.sessionId).toBe(sessionId);
    const transactionId = saleRefundPreview.sessionTransactionId as number;
    expect(transactionId).toBeTruthy();

    await expect
      .poll(async () => drawers().then((d) => d.general), { timeout: 10_000 })
      .toBeCloseTo(drawerBefore.general + 25, 2);
    const drawerAfterSale = (await drawers()).general;

    const preview = await (
      await page.request.get(
        `${BACKEND_URL}/api/transactions/session-basket/${sessionId}/items/refund-preview?transactionId=${transactionId}`,
        { headers: auth },
      )
    ).json();
    expect(preview.success, JSON.stringify(preview)).toBeTruthy();
    expect(preview.accountReductionUsd).toBeCloseTo(0, 2);
    expect(preview.remainderUsd).toBeCloseTo(25, 2);
    expect(preview.defaultLegs).toHaveLength(1);
    expect(preview.defaultLegs[0]).toMatchObject({
      method: "CASH",
      currency_code: "USD",
      amount: 25,
    });

    const refund = await (
      await page.request.post(
        `${BACKEND_URL}/api/transactions/session-basket/${sessionId}/items/refund`,
        {
          headers: auth,
          data: { transactionId, clientDay: new Date().toISOString().slice(0, 10) },
        },
      )
    ).json();
    expect(refund.success, JSON.stringify(refund)).toBeTruthy();
    expect(refund.remainderUsd).toBeCloseTo(25, 2);

    await expect
      .poll(async () => drawers().then((d) => d.general), { timeout: 10_000 })
      .toBeCloseTo(drawerAfterSale - 25, 2);
  });
});
