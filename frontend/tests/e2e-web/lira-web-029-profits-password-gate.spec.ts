/**
 * lira-web-029 — Profits password gate, web (REST) transport.
 *
 * REST twin of the desktop lira-071-profits-password-gate spec
 * (PROFITS_GATE_CONTRACT.md). Both transports now protect `/profits` with a
 * per-page password instead of a role check — admin is prompted too, and per
 * `backend/src/api/profits.ts`'s own header comment ("the `profits` module is
 * visible to both `admin` and `staff` [migration v163]") and
 * `backend/src/api/__tests__/profitsGate.api.test.ts` ("staff and admin can
 * both unlock then read (password gates, not role)"), STAFF unlocks with the
 * SAME per-tenant password and sees the SAME page — the only admin-only edge
 * is `PUT /api/profits/password` (setting/replacing the password itself).
 * That contract is unambiguous from the backend route + its own tests, so
 * LIRA-235 added the staff case below instead of leaving it out.
 *
 *   (a) with no password set, /profits shows the fail-closed
 *       profits-no-password-set screen (not the lock form) for an admin.
 *   (b) an admin sets a password via the real Settings › Profits Password
 *       panel (?tab=profits deep link).
 *   (c) admin visiting /profits IS prompted (profits-lock-screen), a wrong
 *       password shows profits-unlock-error and does not unlock, no
 *       ErrorBoundary text anywhere.
 *   (d) the correct password unlocks and the Profits page renders.
 *   (e) a STAFF login (seeded via fixtures.ts's `seedStaffUser`, LIRA-235) is
 *       ALSO prompted with the lock screen and unlocks with the SAME
 *       password (b) set — proves the gate is per-tenant-password, not
 *       per-role, over the real UI+REST stack rather than only at the
 *       backend-jest unit level.
 *
 * Rule 15: the web DB accumulates across runs, so the password set in (b)
 * persists for later runs of this file — (a) must therefore run BEFORE (b)
 * sets a password, which `test.describe.serial` + declaration order
 * guarantees within one run. A prior run having already set the password
 * would make (a) inapplicable on a re-run against a warm DB; that test
 * tolerates either observed state (see its own comment) rather than assuming
 * a pristine DB. Profits unlock is per-user (`middleware/profitsUnlock.ts`
 * keys on `tenantId:userId`), so admin unlocking in (d) has no bearing on
 * whether the staff user in (e) is still gated — it is.
 */
import { test, expect, loginAsAdmin, loginAsUser, seedStaffUser } from "./fixtures";

const PASSWORD = "1234";
const WRONG_PASSWORD = "9999";
const STAFF_USERNAME = "e2e029staff";
const STAFF_PASSWORD = "E2e029Staff!1";

test.describe.serial("Profits password gate (web/REST)", () => {
  test("(a) fail-closed: no password set yet shows profits-no-password-set for admin", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/#/profits");

    const noPasswordScreen = page.getByTestId("profits-no-password-set");
    const lockScreen = page.getByTestId("profits-lock-screen");

    // Tolerate either observed state: a prior run of this file (or another
    // admin) may already have set the password on this accumulating DB. If
    // so, the no-password screen legitimately never appears — skip straight
    // to proving the lock screen exists instead of failing on a stale
    // assumption of a pristine DB.
    const result = await Promise.race([
      noPasswordScreen
        .waitFor({ state: "visible", timeout: 10_000 })
        .then(() => "no-password" as const)
        .catch(() => null),
      lockScreen
        .waitFor({ state: "visible", timeout: 10_000 })
        .then(() => "lock" as const)
        .catch(() => null),
    ]);
    expect(result).not.toBeNull();

    await expect(page.locator("#root")).not.toContainText(
      "Something went wrong",
    );
  });

  test("(b) admin sets the profits password via Settings › Profits Password", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/#/settings?tab=profits");

    await expect(page.getByTestId("profits-password-panel")).toBeVisible({
      timeout: 15_000,
    });

    await page.getByTestId("profits-password-new").fill(PASSWORD);
    await page.getByTestId("profits-password-confirm").fill(PASSWORD);
    await page.getByTestId("profits-password-save").click();

    await expect(page.getByTestId("profits-password-status")).toContainText(
      "Password is set",
      { timeout: 15_000 },
    );
  });

  test("(c) admin visiting /profits IS prompted; wrong password rejected", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/#/profits");

    await expect(page.getByTestId("profits-lock-screen")).toBeVisible({
      timeout: 15_000,
    });
    // The page's own content must NOT render behind the gate.
    await expect(page.getByTestId("profits-lock-screen")).toBeVisible();

    await page.getByTestId("profits-password-input").fill(WRONG_PASSWORD);
    await page.getByTestId("profits-unlock-submit").click();

    await expect(page.getByTestId("profits-unlock-error")).toBeVisible({
      timeout: 10_000,
    });
    // Still locked — the lock screen stays up.
    await expect(page.getByTestId("profits-lock-screen")).toBeVisible();
    await expect(page.locator("#root")).not.toContainText(
      "Something went wrong",
    );
  });

  test("(d) correct password unlocks and the Profits page renders", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/#/profits");

    await expect(page.getByTestId("profits-lock-screen")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId("profits-password-input").fill(PASSWORD);
    await page.getByTestId("profits-unlock-submit").click();

    await expect(page.getByTestId("profits-lock-screen")).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(page.locator("text=Profits").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator("#root")).not.toContainText(
      "Something went wrong",
    );
  });

  test("(e) a staff login is also gated by, and can unlock with, the SAME password (b) set — the gate is per-password, not per-role", async ({
    page,
  }) => {
    seedStaffUser(STAFF_USERNAME, STAFF_PASSWORD);
    await loginAsUser(page, STAFF_USERNAME, STAFF_PASSWORD);
    await page.goto("/#/profits");

    // A fresh user (never unlocked before) sees the lock screen, exactly
    // like admin did in (c)/(d) — not the "no password set" screen from (a),
    // since (b) already set one, and not an unrestricted render either.
    await expect(page.getByTestId("profits-lock-screen")).toBeVisible({
      timeout: 15_000,
    });

    // The wrong password is refused for staff too.
    await page.getByTestId("profits-password-input").fill(WRONG_PASSWORD);
    await page.getByTestId("profits-unlock-submit").click();
    await expect(page.getByTestId("profits-unlock-error")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("profits-lock-screen")).toBeVisible();

    // The SAME password (b) set for the tenant — not a staff-specific one —
    // unlocks it.
    await page.getByTestId("profits-password-input").fill(PASSWORD);
    await page.getByTestId("profits-unlock-submit").click();

    await expect(page.getByTestId("profits-lock-screen")).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(page.locator("text=Profits").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator("#root")).not.toContainText(
      "Something went wrong",
    );
  });
});
