import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./_helpers";

test("POS page loads and shows product search", async ({ page }) => {
  await loginAsAdmin(page);

  await page.goto("/#/pos");

  await expect(
    page.getByRole("heading", { name: /point of sale|pos/i }),
  ).toBeVisible();
  await expect(page.getByPlaceholder(/search products/i)).toBeVisible();
});

test("POS can search for products", async ({ page }) => {
  await loginAsAdmin(page);

  await page.goto("/#/pos");

  const searchInput = page.getByPlaceholder(/search products/i);
  await searchInput.fill("test");

  // Wait for search results (should show empty or products list)
  await page.waitForTimeout(500);

  // Page should not crash
  await expect(searchInput).toBeVisible();
});
