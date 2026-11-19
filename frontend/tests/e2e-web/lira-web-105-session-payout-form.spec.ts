/**
 * lira-web-105 — LIRA-402: a payout basket gets the payment box at Session
 * Checkout (specs/402-session-payout-payment-form, story 1, SC-003).
 *
 * The owner's basket (Corner Tech, 2026-11-19): Exchange 10 EUR → $10.50 and
 * a Whish App receive of $201 with the $2 fee taken from the payout ($199).
 * The shop owes the customer $209.50. Before LIRA-402 the checkout showed
 * only a "Payout to customer" row with one Cash select per currency.
 *
 * On the real web screens:
 *   1. start a customer session (POS → New Customer → New Session);
 *   2. the two lines join the basket (the cart endpoint every page uses);
 *   3. the checkout shows the payout box for $209.50 — no per-currency
 *      payout select; the What's new screenshot is taken here (rule 30);
 *   4. Split: $200 cash + the rest in LBP cash;
 *   5. the request carries two OUT/PAYOUT/GENERAL legs, and General moved
 *      −$200 / −(the LBP sent) — deltas (rule 15).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "./fixtures";
import {
  addLine,
  drawers,
  expectMoved,
  getJson,
  openShopDay,
  payAmount,
  payCurrency,
  payMethod,
  postJson,
  splitOn,
  waitPost,
} from "./shopDayHelpers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT = path.join(
  __dirname,
  "../../public/whats-new/1.35.0/session-payout-form.png",
);

test("LIRA-402 payout basket: the checkout shows the payment box and pays out split USD + LBP", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const day = await openShopDay(browser);
  const { page } = day;
  const customer = `Payout Basket ${day.stamp}`;

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
    // Wait for the session form before typing (focus can still sit on the
    // POS search box while the modal opens).
    const nameField = page.locator("#customer-name");
    await expect(nameField).toBeVisible();
    await nameField.click();
    await nameField.fill(customer);
    const started = waitPost(page, "/api/sessions/start");
    await page.getByRole("button", { name: "Start Session" }).click();
    const sessionId = (await started).body.sessionId as number;
    expect(sessionId).toBeGreaterThan(0);

    // ── 2. The owner's two lines ────────────────────────────────────────
    const exchange = await postJson<{ success: boolean; error?: string }>(
      day,
      `/api/sessions/${sessionId}/cart`,
      {
        item_id: `ex-${day.stamp}`,
        module: "exchange",
        label: "Exchange 10 EUR → $10.50 @ 1.05",
        amount: -10.5,
        currency: "USD",
        form_data: JSON.stringify({
          fromCurrency: "EUR",
          toCurrency: "USD",
          amountIn: 10,
          amountOut: 10.5,
          leg1Rate: 1.05,
          leg1MarketRate: 1.18,
          leg1ProfitUsd: 1.3,
          totalProfitUsd: 1.3,
          note: "Exchange EUR → USD",
        }),
        ipc_channel: "exchange:add-transaction",
      },
    );
    expect(exchange.success, JSON.stringify(exchange)).toBeTruthy();
    const receive = await postJson<{ success: boolean; error?: string }>(
      day,
      `/api/sessions/${sessionId}/cart`,
      {
        item_id: `whish-${day.stamp}`,
        module: "whish_app",
        label: "Whish App RECEIVE $201",
        amount: -199,
        currency: "USD",
        form_data: JSON.stringify({
          provider: "WHISH_APP",
          serviceType: "RECEIVE",
          amount: 201,
          currency: "USD",
          commission: 2,
          whishFee: 2,
          includingFees: false,
          cashoutMethod: "CASH",
        }),
        ipc_channel: "financial:create",
      },
    );
    expect(receive.success, JSON.stringify(receive)).toBeTruthy();
    await page.reload(); // the basket reloads with both lines

    const d0 = await drawers(day);

    // ── 3. Checkout shows the payout box ────────────────────────────────
    await page.setViewportSize({ width: 1400, height: 900 });
    await page
      .locator("button")
      .filter({ hasText: /Session - / })
      .first()
      .click();
    await page.getByRole("button", { name: /Checkout \(2 items?\)/i }).click();
    await expect(page.getByText("Session Checkout")).toBeVisible({
      timeout: 15_000,
    });
    const box = page.getByTestId("checkout-payout-box");
    await expect(box).toBeVisible();
    await expect(box).toContainText("Pay out to customer");
    await expect(page.getByTestId("payout-method-select-USD")).toHaveCount(0);
    await expect(payAmount(box, 0)).toHaveValue(/209\.5/);

    // ── 4. Split: $200 cash + the rest in LBP cash ──────────────────────
    await splitOn(box);
    // Split keeps the seeded line; make it $200 and add an LBP line for
    // the rest (the new line is prefilled with what is still owed).
    await payMethod(box, 0).selectOption("CASH");
    await payAmount(box, 0).fill("200");
    if ((await payAmount(box).count()) < 2) await addLine(box);
    await payMethod(box, 1).selectOption("CASH");
    await payCurrency(box, 1).selectOption("LBP");
    const lbpField = payAmount(box, 1);
    // The rest at the checkout's rate: read the rate the box shows, so the
    // figure is exactly what the screen owes (whole LBP).
    const rateText = await page
      .getByTestId("payment-exchange-rate")
      .first()
      .inputValue()
      .catch(() => "");
    const rate = Number(rateText.replace(/[^0-9.]/g, "")) || 89_000;
    const lbpRest = Math.round(9.5 * rate);
    await lbpField.fill(String(lbpRest));
    await page.screenshot({ path: SCREENSHOT });

    const confirm = page.getByTestId("session-checkout-confirm");
    await expect(confirm).toBeEnabled({ timeout: 10_000 });
    const done = waitPost(page, "/api/sessions/checkout");
    await confirm.click();
    const { body, request } = await done;
    expect(body.success, JSON.stringify(body)).toBeTruthy();

    // ── 5. The legs and the drawers ─────────────────────────────────────
    const payments = request.payments as Array<Record<string, unknown>>;
    expect(payments, JSON.stringify(payments)).toEqual([
      {
        method: "CASH",
        currency_code: "USD",
        amount: 200,
        direction: "OUT",
        kind: "PAYOUT",
        payoutOrigin: "GENERAL",
      },
      expect.objectContaining({
        method: "CASH",
        currency_code: "LBP",
        direction: "OUT",
        kind: "PAYOUT",
        payoutOrigin: "GENERAL",
      }),
    ]);
    const lbpSent = payments[1].amount as number;
    expect(lbpSent).toBeGreaterThan(0);
    const dEnd = await drawers(day);
    expectMoved(dEnd, d0, "General", "USD", -200);
    expectMoved(dEnd, d0, "General", "LBP", -lbpSent);
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
