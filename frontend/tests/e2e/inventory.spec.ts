import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./_helpers";

test("inventory page loads", async ({ page }) => {
  await loginAsAdmin(page);

  await page.goto("/#/products");

  await expect(
    page.getByRole("heading", { name: /inventory|products/i }),
  ).toBeVisible();
  await expect(page.getByPlaceholder(/search/i)).toBeVisible();
});
