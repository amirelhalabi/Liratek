/**
 * lira-web-049 — LIRA-296 P3: a faulty item sent back to its supplier, the
 * supplier's credit recorded, then the claim voided — over the WEB transport
 * (browser + REST, rule 19d).
 *
 * Setup over REST: a supplier, a product, a sale, and a REFUND warranty
 * claim (the faulty unit lands in Defective items).
 * In the browser (Warranty page, admin): Defective items → "Send to
 * supplier" (picking the supplier), then Supplier returns → "Record answer"
 * → Credited $4.
 * Over REST, deltas only (rule 15 — the web DB accumulates across runs):
 *   - the credit lowers that supplier's balance by $4 and moves NO drawer;
 *   - the Profits "Warranty cost" line goes up by $4, and the warranty
 *     report's "given back by suppliers" by $4;
 *   - voiding the claim brings the supplier balance and the Warranty cost
 *     line back to where they were before the claim (rule 20).
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
  // Other specs set other profits passwords on the shared DB; the admin may
  // always replace it, so set ours, then unlock with it.
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

test("a faulty item sent to its supplier and credited lowers the supplier balance and the warranty cost; voiding the claim nets both back", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const headers: Headers = { Authorization: `Bearer ${token as string}` };
  const ts = Date.now();
  const SUPPLIER = `W049 Supplier ${ts}`;
  const PRODUCT = `W049 Speaker ${ts}`;
  const DAY = localDay();

  const supplier = await json<{ id: number }>(
    page.request.post(`${BACKEND_URL}/api/suppliers`, {
      headers,
      data: { name: SUPPLIER },
    }),
  );
  const supplierId = supplier.id;

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
  const items = await json<{ items: Array<{ id: number }> }>(
    page.request.get(`${BACKEND_URL}/api/sales/${sale.id}/items`, { headers }),
  );
  const saleItemId = items.items[0]!.id;

  const snapshot = async () => {
    await ensureProfitsUnlocked(page, headers);
    const balances = await json<{
      balances: Array<{ supplier_id: number; total_usd: number }>;
    }>(page.request.get(`${BACKEND_URL}/api/suppliers/balances`, { headers }));
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
    const report = await json<{
      data: { claims: { supplierRecoveredUsd: number } };
    }>(
      page.request.get(
        `${BACKEND_URL}/api/warranty/report?from=${DAY}&to=${DAY}&client_day=${DAY}`,
        { headers },
      ),
    );
    return {
      supplierUsd:
        balances.balances.find((b) => b.supplier_id === supplierId)
          ?.total_usd ?? 0,
      generalUsd: drawers.balances.generalDrawer.usd,
      warrantyUsd:
        modules.data.find((m) => m.module === "WARRANTY")?.profit_usd ?? 0,
      recoveredUsd: report.data.claims.supplierRecoveredUsd,
    };
  };

  const beforeClaim = await snapshot();
  const claim = await json<{ data: { claim: { id: number } } }>(
    page.request.post(`${BACKEND_URL}/api/warranty/claims`, {
      headers,
      data: {
        sale_item_id: saleItemId,
        action: "REFUND",
        client_day: DAY,
        refund: { exchange_rate: 90000 },
      },
    }),
  );
  const claimId = claim.data.claim.id;

  // ---- Browser: send the faulty item to the supplier ---------------------
  await gotoAndSettle(page, "/#/warranty");
  await page.getByRole("tab", { name: "Defective items" }).click();
  const defectiveRow = page
    .getByTestId("defective-row")
    .filter({ hasText: PRODUCT });
  await expect(defectiveRow).toHaveCount(1);
  await defectiveRow.getByRole("button", { name: "Send to supplier" }).click();
  await page.getByLabel("Supplier").selectOption({ label: SUPPLIER });
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(defectiveRow).toContainText("Sent to supplier");

  const beforeCredit = await snapshot();

  // ---- Browser: record the supplier's credit ------------------------------
  await page.getByRole("tab", { name: "Supplier returns" }).click();
  const returnRow = page
    .getByTestId("supplier-return-row")
    .filter({ hasText: PRODUCT });
  await expect(returnRow).toHaveCount(1);
  await returnRow.getByRole("button", { name: "Record answer" }).click();
  await page.getByLabel("Credited").check();
  await page.getByLabel("Credit (USD)").fill("4");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(returnRow).toContainText("Credited");
  await expect(returnRow).toContainText("$4.00");

  const afterCredit = await snapshot();
  expect(afterCredit.supplierUsd - beforeCredit.supplierUsd).toBeCloseTo(-4, 6);
  expect(afterCredit.generalUsd).toBeCloseTo(beforeCredit.generalUsd, 6);
  expect(afterCredit.warrantyUsd - beforeCredit.warrantyUsd).toBeCloseTo(4, 6);
  expect(afterCredit.recoveredUsd - beforeCredit.recoveredUsd).toBeCloseTo(
    4,
    6,
  );

  // ---- Void the claim: everything back to before the claim ---------------
  await json(
    page.request.post(`${BACKEND_URL}/api/warranty/claims/${claimId}/void`, {
      headers,
    }),
  );
  const after = await snapshot();
  expect(after.supplierUsd).toBeCloseTo(beforeClaim.supplierUsd, 6);
  expect(after.warrantyUsd).toBeCloseTo(beforeClaim.warrantyUsd, 6);
  expect(after.recoveredUsd).toBeCloseTo(beforeClaim.recoveredUsd, 6);
});
