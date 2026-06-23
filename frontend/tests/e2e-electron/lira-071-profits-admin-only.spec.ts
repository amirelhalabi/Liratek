/**
 * E2E: LIRA-071 — Hide Profits page + profit data from non-admin roles
 *
 * Validates the route guard + nav gating added for the Profits module:
 *   - The `/profits` route is wrapped in <AdminRoute> in App.tsx, which reuses
 *     the same admin check as the rest of the app (useAuth().user?.role).
 *   - The `profits` module row carries admin_only = 1, so the Sidebar /
 *     HomeGrid nav builders already drop it for non-admins.
 *   - The profit IPC handlers are role-checked with requireRole(["admin"])
 *     (defense in depth).
 *
 * Coverage strategy (the shared Electron instance logs in as ADMIN — see
 * completeSetup in fixtures.ts):
 *   1. ADMIN can reach /profits (page renders) and the "Profits" sidebar item
 *      is present.
 *   2. A staff (non-admin) user is created + logged in via IPC, the renderer
 *      session is swapped to that user and reloaded, then:
 *        - the "Profits" sidebar item is absent
 *        - navigating to /profits redirects home (the page never renders)
 *        - the profit IPC handler rejects the staff session (admin-only).
 *   3. The admin session is restored and the page reloaded so the shared
 *      instance is left exactly as the fixture set it up (sibling specs rely
 *      on the admin session).
 *
 * Uses the shared Electron instance / fresh DB (same as the other specs).
 * NOTE: do not run as part of ad-hoc local edits — the orchestrator runs the
 * consolidated suite.
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

const STAFF_USERNAME = "lira071_staff";
const STAFF_PASSWORD = "StaffPass1!";

// Minimal typed view of the window.api surface this spec touches, so we never
// reach for `any` inside page.evaluate callbacks.
type AuthApi = {
  auth: {
    createUser: (
      username: string,
      password: string,
      role: "admin" | "staff",
    ) => Promise<{ success: boolean; id?: number; error?: string }>;
    login: (
      username: string,
      password: string,
      rememberMe?: boolean,
    ) => Promise<{
      success: boolean;
      user?: { id: number; username: string; role: string };
      sessionToken?: string | null;
      error?: string;
    }>;
  };
  profits: {
    summary: (from: string, to: string) => Promise<unknown>;
  };
};

/** Create a staff user (idempotent) and log them in; returns their session token. */
async function createAndLoginStaff(page: Page): Promise<string> {
  return page.evaluate(
    async ({ username, password }) => {
      const api = (window as unknown as { api: AuthApi }).api;
      // createUser is admin-only; the shared session is admin, so this is allowed.
      // Ignore "already exists" so the spec is safe on a warm DB / re-run.
      await api.auth.createUser(username, password, "staff").catch(() => ({
        success: false,
      }));
      const res = await api.auth.login(username, password, false);
      if (!res.success || !res.sessionToken) {
        throw new Error(
          `staff login failed: ${res.error ?? "no session token"}`,
        );
      }
      return res.sessionToken;
    },
    { username: STAFF_USERNAME, password: STAFF_PASSWORD },
  );
}

/** Swap the persisted session token and reload so AuthContext restores it. */
async function reloadAs(page: Page, sessionToken: string): Promise<void> {
  await page.evaluate((token) => {
    localStorage.setItem("sessionToken", token);
  }, sessionToken);
  await page.reload();
  await page.waitForLoadState("load");
  // Wait until the app shell (sidebar nav) is mounted again.
  await page.waitForSelector("nav a[href]", { timeout: 15_000 });
}

test.describe("LIRA-071 — Profits page + data is admin-only", () => {
  test("admin reaches /profits and sees the nav item; staff is blocked", async ({
    appPage,
  }) => {
    // Capture the admin session token up front so we can restore it at the end.
    const adminToken = await appPage.evaluate(
      () => localStorage.getItem("sessionToken") ?? "",
    );
    expect(adminToken).not.toBe("");

    // ── 1. ADMIN: nav item present + page reachable ─────────────────────────
    const profitsNav = appPage.locator('nav a[href="#/profits"]');
    await expect(profitsNav).toBeVisible({ timeout: 10_000 });

    await navigateTo(appPage, "/profits");
    // Profits page renders its PageHeader title — the page is reachable.
    await expect(appPage.locator("text=Profits").first()).toBeVisible({
      timeout: 10_000,
    });
    // We did NOT get bounced back to the home grid / dashboard.
    expect(appPage.url()).toContain("/profits");

    // ── 2. STAFF: create + log in, swap session, reload ─────────────────────
    const staffToken = await createAndLoginStaff(appPage);
    await reloadAs(appPage, staffToken);

    try {
      // Nav item must be gone for staff (admin_only module filtered out).
      await expect(appPage.locator('nav a[href="#/profits"]')).toHaveCount(0, {
        timeout: 10_000,
      });

      // Direct navigation must be blocked — AdminRoute redirects to "/".
      await appPage.evaluate(() => {
        window.location.hash = "#/profits";
      });
      // Give the router a beat to process the redirect, then assert we are not
      // on /profits (we should have been bounced to home).
      await expect
        .poll(() => appPage.url().includes("/profits"), { timeout: 8_000 })
        .toBe(false);

      // Backend defense-in-depth: profit IPC must reject a non-admin caller.
      const today = new Date().toISOString().slice(0, 10);
      const profitDenied = await appPage.evaluate(async (to) => {
        const api = (window as unknown as { api: AuthApi }).api;
        try {
          await api.profits.summary(to, to);
          return false; // resolved → NOT denied (handler would have thrown)
        } catch {
          return true; // threw "Admin access required" → denied as expected
        }
      }, today);
      expect(profitDenied).toBe(true);
    } finally {
      // ── 3. Restore the admin session for the shared instance ──────────────
      await reloadAs(appPage, adminToken);
      await expect(appPage.locator('nav a[href="#/profits"]')).toBeVisible({
        timeout: 10_000,
      });
    }
  });
});
