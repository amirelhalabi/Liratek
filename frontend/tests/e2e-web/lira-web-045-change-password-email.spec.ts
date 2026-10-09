/**
 * lira-web-045 — LIRA-293: change your own password and your own email on
 * My account, through the REAL server and the real web app.
 *
 *   1. A staff member who HAS a password changes it with the current one.
 *      Their OTHER session (a second REST login) is signed out; this browser
 *      stays signed in; a fresh browser signs in with the NEW password.
 *   2. Profile → Change email: the page says "check your inbox", the email
 *      on the account does NOT change yet, the confirmation link goes to the
 *      NEW address and the OLD confirmed address gets the notice.
 *
 * Shared accumulating DB (rule 15): every user is seeded fresh with a
 * `Date.now()`-unique name, and never a shared login — revoking "other
 * sessions" of a shared user would sign out other specs.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import {
  test,
  expect,
  loginAsUser,
  closeAutoCheckpoint,
  seedStaffUser,
  staffHeaders,
  BACKEND_URL,
} from "./fixtures";
import { WEB_PORT } from "../../playwright.web.config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(
  __dirname,
  "..",
  "..",
  "test-results",
  "e2e-web",
  "phone_shop.web.db",
);

function withDb<T>(fn: (db: Database.Database) => T): T {
  const db = new Database(DB_PATH);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

const outboxTemplatesTo = (to: string): string[] =>
  withDb((db) =>
    (
      db
        .prepare(
          `SELECT template FROM email_outbox WHERE to_email = ? ORDER BY id`,
        )
        .all(to) as { template: string }[]
    ).map((r) => r.template),
  );

async function openMyAccount(page: import("@playwright/test").Page) {
  await closeAutoCheckpoint(page);
  await page.getByTestId("my-account-link").click();
  await page.waitForURL((url) => url.hash.startsWith("#/account"), {
    timeout: 15_000,
  });
  await expect(page.getByRole("heading", { name: "My account" })).toBeVisible({
    timeout: 15_000,
  });
}

test.describe("LIRA-293 — change your own password and email", () => {
  test("a staff member changes their password: other sessions end, this one stays, the new password signs in", async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const username = `l293_pw_${ts}`;
    const oldPassword = "L293Old!pw1";
    const newPassword = "xY7-pq_Rt.9mZ";
    seedStaffUser(username, oldPassword);

    // Another device: a second session for the same user.
    const otherDevice = await staffHeaders(page, username, oldPassword);

    await loginAsUser(page, username, oldPassword);
    await openMyAccount(page);
    // Redesigned panel (96d1ff86): "Sign-in options" → Password row opens the
    // form on demand.
    const signin = page.getByRole("region", { name: "Sign-in options" });
    await signin
      .getByRole("button", { name: "Change password", exact: true })
      .click({ timeout: 15_000 });
    const form = page.getByRole("form", { name: "Change password" });
    await expect(form).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#change-password-current")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
    await page.locator("#change-password-current").fill(oldPassword);
    await page.locator("#change-password-new").fill(newPassword);
    await page.locator("#change-password-confirm").fill(newPassword);
    await form.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText(/^Password changed\./)).toBeVisible({
      timeout: 15_000,
    });

    // The other device is signed out…
    const other = await page.request.get(`${BACKEND_URL}/api/auth/sessions`, {
      headers: otherDevice,
    });
    expect(other.status()).toBe(401);
    // …this browser is not.
    await page.reload();
    await expect(page.getByRole("heading", { name: "My account" })).toBeVisible(
      {
        timeout: 15_000,
      },
    );
    await expect(page).not.toHaveURL(/\/login/);

    // The new password signs in (a fresh browser), the old one does not.
    const fresh = await browser.newContext({
      baseURL: `http://localhost:${WEB_PORT}`,
    });
    await fresh.addInitScript((url: string) => {
      (globalThis as { __LIRATEK_BACKEND_URL?: string }).__LIRATEK_BACKEND_URL =
        url;
    }, BACKEND_URL);
    try {
      const p2 = await fresh.newPage();
      await loginAsUser(p2, username, newPassword);
      await expect(p2).not.toHaveURL(/\/login/);
    } finally {
      await fresh.close();
    }
    const oldLogin = await (
      await page.request.post(`${BACKEND_URL}/api/auth/login`, {
        data: { username, password: oldPassword },
      })
    ).json();
    expect(oldLogin.success).toBeFalsy();
  });

  test("Profile → Change email says to check the inbox; the email changes only after the link", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const username = `l293_em_${ts}`;
    const password = "L293Seed!pw2";
    const oldEmail = `l293-old-${ts}@example.com`;
    const newEmail = `l293-new-${ts}@example.com`;
    seedStaffUser(username, password);
    withDb((db) =>
      db
        .prepare(
          `UPDATE users SET email = ?, email_verified_at = ? WHERE username = ? AND tenant_id = 1`,
        )
        .run(oldEmail, new Date().toISOString(), username),
    );

    await loginAsUser(page, username, password);
    await openMyAccount(page);
    const profile = page.getByRole("region", { name: "Profile" });
    await expect(profile).toContainText(oldEmail, { timeout: 15_000 });
    // Redesigned panel (96d1ff86): the email row lives in "Sign-in options".
    const signin = page.getByRole("region", { name: "Sign-in options" });
    await expect(signin).toContainText("Verified", { timeout: 15_000 });

    await signin.getByRole("button", { name: "Change email" }).click();
    await signin.getByLabel("New email").fill(newEmail);
    await signin
      .getByRole("button", { name: "Send confirmation link" })
      .click();
    await expect(signin.getByText(/Open the link we sent/)).toBeVisible({
      timeout: 15_000,
    });

    const stored = withDb(
      (db) =>
        db
          .prepare(
            `SELECT email FROM users WHERE username = ? AND tenant_id = 1`,
          )
          .get(username) as { email: string },
    );
    expect(stored.email).toBe(oldEmail);
    expect(outboxTemplatesTo(newEmail)).toEqual(["verify-email"]);
    expect(outboxTemplatesTo(oldEmail)).toContain("email-change-notice");
  });
});
