import { test, expect } from "@playwright/test";

test("login shows dashboard", async ({ page }) => {
  await page.goto("/#/login");

  // The login form uses placeholders rather than <label>
  await page.getByPlaceholder(/username/i).fill("admin");
  await page.getByPlaceholder(/password/i).fill("");
  await page.getByRole("button", { name: /login/i }).click();

  // We should be redirected away from /login
  await expect(page).not.toHaveURL(/#\/login/);

  // Dashboard title should appear
  await expect(page.getByText(/dashboard/i)).toBeVisible();
});
