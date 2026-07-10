import { test as base, expect, type Page } from "@playwright/test";
import { BACKEND_PORT } from "../../playwright.web.config";

export const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;

/**
 * Web-mode test fixture: every page in the suite gets
 * `globalThis.__LIRATEK_BACKEND_URL` injected before app code runs, so the
 * frontend's httpClient talks to THIS suite's backend (port 3101) instead of
 * the default 127.0.0.1:3000 (which may be a dev backend or nothing at all).
 */
export const test = base.extend({
  context: async ({ context }, use) => {
    await context.addInitScript((url: string) => {
      (globalThis as { __LIRATEK_BACKEND_URL?: string }).__LIRATEK_BACKEND_URL =
        url;
    }, BACKEND_URL);
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Playwright fixture `use`, not a React hook
    await use(context);
  },
});

export { expect };

/** Log in through the real UI form and wait for the authenticated shell. */
export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/#/login");
  await page.fill('input[placeholder="Enter username"]', "admin");
  await page.fill('input[type="password"]', "admin123");
  await page.click('button[type="submit"]');
  // Successful login navigates away from #/login to the home route.
  await page.waitForURL((url) => !url.hash.includes("/login"), {
    timeout: 15_000,
  });
}
