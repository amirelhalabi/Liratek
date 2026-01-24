import type { Page } from '@playwright/test';

export async function loginAsAdmin(page: Page) {
  await page.goto('/#/login');
  await page.getByPlaceholder(/username/i).fill('admin');
  await page.getByPlaceholder(/password/i).fill('');
  await page.getByRole('button', { name: /sign in|login/i }).click();
}
