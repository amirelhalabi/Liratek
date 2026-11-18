/**
 * lira-web-103 — LIRA-400: a payment-method fee typed on a Whish line at the
 * POS, over the web app (specs/400-payment-method-fee/quickstart.md).
 *
 * A $10 product paid with Whish; the cashier taps "+ fee" on the Whish line
 * and types 1. Through the REAL checkout:
 *   - the request carries the leg's `fee_amount: 1` (the sale schema's key);
 *   - Whish_App moves +$11, General does not move;
 *   - Profits › Payment Method Fees goes up by $1;
 *   - VOID (the sale never happened) nets Whish_App and the fee line to 0;
 *   - a second, identical sale REFUNDED gives the customer the $10 price
 *     back: Whish_App and the fee line each stay up by exactly $1.
 *
 * Also saves the What's new screenshot (CLAUDE.md rule 30):
 * `frontend/public/whats-new/1.35.0/payment-method-fee.png`.
 *
 * Rule 15: a run-unique product, each sale matched by its own id from the
 * response, money asserted as deltas (the web DB is shared).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";
import {
  test,
  expect,
  loginAsAdmin,
  gotoAndSettle,
  unlockProfitsOverRest,
  BACKEND_URL,
} from "./fixtures";
import { payMethod, payAmount, waitPost } from "./shopDayHelpers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT = path.join(
  __dirname,
  "../../public/whats-new/1.35.0/payment-method-fee.png",
);

type Auth = { Authorization: string };

const PRICE = 10;
const FEE = 1;

async function authOf(page: Page): Promise<Auth> {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  expect(token).toBeTruthy();
  return { Authorization: `Bearer ${token}` };
}

function isoDay(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

async function drawer(
  page: Page,
  auth: Auth,
  name: string,
  currency: string,
): Promise<number> {
  const r = await (
    await page.request.get(
      `${BACKEND_URL}/api/closing/system-expected-balances-dynamic`,
      { headers: auth },
    )
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return Number(r.balances?.[name]?.[currency] ?? 0);
}

/** Profits › Payment Method Fees (USD), yesterday..tomorrow (rule 27). */
async function pmFeeUsd(page: Page, auth: Auth): Promise<number> {
  const r = await (
    await page.request.get(
      `${BACKEND_URL}/api/profits/summary?from=${isoDay(-1)}&to=${isoDay(1)}`,
      { headers: auth },
    )
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return Number(r.data.financial_services.pm_fee_usd ?? 0);
}

async function snapshot(page: Page, auth: Auth) {
  return {
    whish: await drawer(page, auth, "Whish_App", "USD"),
    general: await drawer(page, auth, "General", "USD"),
    fee: await pmFeeUsd(page, auth),
  };
}

/** One POS sale of the product, paid Whish $10 + $1 fee, through the UI.
 *  Returns the sale's transaction id and the open modal (for the shot). */
async function sellWithFee(
  page: Page,
  productName: string,
  onModal?: (modal: Locator) => Promise<void>,
): Promise<{ saleId: number; request: Record<string, unknown> }> {
  await gotoAndSettle(page, "/#/pos");
  const search = page.getByPlaceholder("Search products by name or barcode...");
  await search.fill(productName);
  const main = page.locator("main");
  await expect(main.getByText(productName).first()).toBeVisible({
    timeout: 10_000,
  });
  await main.getByRole("button", { name: /Add/ }).first().click();
  await search.fill("");
  await page.getByRole("button", { name: /Proceed to Checkout/ }).click();
  const modal = page.getByTestId("checkout-modal");
  await expect(modal).toBeVisible();

  await payMethod(modal, 0).selectOption("WHISH");
  await expect(payAmount(modal, 0)).toHaveValue(/10/);
  // "+ fee" sits at the right end of the Whish line; tap → fee box.
  await modal.locator('[data-testid^="payment-fee-add-"]').click();
  const feeBox = modal.locator('input[data-testid^="payment-fee-"]');
  await feeBox.fill(String(FEE));
  await feeBox.blur();
  await expect(modal.getByTestId("payment-method-fee-summary")).toContainText(
    "1.00",
  );
  if (onModal) await onModal(modal);

  const sale = waitPost(page, "/api/sales/process");
  await modal.getByTestId("checkout-complete-btn").click();
  const { body, request } = await sale;
  expect(body.success, JSON.stringify(body)).toBeTruthy();
  return { saleId: Number(body.id), request };
}

async function saleTxnId(
  page: Page,
  auth: Auth,
  saleId: number,
): Promise<number> {
  const recent = await (
    await page.request.get(`${BACKEND_URL}/api/transactions/recent?limit=200`, {
      headers: auth,
    })
  ).json();
  const row = (
    recent.transactions as Array<{
      id: number;
      type: string;
      source_id: number | null;
      reverses_id?: number | null;
    }>
  ).find((t) => t.type === "SALE" && t.source_id === saleId && !t.reverses_id);
  expect(row, `SALE txn for sale ${saleId}`).toBeTruthy();
  return row!.id;
}

test.describe("lira-web-103 payment-method fee on a POS Whish line", () => {
  test("Whish $10 + $1 fee: +$11 Whish, +$1 fee; void → 0; refund keeps the $1", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const auth = await authOf(page);
    await unlockProfitsOverRest(page, auth);
    const stamp = Date.now().toString().slice(-7);
    const productName = `L103 Fee Charger ${stamp}`;
    const product = await (
      await page.request.post(`${BACKEND_URL}/api/inventory/products`, {
        headers: auth,
        data: {
          name: productName,
          category: "General",
          cost_price_usd: 6,
          retail_price_usd: PRICE,
          stock: 10,
          min_stock_threshold: 0,
        },
      })
    ).json();
    expect(product.success, JSON.stringify(product)).toBeTruthy();

    // ── Sale 1: fee booked, then VOID nets to 0 ─────────────────────────
    const s0 = await snapshot(page, auth);
    const first = await sellWithFee(page, productName, async (modal) => {
      // What's new card image (rule 30) — the checkout with the fee box,
      // clipped landscape around the payment panel.
      const box = await modal.boundingBox();
      expect(box).toBeTruthy();
      const viewport = page.viewportSize()!;
      const height = Math.min(box!.height, viewport.height);
      const width = Math.min(viewport.width, Math.max(box!.width, height * 1.4));
      const x = Math.max(0, box!.x + box!.width / 2 - width / 2);
      await page.screenshot({
        path: SCREENSHOT,
        clip: { x, y: Math.max(0, box!.y), width, height },
      });
      expect(width).toBeGreaterThan(height);
    });
    const legs = first.request.payments as Array<Record<string, unknown>>;
    expect(legs[0]).toMatchObject({
      method: "WHISH",
      currency_code: "USD",
      amount: PRICE,
      fee_amount: FEE,
    });
    const s1 = await snapshot(page, auth);
    expect(s1.whish - s0.whish).toBeCloseTo(PRICE + FEE, 2);
    expect(s1.general - s0.general).toBeCloseTo(0, 2);
    expect(s1.fee - s0.fee).toBeCloseTo(FEE, 2);

    const txn1 = await saleTxnId(page, auth, first.saleId);
    const voided = await (
      await page.request.post(`${BACKEND_URL}/api/transactions/${txn1}/void`, {
        headers: auth,
      })
    ).json();
    expect(voided.success, JSON.stringify(voided)).toBeTruthy();
    const s2 = await snapshot(page, auth);
    expect(s2.whish - s0.whish).toBeCloseTo(0, 2);
    expect(s2.fee - s0.fee).toBeCloseTo(0, 2);

    // ── Sale 2: REFUND gives the price back, the fee stays ──────────────
    const second = await sellWithFee(page, productName);
    const s3 = await snapshot(page, auth);
    expect(s3.whish - s2.whish).toBeCloseTo(PRICE + FEE, 2);
    const txn2 = await saleTxnId(page, auth, second.saleId);
    const refunded = await (
      await page.request.post(
        `${BACKEND_URL}/api/transactions/${txn2}/refund`,
        { headers: auth, data: {} },
      )
    ).json();
    expect(refunded.success, JSON.stringify(refunded)).toBeTruthy();
    const s4 = await snapshot(page, auth);
    expect(s4.whish - s2.whish).toBeCloseTo(FEE, 2);
    expect(s4.fee - s2.fee).toBeCloseTo(FEE, 2);
    expect(s4.general - s2.general).toBeCloseTo(0, 2);
  });
});
