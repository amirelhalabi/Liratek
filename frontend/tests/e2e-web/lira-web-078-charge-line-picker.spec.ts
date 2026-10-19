/**
 * lira-web-078 — LIRA-338: "Charge to shop line" on the Whish App grid lets
 * the cashier pick WHICH line gets the card (owner, 2026-10-19).
 *
 *  1. A Whish App Alfa card charged to a second (not main) Alfa shop line:
 *     that line gains the card's credit, the main line does not, and the
 *     Whish App LBP balance pays.
 *  2. The same card charged to an Alfa line held for sale: its cost and
 *     price go up by the card's cost.
 *  3. Voiding both puts every line back.
 *
 * Also saves the What's new screenshot of the window (CLAUDE.md rule 30):
 * `frontend/public/whats-new/1.35.0/charge-line-picker.png`.
 *
 * Rule 15: lines, the line for sale and the card are created with run-unique
 * numbers / labels and matched by id; amounts are deltas.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { test, expect, loginAsAdmin, gotoAndSettle, BACKEND_URL } from "./fixtures";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT = path.join(__dirname, "../../public/whats-new/1.35.0/charge-line-picker.png");

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

function listOf<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  return ((res as { data?: T[] }).data ?? []) as T[];
}

async function shopLine(page: Page, auth: Auth, id: number) {
  const rows = listOf<{ id: number; credits: number }>(
    await (await page.request.get(`${BACKEND_URL}/api/carrier-lines`, { headers: auth })).json(),
  );
  const row = rows.find((r) => r.id === id);
  expect(row, "shop line listed").toBeTruthy();
  return row!;
}

async function saleLine(page: Page, auth: Auth, productId: number) {
  const rows = listOf<{ product_id: number; cost_price_usd: number; selling_price_usd: number; credits: number }>(
    await (await page.request.get(`${BACKEND_URL}/api/resale-lines?include_sold=true`, { headers: auth })).json(),
  );
  const row = rows.find((r) => r.product_id === productId);
  expect(row, "line for sale listed").toBeTruthy();
  return row!;
}

async function openWhishBills(page: Page): Promise<void> {
  await gotoAndSettle(page, "/#/recharge");
  await page.reload();
  const tab = page.getByRole("button", { name: "Whish App", exact: true }).first();
  await expect(tab).toBeVisible({ timeout: 8_000 });
  await tab.click();
  const billsTab = page.locator("button").filter({ hasText: /^Bills$/ }).first();
  await expect(billsTab).toBeVisible({ timeout: 10_000 });
  await billsTab.click();
}

async function openChargeWindow(page: Page, label: string) {
  await openWhishBills(page);
  await page.getByPlaceholder(/Search Whish App items/i).fill(label);
  const card = page.locator("div.relative.flex.flex-col").filter({ hasText: label }).first();
  await card.getByTestId("whish-self-charge").click();
  const modal = page.getByTestId("charge-line-modal");
  await expect(modal).toBeVisible();
  return modal;
}

async function voidTxn(page: Page, auth: Auth, id: number) {
  const r = await (
    await page.request.post(`${BACKEND_URL}/api/transactions/${id}/void`, { headers: auth })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
}

test("LIRA-338 — pick the line a Whish App card is charged to", async ({ page }) => {
  const auth = await authOf(page);
  const stamp = String(Date.now()).slice(-6);
  const label = `L338 ${stamp}`;

  // Two Alfa shop lines; the first is made the main line.
  const mk = async (phone: string) => {
    const r = await (
      await page.request.post(`${BACKEND_URL}/api/carrier-lines`, {
        headers: auth,
        data: { carrier: "alfa", phone_number: phone, credits: 20, validity_expires_at: inDays(60) },
      })
    ).json();
    const id = Number(r.data?.id ?? r.id);
    expect(id, JSON.stringify(r)).toBeGreaterThan(0);
    return id;
  };
  const mainId = await mk(`03${stamp}`);
  const secondId = await mk(`71${stamp}`);
  await page.request.put(`${BACKEND_URL}/api/carrier-lines/${mainId}/set-primary`, { headers: auth });

  // A line held for sale.
  const created = await (
    await page.request.post(`${BACKEND_URL}/api/inventory/products`, {
      headers: auth,
      data: { name: `Alfa line 70${stamp}`, category: "Phone Lines", barcode: `70${stamp}`, cost_price_usd: 15, retail_price_usd: 25, stock: 1, min_stock_threshold: 0 },
    })
  ).json();
  const productId = Number(created.data?.id ?? created.id);
  expect(productId, JSON.stringify(created)).toBeGreaterThan(0);
  const saved = await (
    await page.request.put(`${BACKEND_URL}/api/resale-lines/${productId}`, {
      headers: auth,
      data: { product_id: productId, carrier: "alfa", credits: 0, validity_expires_at: inDays(20) },
    })
  ).json();
  expect(saved.success, JSON.stringify(saved)).toBeTruthy();

  // A Whish App Alfa card with credit and days.
  const item = await (
    await page.request.post(`${BACKEND_URL}/api/mobile-service-items`, {
      headers: auth,
      data: { provider: "WHISH_APP", category: "alfa", subcategory: "Prepaid", label, cost_lbp: 765007, sell_lbp: 800000, credits: 7.58, validity_days: 30 },
    })
  ).json();
  expect(item.success, JSON.stringify(item)).toBeTruthy();

  const mainBefore = (await shopLine(page, auth, mainId)).credits;
  const secondBefore = (await shopLine(page, auth, secondId)).credits;
  const saleBefore = await saleLine(page, auth, productId);

  // 1. Charge the SECOND shop line.
  let modal = await openChargeWindow(page, label);
  await expect(modal.getByLabel(new RegExp(`03${stamp}`))).toBeChecked();
  await expect(modal.getByLabel(new RegExp(`70${stamp}`))).toBeVisible();
  await modal.getByLabel(new RegExp(`71${stamp}`)).check();
  const box = await modal.boundingBox();
  expect(box).toBeTruthy();
  // What's new images must be landscape: widen the clip around the window.
  const height = box!.height + 16;
  const width = Math.max(box!.width + 16, Math.ceil(height * 1.4));
  await page.screenshot({
    path: SCREENSHOT,
    clip: { x: Math.max(0, box!.x + box!.width / 2 - width / 2), y: Math.max(0, box!.y - 8), width, height },
  });
  let posted = page.waitForResponse((r) => r.url().includes("/api/services/self-charge"));
  await modal.getByTestId("katsh-self-charge-confirm").click();
  const charged = await (await posted).json();
  expect(charged.success, JSON.stringify(charged)).toBeTruthy();
  await expect(modal.getByText("Charged successfully.")).toBeVisible();
  expect((await shopLine(page, auth, secondId)).credits).toBeCloseTo(secondBefore + 7.58, 6);
  expect((await shopLine(page, auth, mainId)).credits).toBeCloseTo(mainBefore, 6);

  // 2. Charge the line held for sale.
  modal = await openChargeWindow(page, label);
  await modal.getByLabel(new RegExp(`70${stamp}`)).check();
  await expect(modal.getByTestId("charge-line-for-sale-preview")).toBeVisible();
  posted = page.waitForResponse((r) => r.url().includes(`/api/resale-lines/${productId}/recharge`));
  await modal.getByTestId("katsh-self-charge-confirm").click();
  const recharged = await (await posted).json();
  expect(recharged.success, JSON.stringify(recharged)).toBeTruthy();
  const saleAfter = await saleLine(page, auth, productId);
  expect(saleAfter.credits).toBeCloseTo(7.58, 6);
  expect(Math.round((saleAfter.cost_price_usd - saleBefore.cost_price_usd) * 100) / 100).toBe(recharged.data.cost_usd);
  expect(Math.round((saleAfter.selling_price_usd - saleBefore.selling_price_usd) * 100) / 100).toBe(recharged.data.cost_usd);

  // 3. Void both: every line is back.
  await voidTxn(page, auth, recharged.data.transaction_id);
  await voidTxn(page, auth, charged.data.transactionId);
  expect((await shopLine(page, auth, secondId)).credits).toBeCloseTo(secondBefore, 6);
  expect(await saleLine(page, auth, productId)).toMatchObject({
    credits: 0,
    cost_price_usd: saleBefore.cost_price_usd,
    selling_price_usd: saleBefore.selling_price_usd,
  });
});
