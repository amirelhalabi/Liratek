/**
 * E2E: LIRA-071 — Profits password gate (PROFITS_GATE_CONTRACT.md)
 *
 * Supersedes the old "admin-only" design this file used to guard. The
 * `profits` module is now visible to BOTH roles (migration v163 flips
 * admin_only to 0), and `/profits` is protected by a per-page PASSWORD
 * instead of a role check — admin is prompted too. A correct password
 * unlocks the page AND the profit data endpoints for
 * `PROFITS_UNLOCK_TTL_MS` (15 minutes); navigating away from `/profits`
 * revokes the unlock immediately (ProfitsPasswordGate's unmount effect calls
 * `profits:lock`). If no password has been set yet, NOBODY enters — not
 * even admin — until an admin sets one in Settings › Profits Password.
 *
 * Coverage (the shared Electron instance logs in as ADMIN — see
 * completeSetup in fixtures.ts):
 *   1. No password set yet: /profits shows profits-no-password-set (fail
 *      closed), and a direct `profits:summary` IPC call is rejected — locked,
 *      not admin-gated (the rejection reason has changed; the outcome, a
 *      rejected call, is the same shape the old spec asserted).
 *   2. Admin sets a password via the REAL Settings › Profits Password panel
 *      (?tab=profits deep link).
 *   3. Admin visiting /profits IS prompted (profits-lock-screen visible,
 *      Profits content NOT rendered) — the headline behaviour change from
 *      the old admin-bypass design. A wrong password shows
 *      profits-unlock-error and does not unlock.
 *   4. The correct password unlocks and the Profits page renders.
 *   5. Navigating away and back RE-PROMPTS (explicit owner requirement —
 *      the unlock lives in component state only, never a context or
 *      storage).
 *   6. Staff: the "Profits" nav item IS now present (was absent under the
 *      old design), /profits is reachable, the SAME password unlocks it,
 *      and `profits:summary` succeeds only AFTER unlocking.
 *   7. Staff CANNOT set the password — `profits:set-password` stays
 *      admin-only.
 *   8. The admin session + the profits unlock state are restored at the end
 *      so sibling specs are unaffected (this spec's own steps re-lock as
 *      part of the flow, so no extra teardown is needed for the unlock
 *      itself).
 *
 * Drives the REAL lock-screen form (fill profits-password-input, click
 * profits-unlock-submit) for both the admin and staff unlocks — a spec that
 * only hand-builds IPC payloads would miss a frontend<->backend mismatch in
 * the gate itself, which is exactly the failure mode CLAUDE.md's
 * layer-seam-testing lesson warns about.
 *
 * NOTE: do not run as part of ad-hoc local edits — the orchestrator runs the
 * consolidated suite.
 */

import { test, expect, navigateTo, E2E_PROFITS_PASSWORD } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

const STAFF_USERNAME = "lira071_staff";
const STAFF_PASSWORD = "StaffPass1!";
// Shared with fixtures.ts's ensureProfitsUnlocked() — this spec is the one
// that actually SETS the password on the shared DB, so later specs' unlock
// (which never sets a password of its own once one exists) must use the
// SAME value or their unlock IPC call fails against the real stored password.
const PROFITS_PASSWORD = E2E_PROFITS_PASSWORD;
const WRONG_PROFITS_PASSWORD = "0000";

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
    passwordStatus: () => Promise<{ isSet: boolean }>;
    setPassword: (
      password: string,
    ) => Promise<{ success: boolean; error?: string }>;
    unlock: (password: string) => Promise<{ success: boolean; error?: string }>;
    lock: () => Promise<{ success: boolean }>;
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

test.describe("LIRA-071 — Profits password gate", () => {
  test("no password set → fail closed; admin sets one; admin + staff both gated and unlockable; staff cannot set it", async ({
    appPage,
  }) => {
    // Capture the admin session token up front so we can restore it at the end.
    const adminToken = await appPage.evaluate(
      () => localStorage.getItem("sessionToken") ?? "",
    );
    expect(adminToken).not.toBe("");

    const today = new Date().toISOString().slice(0, 10);

    // ── 1. No password set yet: fail-closed screen + IPC rejected ───────────
    const initialStatus = await appPage.evaluate(async () => {
      const api = (window as unknown as { api: AuthApi }).api;
      return api.profits.passwordStatus();
    });
    // This spec is the one that sets the password (step 2 below); on a fresh
    // worker DB it hasn't been set yet. Tolerate an already-set password only
    // in the (unexpected) case of a re-run against a warm DB — either way the
    // rest of this test proceeds by first ensuring a KNOWN password is set.
    if (!initialStatus.isSet) {
      await navigateTo(appPage, "/profits");
      await expect(
        appPage.getByTestId("profits-no-password-set"),
      ).toBeVisible({ timeout: 10_000 });
      // Profits content must not render behind the fail-closed screen.
      await expect(appPage.getByTestId("profits-lock-screen")).toHaveCount(0);

      const summaryRejected = await appPage.evaluate(async (to) => {
        const api = (window as unknown as { api: AuthApi }).api;
        try {
          await api.profits.summary(to, to);
          return false; // resolved → NOT rejected
        } catch {
          return true; // threw → rejected as expected (locked)
        }
      }, today);
      expect(summaryRejected).toBe(true);
    }

    // ── 2. Admin sets the password via the REAL Settings panel ─────────────
    await navigateTo(appPage, "/settings?tab=profits");
    await expect(appPage.getByTestId("profits-password-panel")).toBeVisible({
      timeout: 10_000,
    });
    await appPage.getByTestId("profits-password-new").fill(PROFITS_PASSWORD);
    // Best-effort: confirm field may or may not exist under this exact
    // testid depending on the panel's own markup; fill it if present.
    const confirmInput = appPage.locator(
      '[data-testid="profits-password-confirm"]',
    );
    if ((await confirmInput.count()) > 0) {
      await confirmInput.fill(PROFITS_PASSWORD);
    }
    await appPage.getByTestId("profits-password-save").click();
    await expect(appPage.getByTestId("profits-password-status")).toContainText(
      "Password is set",
      { timeout: 10_000 },
    );

    // ── 3. Admin visiting /profits IS prompted; wrong password rejected ────
    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/profits");
    await expect(appPage.getByTestId("profits-lock-screen")).toBeVisible({
      timeout: 10_000,
    });

    await appPage
      .getByTestId("profits-password-input")
      .fill(WRONG_PROFITS_PASSWORD);
    await appPage.getByTestId("profits-unlock-submit").click();
    await expect(appPage.getByTestId("profits-unlock-error")).toBeVisible({
      timeout: 10_000,
    });
    await expect(appPage.getByTestId("profits-lock-screen")).toBeVisible();

    // ── 4. Correct password unlocks and the page renders ────────────────────
    await appPage.getByTestId("profits-password-input").fill(PROFITS_PASSWORD);
    await appPage.getByTestId("profits-unlock-submit").click();
    await expect(appPage.getByTestId("profits-lock-screen")).toHaveCount(0, {
      timeout: 10_000,
    });
    await expect(appPage.locator("text=Profits").first()).toBeVisible({
      timeout: 10_000,
    });
    expect(appPage.url()).toContain("/profits");

    // ── 5. Navigating away and back RE-PROMPTS ──────────────────────────────
    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/profits");
    await expect(appPage.getByTestId("profits-lock-screen")).toBeVisible({
      timeout: 10_000,
    });

    // Leave it unlocked-clean for the staff phase below rather than stuck on
    // the lock screen; also proves the SAME password unlocks for admin again.
    await appPage.getByTestId("profits-password-input").fill(PROFITS_PASSWORD);
    await appPage.getByTestId("profits-unlock-submit").click();
    await expect(appPage.getByTestId("profits-lock-screen")).toHaveCount(0, {
      timeout: 10_000,
    });
    // Re-lock explicitly (navigate away) so the staff phase starts from a
    // clean, locked state rather than relying on unlock TTL/timing.
    await navigateTo(appPage, "/");

    // ── 6. STAFF: nav item now present, page reachable, gated + unlockable ──
    const staffToken = await createAndLoginStaff(appPage);
    await reloadAs(appPage, staffToken);

    try {
      // Nav item is now present for staff (module is no longer admin_only).
      await expect(appPage.locator('nav a[href="#/profits"]')).toBeVisible({
        timeout: 10_000,
      });

      await navigateTo(appPage, "/profits");
      await expect(appPage.getByTestId("profits-lock-screen")).toBeVisible({
        timeout: 10_000,
      });

      // profits:summary must fail while locked, even for staff (not an
      // admin-only rejection anymore — a lock rejection).
      const staffLockedRejected = await appPage.evaluate(async (to) => {
        const api = (window as unknown as { api: AuthApi }).api;
        try {
          await api.profits.summary(to, to);
          return false;
        } catch {
          return true;
        }
      }, today);
      expect(staffLockedRejected).toBe(true);

      // Staff cannot set the password — set-password stays admin-only.
      const staffSetPasswordRejected = await appPage.evaluate(async (pw) => {
        const api = (window as unknown as { api: AuthApi }).api;
        const res = await api.profits.setPassword(pw);
        return res.success === false;
      }, "9999");
      expect(staffSetPasswordRejected).toBe(true);

      // The same password unlocks it for staff too, via the real form.
      await appPage
        .getByTestId("profits-password-input")
        .fill(PROFITS_PASSWORD);
      await appPage.getByTestId("profits-unlock-submit").click();
      await expect(appPage.getByTestId("profits-lock-screen")).toHaveCount(0, {
        timeout: 10_000,
      });
      await expect(appPage.locator("text=Profits").first()).toBeVisible({
        timeout: 10_000,
      });

      // profits:summary now succeeds (staff, unlocked).
      const staffUnlockedResult = await appPage.evaluate(async (to) => {
        const api = (window as unknown as { api: AuthApi }).api;
        try {
          await api.profits.summary(to, to);
          return true;
        } catch {
          return false;
        }
      }, today);
      expect(staffUnlockedResult).toBe(true);
    } finally {
      // ── 7. Restore the admin session for the shared instance ──────────────
      await reloadAs(appPage, adminToken);
      await expect(appPage.locator('nav a[href="#/profits"]')).toBeVisible({
        timeout: 10_000,
      });
    }
  });
});
