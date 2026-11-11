/**
 * lira-web-097 — LIRA-380: an exchange made while a customer session is open
 * is a basket line, booked only at checkout (specs/380-exchange-basket-item,
 * story 1, SC-004).
 *
 * On the real web screens:
 *   1. start a customer session (POS → New Customer → New Session);
 *   2. a $20 charger line joins the basket (REST cart add — the same
 *      endpoint every page uses), then the Exchange page adds
 *      $100 → 8,950,000 LBP at 89,500 with "Add to basket": no payment
 *      window, the basket shows "… @ 89,500";
 *   3. nothing is booked: no new transaction for either line, General
 *      USD/LBP unchanged (deltas, rule 15);
 *   4. checkout pays $120 cash; the exchange's 8,950,000 LBP goes out as its
 *      own payout line;
 *   5. both rows are paid in the session (identity: `details.paid_in_session`)
 *      and General moved +$120 / −8,950,000 LBP once.
 * Also saves the What's new screenshot of the basket with the exchange line
 * (rule 30), 1400×900.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "./fixtures";
import {
  drawers,
  expectMoved,
  getJson,
  lastTxnId,
  openShopDay,
  postJson,
  txnsSince,
  waitPost,
} from "./shopDayHelpers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT = path.join(
  __dirname,
  "../../public/whats-new/1.35.0/exchange-basket-line.png",
);

test("LIRA-380 exchange in a session: a basket line until checkout, then one payment", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const day = await openShopDay(browser);
  const { page } = day;
  const customer = `Basket Exchange ${day.stamp}`;

  try {
    // ── 1. Start a customer session on the real screen ──────────────────
    await page.goto("/#/pos");
    await expect(
      page.getByPlaceholder("Search products by name or barcode..."),
    ).toBeVisible({ timeout: 20_000 });
    await page
      .getByRole("button", { name: /New Customer/ })
      .first()
      .click();
    await page
      .getByRole("button", { name: /^New Session/ })
      .first()
      .click();
    await page.locator("#customer-name").fill(customer);
    const started = waitPost(page, "/api/sessions/start");
    await page.getByRole("button", { name: "Start Session" }).click();
    const sessionId = (await started).body.sessionId as number;
    expect(sessionId).toBeGreaterThan(0);

    const before = await lastTxnId(day);
    const d0 = await drawers(day);

    // ── 2a. A $20 charger line (the cart endpoint every page uses) ───────
    const added = await postJson<{ success: boolean; error?: string }>(
      day,
      `/api/sessions/${sessionId}/cart`,
      {
        item_id: `charger-${day.stamp}`,
        module: "custom_service",
        label: "Service: Charger - $20",
        amount: 20,
        currency: "USD",
        form_data: JSON.stringify({
          description: `Charger ${day.stamp}`,
          cost_usd: 12,
          price_usd: 20,
          cost_lbp: 0,
          price_lbp: 0,
        }),
        ipc_channel: "custom-services:add",
      },
    );
    expect(added.success, JSON.stringify(added)).toBeTruthy();

    // ── 2b. The exchange, on the real Exchange page ─────────────────────
    await page.goto("/#/exchange");
    await page.reload(); // the basket reloads with the charger line
    const amountIn = page
      .locator("label", { hasText: "You Receive" })
      .locator("xpath=following-sibling::div[1]//input");
    await expect(amountIn).toBeVisible({ timeout: 20_000 });
    // The page opens on USD → LBP.
    await amountIn.fill("100");
    await page.getByTestId("exchange-direct-rate-input").fill("89500");
    await expect(
      page.getByRole("button", { name: /Proceed to Payout/i }),
    ).toHaveCount(0);
    const cartAdd = waitPost(page, `/api/sessions/${sessionId}/cart`);
    await page.getByRole("button", { name: /Add to basket/i }).click();
    const { body: cartBody, request: cartReq } = await cartAdd;
    expect(cartBody.success, JSON.stringify(cartBody)).toBeTruthy();
    expect(cartReq.module).toBe("exchange");
    expect(cartReq.ipc_channel).toBe("exchange:add-transaction");
    expect(cartReq.label).toBe("Exchange $100 → 8,950,000 LBP @ 89,500");
    const form = JSON.parse(cartReq.form_data as string) as Record<
      string,
      unknown
    >;
    expect(form).toMatchObject({
      fromCurrency: "USD",
      toCurrency: "LBP",
      amountIn: 100,
      amountOut: 8_950_000,
      leg1Rate: 89_500,
    });
    expect(form).not.toHaveProperty("payments");
    expect(form).not.toHaveProperty("customerPayments");
    // The page returned to empty.
    await expect(amountIn).toHaveValue("");

    // ── 3. Nothing is booked yet ────────────────────────────────────────
    const waiting = await txnsSince(day, before);
    expect(
      waiting.filter((t) => t.type === "EXCHANGE" || t.type === "CUSTOM_SERVICE"),
      JSON.stringify(waiting.map((t) => t.type)),
    ).toHaveLength(0);
    const dWaiting = await drawers(day);
    expectMoved(dWaiting, d0, "General", "USD", 0);
    expectMoved(dWaiting, d0, "General", "LBP", 0);

    // ── Screenshot: the basket with the exchange line and its rate ─────
    await page.setViewportSize({ width: 1400, height: 900 });
    const sessionButton = page
      .locator("button")
      .filter({ hasText: /Session - / })
      .first();
    await sessionButton.click();
    const line = page.getByText("Exchange $100 → 8,950,000 LBP @ 89,500");
    await expect(line.first()).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: SCREENSHOT });

    // ── 4. Checkout: $120 cash in, 8,950,000 LBP out ────────────────────
    await page.getByRole("button", { name: /Checkout \(2 items?\)/i }).click();
    await expect(page.getByText("Session Checkout")).toBeVisible();
    const done = waitPost(page, "/api/sessions/checkout");
    await page.getByRole("button", { name: "Confirm Checkout" }).click();
    const { body, request } = await done;
    expect(body.success, JSON.stringify(body)).toBeTruthy();
    const payments = request.payments as Array<Record<string, unknown>>;
    expect(payments, JSON.stringify(payments)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currency_code: "USD",
          amount: 120,
          direction: "IN",
        }),
        expect.objectContaining({
          currency_code: "LBP",
          amount: 8_950_000,
          direction: "OUT",
          kind: "PAYOUT",
          payoutOrigin: "GENERAL",
        }),
      ]),
    );

    // ── 5. Both rows paid in the session; the drawer moved once ─────────
    const rows = await txnsSince(day, before);
    const inSession = rows.filter(
      (r) => r.details?.paid_in_session === sessionId,
    );
    const exchangeRow = inSession.find((r) => r.type === "EXCHANGE");
    const chargerRow = inSession.find((r) => r.type === "CUSTOM_SERVICE");
    expect(exchangeRow, JSON.stringify(rows.map((r) => r.type))).toBeTruthy();
    expect(chargerRow).toBeTruthy();
    expect(exchangeRow!.client_name).toBe(customer);
    // Under the session group (the Transactions page groups by session_id).
    expect(exchangeRow!.session_id).toBe(sessionId);
    expect(chargerRow!.session_id).toBe(sessionId);
    const dEnd = await drawers(day);
    expectMoved(dEnd, d0, "General", "USD", 120);
    expectMoved(dEnd, d0, "General", "LBP", -8_950_000);
  } finally {
    // Never leave an active customer session for later specs.
    const list = await getJson<{ sessions?: Array<{ id: number }> }>(
      day,
      "/api/sessions/active-list",
    ).catch(() => ({ sessions: [] }));
    for (const s of list.sessions ?? []) {
      await postJson(day, `/api/sessions/${s.id}/close`).catch(() => null);
    }
    await day.context.close();
  }
});
