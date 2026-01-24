import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './_helpers';

test('clients page loads', async ({ page }) => {
  await loginAsAdmin(page);

  await page.goto('/#/clients');

  await expect(page.getByRole('heading', { name: /clients/i })).toBeVisible();
  await expect(page.getByPlaceholder(/search by name or phone/i)).toBeVisible();
});
