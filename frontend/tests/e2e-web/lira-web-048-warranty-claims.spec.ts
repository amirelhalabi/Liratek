/**
 * lira-web-048 — LIRA-296 P2: a warranty REPLACE claim and its void, over
 * the WEB transport (browser + REST, rule 19d).
 *
 * In the browser: find the sale on the Warranty page by its receipt number,
 * start a Replace claim, see it in the claim history, then void it.
 * Over REST, deltas around each step (rule 15 — the web DB accumulates
 * across runs, so only deltas and identity are asserted):
 *   - the claim takes ONE unit off the shelf, moves NO drawer, and adds
 *     −cost to the Profits "Warranty cost" line;
 *   - the void brings stock, the drawer and the Warranty cost line back to
 *     exactly where they were (rule 20).
 */
import {
  test,
  expect,
  loginAsAdmin,
  gotoAndSettle,
  BACKEND_URL,
} from "./fixtures";
import type { Page } from "@playwright/test";

type Headers = Record<string, string>;
const E2E_PROFITS_PASSWORD = "Profits1!";

const pad = (n: number) => String(n).padStart(2, "0");
const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

async function json<T = Record<string, unknown>>(
  res: Promise<{ json: () => Promise<unknown> }>,
): Promise<T> {
  const body = (await (await res).json()) as { success?: boolean };
  expect(body.success, JSON.stringify(body)).toBeTruthy();
  return body as T;
}

async function ensureProfitsUnlocked(page: Page, headers: Headers) {
  // The web DB is shared across specs, and other specs set different
  // profits passwords (e.g. "Profits1!" vs "1234"), so "set only if unset"
  // depends on run order. The admin may always replace it — do so, then
  // unlock with the value we know.
  await json(
    page.request.put(`${BACKEND_URL}/api/profits/password`, {
      headers,
      data: { password: E2E_PROFITS_PASSWORD },
    }),
  );
  await json(
    page.request.post(`${BACKEND_URL}/api/profits/unlock`, {
      headers,
      data: { password: E2E_PROFITS_PASSWORD },
    }),
  );
}

test("a Replace warranty claim moves one unit and books the Warranty cost; voiding it nets everything back", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const headers: Headers = { Authorization: `Bearer ${token as string}` };
  const ts = Date.now();
  const PRODUCT = `W048 Earbuds ${ts}`;
  const DAY = localDay();

  const created = await json<{ id?: number; data?: { id: number } }>(
    page.request.post(`${BACKEND_URL}/api/inventory/products`, {
      headers,
      data: {
        name: PRODUCT,
        category: "General",
        cost_price_usd: 6,
        retail_price_usd: 20,
        stock: 5,
        warranty_months: 3,
        min_stock_threshold: 0,
      },
    }),
  );
  const productId = (created.data?.id ?? created.id) as number;

  const sale = await json<{ id: number }>(
    page.request.post(`${BACKEND_URL}/api/sales/process`, {
      headers,
      data: {
        client_id: null,
        items: [{ product_id: productId, quantity: 1, price: 20 }],
        total_amount: 20,
        discount: 0,
        final_amount: 20,
        payment_usd: 20,
        payment_lbp: 0,
        payments: [
          { method: "CASH", currency_code: "USD", amount: 20, direction: "IN" },
        ],
        change_given_usd: 0,
        change_given_lbp: 0,
        exchange_rate: 90000,
        client_day: DAY,
      },
    }),
  );
  const RECEIPT = `RCP-${sale.id}`;

  const snapshot = async () => {
    await ensureProfitsUnlocked(page, headers);
    const product = await json<{ product: { stock_quantity: number } }>(
      page.request.get(`${BACKEND_URL}/api/inventory/products/${productId}`, {
        headers,
      }),
    );
    const drawers = await json<{
      balances: { generalDrawer: { usd: number } };
    }>(
      page.request.get(`${BACKEND_URL}/api/dashboard/drawer-balances`, {
        headers,
      }),
    );
    const modules = await json<{
      data: Array<{ module: string; profit_usd: number }>;
    }>(
      page.request.get(
        `${BACKEND_URL}/api/profits/by-module?from=${DAY}&to=${DAY}`,
        { headers },
      ),
    );
    return {
      stock: product.product.stock_quantity,
      generalUsd: drawers.balances.generalDrawer.usd,
      warrantyUsd:
        modules.data.find((m) => m.module === "WARRANTY")?.profit_usd ?? 0,
    };
  };

  const before = await snapshot();

  // ---- Browser: find the sale and start a Replace claim -----------------
  await gotoAndSettle(page, "/#/warranty");
  const box = page.getByPlaceholder(
    "Name, phone, receipt (RCP-…), product or serial",
  );
  await box.fill(RECEIPT);
  await box.press("Enter");
  const row = page.getByTestId("warranty-row").filter({ hasText: PRODUCT });
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: "Claim" }).click();
  const dialog = page.getByRole("dialog", { name: "Warranty claim" });
  await dialog.getByLabel("Replace").check();
  await dialog.getByLabel("Notes").fill("W048 dead left bud");
  await dialog.getByRole("button", { name: "Start claim" }).click();
  await expect(dialog).toBeHidden();
  const history = page.getByTestId("claim-history");
  await expect(history).toContainText("Replace");
  await expect(history).toContainText("W048 dead left bud");

  const during = await snapshot();
  expect(during.stock - before.stock).toBe(-1);
  expect(during.generalUsd - before.generalUsd).toBeCloseTo(0, 6);
  expect(during.warrantyUsd - before.warrantyUsd).toBeCloseTo(-6, 6);

  // ---- Void it from the history -----------------------------------------
  page.once("dialog", (d) => void d.accept());
  await history.getByRole("button", { name: "Void claim" }).click();
  await expect(history).toContainText("Voided");

  const after = await snapshot();
  expect(after.stock).toBe(before.stock);
  expect(after.generalUsd).toBeCloseTo(before.generalUsd, 6);
  expect(after.warrantyUsd).toBeCloseTo(before.warrantyUsd, 6);
});
