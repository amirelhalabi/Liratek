import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./_helpers";

test("exchange page loads and shows currency inputs", async ({ page }) => {
  await loginAsAdmin(page);

  await page.goto("/#/exchange");

  await expect(
    page.getByRole("heading", { name: /exchange|currency/i }),
  ).toBeVisible();

  // Should show amount inputs
  await expect(page.getByPlaceholder(/amount/i).first()).toBeVisible();
});

test("exchange shows transaction history", async ({ page }) => {
  await loginAsAdmin(page);

  await page.goto("/#/exchange");

  // History section should be visible
  await expect(page.getByText(/history|transactions/i)).toBeVisible();
});
