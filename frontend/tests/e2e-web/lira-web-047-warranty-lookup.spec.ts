/**
 * lira-web-047 — LIRA-296 P1: find a warranty without an IMEI, over the WEB
 * transport (REST + browser, rule 19d).
 *
 * Story: a category has a 1-month default warranty; an accessory with no
 * warranty of its own is sold to a named client. Then, in the browser:
 *   - the Warranty page finds it by the client's phone and by `RCP-<id>`,
 *     "Covered", ending one month after the shop's sale day;
 *   - opening the sale shows "Covered until <date>" on the line;
 *   - the reprinted receipt carries the shop's warranty terms, the saved
 *     receipt header and the one receipt number `RCP-<id>`.
 *
 * Rule 15: the web DB accumulates across runs and specs — every name, phone
 * and category is `Date.now()`-unique and matched by identity, never by row
 * position. The category is a fresh one (not the shared "Accessories") so
 * its default cannot leak into other specs' sales.
 *
 * Note: the two shop settings this spec writes (warranty terms, receipt
 * header) are shop-wide and stay set in the shared web DB; no other spec
 * asserts on receipt text that would change because of them.
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

async function adminHeaders(page: Page): Promise<Headers> {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  expect(token).toBeTruthy();
  return { Authorization: `Bearer ${token as string}` };
}

async function ok<T = Record<string, unknown>>(
  res: Promise<{ json: () => Promise<unknown> }>,
): Promise<T> {
  const body = (await (await res).json()) as { success?: boolean };
  expect(body.success, JSON.stringify(body)).toBeTruthy();
  return body as T;
}

const pad = (n: number) => String(n).padStart(2, "0");
const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Same calendar rule as core's addMonthsIso (end-of-month clamps). */
function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const total = m - 1 + months;
  const ty = y + Math.floor(total / 12);
  const tm = (((total % 12) + 12) % 12) + 1;
  const last = new Date(ty, tm, 0).getDate();
  return `${ty}-${pad(tm)}-${pad(Math.min(d, last))}`;
}

test.describe("LIRA-296 — warranty lookup over REST + browser", () => {
  test("a category-default warranty is found by phone and by receipt number, shows on the sale, and prints its terms", async ({
    page,
  }) => {
    const headers = await adminHeaders(page);
    const ts = Date.now();
    const CATEGORY = `W047 Acc ${ts}`;
    const PRODUCT = `W047 Charger ${ts}`;
    const CLIENT = `W047 Client ${ts}`;
    const PHONE = `71${String(ts).slice(-6)}`;
    const TERMS = `W047 terms ${ts}: manufacturing faults only.`;
    const HEADER = `W047 header ${ts}`;
    const DAY = localDay();
    const UNTIL = addMonths(DAY, 1);

    // Shop settings (shop-wide; read once per page load by the app).
    await ok(
      page.request.put(`${BACKEND_URL}/api/settings/warranty_terms_text`, {
        headers,
        data: { value: TERMS },
      }),
    );
    await ok(
      page.request.put(`${BACKEND_URL}/api/settings/receipt_header_text`, {
        headers,
        data: { value: HEADER },
      }),
    );

    // A fresh category with a 1-month default warranty.
    const cat = await ok<{ id: number }>(
      page.request.post(`${BACKEND_URL}/api/inventory/categories`, {
        headers,
        data: { name: CATEGORY },
      }),
    );
    expect(cat.id).toBeTruthy();
    await ok(
      page.request.put(`${BACKEND_URL}/api/inventory/categories/${cat.id}`, {
        headers,
        data: { warranty_months: 1 },
      }),
    );
    const full = await ok<{
      data: Array<{ id: number; warranty_months: number | null }>;
    }>(
      page.request.get(`${BACKEND_URL}/api/inventory/categories-full`, {
        headers,
      }),
    );
    expect(full.data.find((c) => c.id === cat.id)?.warranty_months).toBe(1);

    // A named client and an accessory with NO warranty of its own.
    const client = await ok<{ id?: number; data?: { id: number } }>(
      page.request.post(`${BACKEND_URL}/api/clients`, {
        headers,
        data: { full_name: CLIENT, phone_number: PHONE },
      }),
    );
    const clientId = (client.data?.id ?? client.id) as number;
    expect(clientId).toBeTruthy();
    const product = await ok<{ id?: number; data?: { id: number } }>(
      page.request.post(`${BACKEND_URL}/api/inventory/products`, {
        headers,
        data: {
          name: PRODUCT,
          category: CATEGORY,
          cost_price_usd: 2,
          retail_price_usd: 5,
          stock: 5,
          min_stock_threshold: 0,
        },
      }),
    );
    const productId = (product.data?.id ?? product.id) as number;
    expect(productId).toBeTruthy();

    // The sale (shared saleProcessSchema; client_day = the shop's day).
    const sale = await ok<{ id: number }>(
      page.request.post(`${BACKEND_URL}/api/sales/process`, {
        headers,
        data: {
          client_id: clientId,
          items: [{ product_id: productId, quantity: 1, price: 5 }],
          total_amount: 5,
          discount: 0,
          final_amount: 5,
          payment_usd: 5,
          payment_lbp: 0,
          payments: [
            { method: "CASH", currency_code: "USD", amount: 5, direction: "IN" },
          ],
          change_given_usd: 0,
          change_given_lbp: 0,
          exchange_rate: 90000,
          client_day: DAY,
        },
      }),
    );
    const RECEIPT = `RCP-${sale.id}`;

    // The REST search finds it, stamped from the category default.
    const found = await ok<{
      data: Array<{
        saleId: number;
        warrantyUntil: string;
        warrantyMonths: number;
        state: string;
      }>;
    }>(
      page.request.get(
        `${BACKEND_URL}/api/warranty/search?q=${encodeURIComponent(RECEIPT)}&client_day=${DAY}`,
        { headers },
      ),
    );
    expect(found.data.find((r) => r.saleId === sale.id)).toMatchObject({
      warrantyUntil: UNTIL,
      warrantyMonths: 1,
      state: "COVERED",
    });

    // ---- The browser: the Warranty page ---------------------------------
    await gotoAndSettle(page, "/#/warranty");
    await page.reload(); // re-read the shop settings written above
    await expect(page.getByRole("heading", { name: "Warranty" })).toBeVisible();
    const box = page.getByPlaceholder(
      "Name, phone, receipt (RCP-…), product or serial",
    );

    // By phone.
    await box.fill(PHONE);
    await box.press("Enter");
    const byPhone = page.getByTestId("warranty-row").filter({ hasText: PRODUCT });
    await expect(byPhone).toHaveCount(1);
    await expect(byPhone).toContainText(CLIENT);
    await expect(byPhone).toContainText(RECEIPT);
    await expect(byPhone).toContainText(UNTIL);
    await expect(byPhone).toContainText("Covered");
    await expect(byPhone).toContainText("1 of 1");

    // By receipt number.
    await box.fill(RECEIPT);
    await box.press("Enter");
    const byReceipt = page
      .getByTestId("warranty-row")
      .filter({ hasText: PRODUCT });
    await expect(byReceipt).toHaveCount(1);

    // Open the sale: the line shows its warranty state.
    await byReceipt.click();
    await expect(
      page.getByTestId("sale-line-warranty").filter({
        hasText: `Covered until ${UNTIL}`,
      }),
    ).toBeVisible();

    // Reprint: capture the receipt instead of printing it.
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__LIRATEK_E2E_PRINT_STUB__ =
        (html: string) => {
          (window as unknown as Record<string, unknown>).__w047Printed = html;
        };
    });
    await page.getByRole("button", { name: "Print" }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as Record<string, unknown>).__w047Printed ?? "",
        ),
      )
      .toContain(RECEIPT);
    const printed = String(
      await page.evaluate(
        () => (window as unknown as Record<string, unknown>).__w047Printed,
      ),
    ).replace(/\s+/g, " ");
    expect(printed).toContain(TERMS);
    expect(printed).toContain(HEADER);
    expect(printed).toContain(`Warranty until: ${UNTIL}`);
  });
});
