import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './_helpers';

test('debts page loads and shows debtors list', async ({ page }) => {
  await loginAsAdmin(page);

  await page.goto('/#/debts');

  await expect(page.getByRole('heading', { name: /debts|debtors/i })).toBeVisible();
  
  // Should show the debtors section
  await expect(page.getByText(/client/i)).toBeVisible();
});
