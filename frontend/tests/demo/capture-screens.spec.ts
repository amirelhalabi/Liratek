/**
 * Captures the real app screens used by the launch video
 * (tools/launch-video/, see its README). Writes 1920x1080 PNGs to
 * tools/launch-video/shots/.
 *
 * Runs against the demo database (playwright.demo.config.ts): rebuilt from
 * scratch each run and seeded here with invented products only, because the
 * video is public. Self-contained on purpose — it must not depend on
 * record-demo.spec.ts having run first.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { test, expect, gotoAndSettle, loginAsAdmin } from "../e2e-web/fixtures";

const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "tools",
  "launch-video",
  "shots",
);

const PRODUCTS = [
  { name: "USB-C Charger 20W", cost: "4", price: "9", stock: "40" },
  { name: "Clear Phone Case", cost: "1.5", price: "5", stock: "80" },
  { name: "Wireless Earbuds", cost: "9", price: "19", stock: "25" },
];

// 1280x720 at 1.5x = 1920x1080 screenshots, sharp enough to zoom into.
test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });

async function show(page: Page, route: string): Promise<void> {
  await gotoAndSettle(page, route);
  await expect(page.locator("text=Loading experience")).toHaveCount(0, {
    timeout: 20_000,
  });
  // Let numbers and animations settle before the screenshot.
  await page.waitForTimeout(800);
}

test("capture launch-video screens", async ({ page }) => {
  test.setTimeout(240_000);
  await loginAsAdmin(page);

  for (const p of PRODUCTS) {
    await gotoAndSettle(page, "/#/products");
    await page.locator("button").filter({ hasText: "Add Product" }).click();
    await page.locator("#product-name").fill(p.name);
    await page.locator("#product-cost-price").fill(p.cost);
    await page.locator("#product-retail-price").fill(p.price);
    await page.locator("#product-stock").fill(p.stock);
    await page.getByRole("button", { name: /Save Product/i }).click();
    await expect(page.locator(`text=${p.name}`).first()).toBeVisible({
      timeout: 10_000,
    });
  }

  // Checkout with three items: $33.00 ≈ 2,970,000 LBP.
  await show(page, "/#/pos");
  const search = page.getByPlaceholder("Search products by name or barcode...");
  for (const [query, name] of [
    ["charger", "USB-C Charger 20W"],
    ["earbuds", "Wireless Earbuds"],
    ["case", "Clear Phone Case"],
  ]) {
    await search.fill(query);
    await page.locator(`text=${name}`).first().click();
  }
  await search.fill("");
  await page.getByRole("button", { name: /Proceed to Checkout/i }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, "checkout.png") });
  await page.getByRole("button", { name: /Complete Sale/i }).click();
  await expect(page.locator("text=Cart is empty")).toBeVisible({
    timeout: 10_000,
  });

  // OMT send of $150: the form works out the $2.00 fee.
  await show(page, "/#/omt-whish");
  await page
    .locator("button")
    .filter({ hasText: /OMT/ })
    .filter({ hasText: /↑/ })
    .first()
    .click();
  await page.locator("#service-amount").fill("150");
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, "omt.png") });
  await page.getByRole("button", { name: /Record Send/i }).click();
  await expect(page.locator("#service-amount")).toHaveValue("", {
    timeout: 10_000,
  });

  // Dashboard after the sale and the transfer: drawers are non-zero.
  await show(page, "/#/");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, "dashboard.png") });
});
