/**
 * lira-web-077 — LIRA-337: give part of a for-sale line's credit back to a
 * shop line, over the web app (specs/337-give-credit-back/quickstart.md).
 *
 * A $15 Alfa line for sale (cost $20, price $25) and a fresh Alfa shop line
 * ($20). The buyer keeps $9: the line sends $5.68 + $0.32 SMS fee, the shop
 * line gains $5.68, the price drops by 6 × the credit price ÷ the shop's
 * rate. Voiding the give-back puts the line and the shop line back.
 *
 * Also saves the What's new screenshot of the panel (CLAUDE.md rule 30):
 * `frontend/public/whats-new/1.35.0/give-credit-back.png`.
 *
 * Rule 15: the line and the shop line are created with run-unique numbers
 * and matched by id; amounts are asserted as deltas.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT = path.join(
  __dirname,
  "../../public/whats-new/1.35.0/give-credit-back.png",
);

type Auth = { Authorization: string };

async function authOf(page: Page): Promise<Auth> {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  expect(token).toBeTruthy();
  return { Authorization: `Bearer ${token}` };
}

function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Run-unique 8-digit Lebanese numbers (70… for sale, 71… shop line). */
function uniqueNumber(prefix: string): string {
  return `${prefix}${String(Date.now()).slice(-6)}`;
}

async function resaleLine(page: Page, auth: Auth, productId: number) {
  const res = await (
    await page.request.get(`${BACKEND_URL}/api/resale-lines?include_sold=true`, {
      headers: auth,
    })
  ).json();
  const rows = (Array.isArray(res) ? res : (res.data ?? [])) as Array<{
    product_id: number;
    credits: number;
    selling_price_usd: number;
    cost_price_usd: number;
  }>;
  const row = rows.find((r) => r.product_id === productId);
  expect(row, "line for sale is listed").toBeTruthy();
  return row!;
}

async function shopLineCredits(page: Page, auth: Auth, id: number): Promise<number> {
  const res = await (
    await page.request.get(`${BACKEND_URL}/api/carrier-lines`, { headers: auth })
  ).json();
  const rows = (Array.isArray(res) ? res : (res.data ?? [])) as Array<{ id: number; credits: number }>;
  const row = rows.find((r) => r.id === id);
  expect(row, "shop line is listed").toBeTruthy();
  return row!.credits;
}

test("LIRA-337 — give credit back from a line for sale, then void it", async ({ page }) => {
  const auth = await authOf(page);
  const lineNumber = uniqueNumber("70");
  const shopNumber = uniqueNumber("71");

  // A line for sale: product in a lines category + its details.
  const created = await (
    await page.request.post(`${BACKEND_URL}/api/inventory/products`, {
      headers: auth,
      data: {
        name: `Alfa line ${lineNumber}`,
        category: "Phone Lines",
        barcode: lineNumber,
        cost_price_usd: 20,
        retail_price_usd: 25,
        stock: 1,
        min_stock_threshold: 0,
      },
    })
  ).json();
  const productId = Number(created.data?.id ?? created.id);
  expect(productId, JSON.stringify(created)).toBeGreaterThan(0);
  const saved = await (
    await page.request.put(`${BACKEND_URL}/api/resale-lines/${productId}`, {
      headers: auth,
      data: { product_id: productId, carrier: "alfa", credits: 15, validity_expires_at: inDays(30) },
    })
  ).json();
  expect(saved.success, JSON.stringify(saved)).toBeTruthy();

  // A fresh Alfa shop line to receive the credit.
  const shop = await (
    await page.request.post(`${BACKEND_URL}/api/carrier-lines`, {
      headers: auth,
      data: { carrier: "alfa", phone_number: shopNumber, credits: 20, validity_expires_at: inDays(60) },
    })
  ).json();
  const shopId = Number(shop.data?.id ?? shop.id);
  expect(shopId, JSON.stringify(shop)).toBeGreaterThan(0);
  const shopBefore = await shopLineCredits(page, auth, shopId);

  // The UI: Phone Lines → For sale → Give credit back.
  await page.goto("/#/phone-lines");
  await page.getByTestId(`resale-line-give-back-${productId}`).click();
  const panel = page.getByTestId("give-back-panel");
  await expect(panel).toBeVisible();
  await panel.getByLabel("Send the rest to shop line").selectOption(String(shopId));
  await panel.getByLabel("Credit price (LBP per $1)").fill("100000");
  await panel.getByLabel("Credit the buyer keeps ($)").fill("9");
  const preview = page.getByTestId("give-back-preview");
  await expect(preview).toContainText("Send $5.68 + SMS fee $0.32 → the line keeps $9.00.");

  // What's new card image (rule 30) — must be landscape.
  const box = await panel.boundingBox();
  expect(box && box.width > box.height).toBeTruthy();
  await panel.screenshot({ path: SCREENSHOT });

  const before = await resaleLine(page, auth, productId);
  const posted = page.waitForResponse(
    (r) => r.url().includes(`/api/resale-lines/${productId}/give-back`) && r.request().method() === "POST",
  );
  await panel.getByRole("button", { name: "Give credit back" }).click();
  const result = await (await posted).json();
  expect(result.success, JSON.stringify(result)).toBeTruthy();
  await expect(panel).toBeHidden();

  const after = await resaleLine(page, auth, productId);
  expect(after.credits).toBe(9);
  expect(Math.round((before.selling_price_usd - after.selling_price_usd) * 100) / 100).toBe(
    result.data.price_drop_usd,
  );
  expect(Math.round((before.cost_price_usd - after.cost_price_usd) * 100) / 100).toBe(
    result.data.cost_drop_usd,
  );
  expect(await shopLineCredits(page, auth, shopId)).toBeCloseTo(shopBefore + 5.68, 6);

  // One Void puts everything back.
  const voided = await (
    await page.request.post(`${BACKEND_URL}/api/transactions/${result.data.transaction_id}/void`, {
      headers: auth,
    })
  ).json();
  expect(voided.success, JSON.stringify(voided)).toBeTruthy();
  const restored = await resaleLine(page, auth, productId);
  expect(restored).toMatchObject({ credits: 15, selling_price_usd: 25, cost_price_usd: 20 });
  expect(await shopLineCredits(page, auth, shopId)).toBeCloseTo(shopBefore, 6);
});
