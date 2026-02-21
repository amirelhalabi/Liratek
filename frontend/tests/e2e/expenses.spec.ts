import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./_helpers";

test("expenses page loads and shows today expenses", async ({ page }) => {
  await loginAsAdmin(page);

  await page.goto("/#/expenses");

  await expect(page.getByRole("heading", { name: /expenses/i })).toBeVisible();

  // Should show the expenses table or form
  await expect(page.getByText(/category|amount/i)).toBeVisible();
});
