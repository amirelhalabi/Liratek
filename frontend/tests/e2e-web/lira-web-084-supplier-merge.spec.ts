/**
 * lira-web-084 — merge a mistyped duplicate supplier into the real one
 * (LIRA-361). The owner's case: "reacall" and "recall" are the same
 * supplier, entered twice.
 *
 *  1. Over REST: two suppliers (unique names, rule 15 identity). The real
 *     one is owed $20 (a product with stock); the duplicate is owed $50
 *     (new stock) and has an old-stock product that booked no debt.
 *  2. Settings → Categories: delete the duplicate. Instead of deleting, the
 *     "Merge into…" window opens and shows 2 products and $50 moving.
 *     Pick the real supplier. Saves the What's new screenshot (rule 30).
 *  3. Merge. The duplicate is gone; the real supplier now owes $70 — the
 *     two balances added together (by identity, not row position).
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import {
  test,
  expect,
  loginAsAdmin,
  gotoAndSettle,
  BACKEND_URL,
} from "./fixtures";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT = path.join(
  __dirname,
  "../../public/whats-new/1.35.0/supplier-merge.png",
);

type Auth = { Authorization: string };

async function owed(
  page: Page,
  auth: Auth,
  supplierId: number,
): Promise<number | undefined> {
  const r = await (
    await page.request.get(`${BACKEND_URL}/api/suppliers/product-balances`, {
      headers: auth,
    })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return (
    r.balances as Array<{ supplier_id: number; total_usd: number }>
  ).find((b) => b.supplier_id === supplierId)?.total_usd;
}

test("lira-web-084 supplier merge: reacall folds into recall", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth: Auth = { Authorization: `Bearer ${token}` };
  const post = async (p: string, data: unknown) => {
    const body = await (
      await page.request.post(`${BACKEND_URL}${p}`, { headers: auth, data })
    ).json();
    expect(body.success, JSON.stringify(body)).toBeTruthy();
    return body;
  };

  // ── 1. Two suppliers, both owed money ───────────────────────────────────
  const tag = String(Date.now()).slice(-5);
  const real = `Aaa Recall ${tag}`;
  const dup = `Aaa Reacall ${tag}`;
  const target = await post("/api/inventory/product-suppliers", { name: real });
  const source = await post("/api/inventory/product-suppliers", { name: dup });
  const product = (
    name: string,
    supplier: string,
    stock: number,
    cost: number,
    isOld = false,
  ) =>
    post("/api/inventory/products", {
      name: `${name} ${tag}`,
      category: "Accessories",
      cost_price_usd: cost,
      retail_price_usd: cost * 2,
      stock,
      supplier,
      is_old_stock: isOld,
    });
  await product("Earbuds", real, 2, 10);
  await product("Cable", dup, 10, 5);
  await product("Old charger", dup, 4, 3, true);
  expect(await owed(page, auth, target.supplier_id)).toBeCloseTo(20, 2);
  expect(await owed(page, auth, source.supplier_id)).toBeCloseTo(50, 2);

  // ── 2. Delete the duplicate: the merge window opens instead ─────────────
  await gotoAndSettle(page, "/#/settings?tab=categories");
  const row = page.getByRole("row").filter({ hasText: dup });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByRole("button").last().click();

  const dialog = page.getByTestId("merge-supplier-dialog");
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(dialog).toContainText("2 products move");
  await expect(dialog.getByTestId("merge-supplier-debt")).toContainText("$50");
  await dialog
    .getByTestId("merge-supplier-target")
    .selectOption({ label: real });
  await expect(dialog).toContainText(`"${real}" will show everything`);
  mkdirSync(path.dirname(SCREENSHOT), { recursive: true });
  await page.screenshot({ path: SCREENSHOT });

  // ── 3. Merge: one supplier left, owing both balances ────────────────────
  await dialog.getByTestId("merge-supplier-confirm").click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expect(page.getByRole("row").filter({ hasText: dup })).toHaveCount(0);
  expect(await owed(page, auth, source.supplier_id)).toBeUndefined();
  expect(await owed(page, auth, target.supplier_id)).toBeCloseTo(70, 2);
});
