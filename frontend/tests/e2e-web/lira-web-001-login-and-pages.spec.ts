/**
 * lira-web-001 — browser-mode boot path.
 *
 * Guards the web milestone established 2026-07-10: UI login over HTTP+JWT
 * works, and the pages known to be web-clean render without tripping the
 * app ErrorBoundary. Pages still broken in web mode are tracked in
 * docs/plans/WEBAPP_MULTI_TENANT_PLAN.md (Appendix A) — add them here as
 * they get fixed.
 */
import { test, expect, loginAsAdmin } from "./fixtures";

// Routes verified clean in web mode (2026-07-10 smoke run + broken-page
// fixes + loto REST routes). All 20 routes covered.
const CLEAN_ROUTES = [
  "/",
  "/pos",
  "/products",
  "/clients",
  "/debts",
  "/exchange",
  "/services",
  "/recharge",
  "/loto",
  "/expenses",
  "/maintenance",
  "/custom-services",
  "/vouchers",
  "/suppliers",
  "/partners",
  "/customer-sessions",
  "/profits",
  "/settings",
  "/audit",
  "/checkpoint-timeline",
];

test.describe.serial("web boot path", () => {
  test("rejects a bad password", async ({ page }) => {
    await page.goto("/#/login");
    await page.fill('input[placeholder="Enter username"]', "admin");
    await page.fill('input[type="password"]', "wrong-password");
    await page.click('button[type="submit"]');
    // Stays on the login route and shows an error message.
    await expect(page).toHaveURL(/#\/login/);
    await expect(page.locator("form")).toContainText(/invalid|failed|error/i, {
      timeout: 10_000,
    });
  });

  test("logs in via the UI and stores a JWT", async ({ page }) => {
    await loginAsAdmin(page);
    const jwt = await page.evaluate(() =>
      localStorage.getItem("liratek.jwt"),
    );
    expect(jwt, "JWT must be persisted for web-mode session restore").toBeTruthy();
    await expect(page.locator("#root")).not.toContainText(
      "Something went wrong",
    );
  });

  test("auth survives a full page reload (JWT + /api/auth/me restore)", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.reload();
    // Must NOT bounce back to the login form.
    await expect(page.locator('input[type="password"]')).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(page.locator("#root")).not.toContainText(
      "Something went wrong",
    );
  });

  test("known-good pages render without crashing", async ({ page }) => {
    await loginAsAdmin(page);
    for (const route of CLEAN_ROUTES) {
      await page.goto(`/#${route}`);
      await page.waitForTimeout(1_500); // let data effects settle
      const root = page.locator("#root");
      await expect(
        root,
        `${route} tripped the ErrorBoundary`,
      ).not.toContainText("Something went wrong");
      await expect(
        page.locator('input[type="password"]'),
        `${route} bounced to login`,
      ).toHaveCount(0);
    }
  });
});
