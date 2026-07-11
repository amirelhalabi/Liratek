/**
 * E2E: Customer can have multiple sessions per day (Issue 2)
 *
 * The StartSessionModal used to block any customer name already used in ANY of
 * today's sessions (active OR closed), so a customer could not be re-served
 * after their first visit was closed. It now blocks only when an ACTIVE session
 * for that name exists:
 *   - sequential same-day sessions are allowed (reopen after closing);
 *   - two simultaneously-open sessions for one customer stay blocked (frontend
 *     guard + backend createSessionIfNotActive).
 *
 * Shared Electron instance / accumulating DB; unique per-test names keep this
 * independent of sessions created by other specs (CLAUDE.md rule 15).
 */

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

const DUP_WARNING = /already has an open session/i;

/** Open the StartSessionModal via the FAB → New Session UI. */
async function openStartSessionModal(page: Page) {
  // A prior spec (e.g. the Session Debt detail modal) can leave a modal open in
  // the shared app instance; its full-screen overlay would intercept the FAB
  // click. Dismiss any lingering modal first by clicking outside the centered
  // card (the detail modal closes on backdrop click).
  const overlay = page.locator("div.fixed.inset-0.z-50").first();
  if (await overlay.isVisible({ timeout: 750 }).catch(() => false)) {
    await page.mouse.click(8, 8);
    await overlay.waitFor({ state: "hidden", timeout: 3_000 }).catch(() => {});
  }

  const fab = page
    .locator(
      'button[title="Start Customer Session"], button[title*="active session"]',
    )
    .first();
  await fab.click({ timeout: 10_000 });

  const newSessionBtn = page.locator('button:has-text("New Session")').first();
  if (await newSessionBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await newSessionBtn.click();
  }
  await page.waitForSelector('h2:has-text("New Customer Session")', {
    timeout: 5_000,
  });
}

async function closeActiveSessionByName(page: Page, name: string) {
  await page.evaluate(async (nm: string) => {
    const r = await (window as any).api.session.getActiveSessions();
    const list = (r.sessions ?? r) as Array<{
      id: number;
      customer_name?: string;
    }>;
    const s = list.find((x) => x.customer_name === nm);
    if (s) await (window as any).api.session.close(s.id, "admin");
  }, name);
}

// Never leak an open session into later specs, even if a test fails mid-way.
test.afterEach(async ({ appPage }) => {
  await appPage
    .evaluate(async () => {
      const r = await (window as any).api.session.getActiveSessions();
      const list = (r.sessions ?? r) as Array<{ id: number }>;
      for (const s of list)
        await (window as any).api.session.close(s.id, "admin");
    })
    .catch(() => {});
});

test.describe("Customer sessions — multiple per day", () => {
  test("same customer can be reopened the same day after closing", async ({
    appPage,
  }) => {
    const name = `E2E Seq ${Date.now()}`;

    // First visit.
    await openStartSessionModal(appPage);
    await appPage.locator("#customer-name").fill(name);
    await expect(appPage.getByText(DUP_WARNING)).toHaveCount(0);
    await appPage.getByRole("button", { name: /Start Session/i }).click();
    await appPage.waitForSelector('h2:has-text("New Customer Session")', {
      state: "detached",
      timeout: 8_000,
    });

    // Close it.
    await closeActiveSessionByName(appPage, name);

    // Second visit, same name, same day — must be allowed now.
    await openStartSessionModal(appPage);
    await appPage.locator("#customer-name").fill(name);
    await expect(appPage.getByText(DUP_WARNING)).toHaveCount(0);
    const startBtn = appPage.getByRole("button", { name: /Start Session/i });
    await expect(startBtn).toBeEnabled();
    await startBtn.click();
    await appPage.waitForSelector('h2:has-text("New Customer Session")', {
      state: "detached",
      timeout: 8_000,
    });

    // Two sessions exist today for this customer (one closed, one active).
    const todayCount = await appPage.evaluate(async (nm: string) => {
      const r = await (window as any).api.session.getTodayAllSessions();
      const list = (r.sessions ?? r) as Array<{ customer_name?: string }>;
      return list.filter((s) => s.customer_name === nm).length;
    }, name);
    expect(todayCount).toBe(2);

    await closeActiveSessionByName(appPage, name);
  });

  test("a second simultaneously-open session for the same customer is blocked", async ({
    appPage,
  }) => {
    const name = `E2E Conc ${Date.now()}`;

    // Open a session and leave it active.
    await openStartSessionModal(appPage);
    await appPage.locator("#customer-name").fill(name);
    await appPage.getByRole("button", { name: /Start Session/i }).click();
    await appPage.waitForSelector('h2:has-text("New Customer Session")', {
      state: "detached",
      timeout: 8_000,
    });

    // Try to open another for the SAME name while the first is still open.
    await openStartSessionModal(appPage);
    await appPage.locator("#customer-name").fill(name);
    await expect(appPage.getByText(DUP_WARNING)).toBeVisible({
      timeout: 5_000,
    });
    await expect(
      appPage.getByRole("button", { name: /Start Session/i }),
    ).toBeDisabled();
    await appPage.getByRole("button", { name: /^Cancel$/i }).click();

    // Backend also rejects a duplicate active start.
    const res = await appPage.evaluate(async (nm: string) => {
      return (window as any).api.session.start({
        customer_name: nm,
        started_by: "admin",
      });
    }, name);
    expect(res.success).toBe(false);

    await closeActiveSessionByName(appPage, name);
  });
});
