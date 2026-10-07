/**
 * lira-web-040 — LIRA-281 / LIRA-279: invite a user by email from
 * Settings -> Users, join from the emailed link, and confirm a user's email.
 *
 * The backend runs with EMAIL_TRANSPORT=file (playwright.web.config.ts), so
 * every email lands in EMAIL_FILE_DIR as `<template>-<outboxId>.{html,txt,json}`;
 * the `.json` is written LAST. The outbox worker sends on a 30-second
 * interval, hence the long polls. APP_BASE_DOMAIN is pinned empty there, so
 * shop links point at SIGNUP_INVITE_BASE_URL (the one platform origin) and
 * the join page answers `loginUrl: null` ("Go to sign in").
 *
 *   1. The shop admin invites an email as staff; the link opens /#/join with
 *      the email locked; choosing a username and password creates the user,
 *      who can then sign in; the link then shows the generic "not valid".
 *   2. The admin adds an email to a staff user; the verification link marks
 *      it "Verified" in the Users tab.
 *
 * Shared accumulating DB (rule 15): every email and username is
 * `Date.now()`-unique and emails are matched by their `to` address, never by
 * file order.
 */
import fs from "node:fs";
import path from "node:path";
import { test, expect, loginAsAdmin, loginAsUser, seedStaffUser, BACKEND_URL } from "./fixtures";
import { EMAIL_FILE_DIR } from "../../playwright.web.config";

const INVITE_INVALID = "This invite link is not valid";

/** The newest link of `template` emailed to `to`, read from the .txt body. */
function findLink(template: string, to: string, pattern: RegExp): string | null {
  if (!fs.existsSync(EMAIL_FILE_DIR)) return null;
  const matches: { link: string; mtime: number }[] = [];
  const nameRe = new RegExp(`^${template}-\\d+\\.json$`);
  for (const name of fs.readdirSync(EMAIL_FILE_DIR)) {
    if (!nameRe.test(name)) continue;
    const jsonPath = path.join(EMAIL_FILE_DIR, name);
    let meta: { to?: string };
    try {
      meta = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as { to?: string };
    } catch {
      continue;
    }
    if (meta.to !== to) continue;
    const text = fs.readFileSync(jsonPath.replace(/\.json$/, ".txt"), "utf8");
    const link = pattern.exec(text)?.[0];
    if (link) matches.push({ link, mtime: fs.statSync(jsonPath).mtimeMs });
  }
  matches.sort((a, b) => b.mtime - a.mtime);
  return matches[0]?.link ?? null;
}

async function waitForLink(
  template: string,
  to: string,
  pattern: RegExp,
): Promise<string> {
  await expect
    .poll(() => findLink(template, to, pattern) !== null, {
      message: `no ${template} email to ${to} in ${EMAIL_FILE_DIR}`,
      timeout: 75_000,
      intervals: [1_000],
    })
    .toBe(true);
  const link = findLink(template, to, pattern);
  if (!link) throw new Error(`${template} link to ${to} vanished after polling`);
  return link;
}

const JOIN_LINK = /https?:\/\/\S+\/#\/join\?invite=[A-Za-z0-9_%-]+/;
const VERIFY_LINK = /https?:\/\/\S+\/#\/verify-email\?token=[A-Za-z0-9_%-]+/;

test.describe("LIRA-281 / LIRA-279 — user invites and user emails", () => {
  test("admin invites by email; the link creates the user once", async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const email = `l281-staff-${ts}@example.com`;
    const username = `l281_staff_${ts}`;
    const password = "L281StaffPass!1";

    // ── 1. Invite from Settings -> Users ──
    await loginAsAdmin(page);
    await page.goto("/#/settings?tab=users");
    await page.getByTestId("invite-email").fill(email);
    await page.getByTestId("invite-submit").click();
    const inviteRow = page.locator("tr", { hasText: email });
    await expect(inviteRow).toBeVisible({ timeout: 15_000 });
    await expect(inviteRow.getByText("Waiting")).toBeVisible();

    // ── 2. Open the emailed link logged out ──
    const link = await waitForLink("user-invite", email, JOIN_LINK);
    const visitor = await browser.newContext();
    await visitor.addInitScript((url: string) => {
      (globalThis as { __LIRATEK_BACKEND_URL?: string }).__LIRATEK_BACKEND_URL =
        url;
    }, BACKEND_URL);
    try {
      const joinPage = await visitor.newPage();
      await joinPage.goto(link);
      const lockedEmail = joinPage.getByTestId("join-email");
      await expect(lockedEmail).toHaveValue(email, { timeout: 15_000 });
      await expect(lockedEmail).toHaveAttribute("readonly", "");

      await joinPage.getByTestId("join-username").fill(username);
      await joinPage.getByTestId("join-password").fill(password);
      await joinPage.getByTestId("join-submit").click();
      await expect(joinPage.getByText("You're in")).toBeVisible({
        timeout: 15_000,
      });

      // ── 3. The link works once ──
      const again = await visitor.newPage();
      await again.goto(link);
      await expect(again.getByRole("alert")).toContainText(INVITE_INVALID, {
        timeout: 15_000,
      });
      await expect(again.getByTestId("join-submit")).toHaveCount(0);

      // ── 4. The new user can sign in ──
      const signIn = await visitor.newPage();
      await loginAsUser(signIn, username, password);
      await expect(signIn).not.toHaveURL(/\/login/);
    } finally {
      await visitor.close();
    }

    // ── 5. The invite has left the pending list ──
    await page.reload();
    await expect(page.locator("tr", { hasText: username })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator("tr", { hasText: email }).getByText("Waiting")).toHaveCount(0);
  });

  test("admin adds a staff email; the verification link marks it Verified", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const username = `l279_staff_${ts}`;
    const email = `l279-${ts}@example.com`;
    seedStaffUser(username, "L279StaffPass!1");

    await loginAsAdmin(page);
    await page.goto("/#/settings?tab=users");
    const row = page.locator("tr", { hasText: username });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByText("Add email").click();
    await row.locator('input[type="email"]').fill(email);
    await row.getByText("Save").click();
    await expect(row.getByText("Not verified")).toBeVisible({ timeout: 15_000 });

    const link = await waitForLink("verify-email", email, VERIFY_LINK);
    await page.goto(link);
    await expect(page.getByText("Email confirmed")).toBeVisible({
      timeout: 15_000,
    });

    await page.goto("/#/settings?tab=users");
    await expect(page.locator("tr", { hasText: username }).getByText("Verified")).toBeVisible({
      timeout: 15_000,
    });
  });
});
