/**
 * lira-web-039 — LIRA-267: email invites and self-serve sign-up, end to end.
 *
 * The backend runs with EMAIL_TRANSPORT=file (playwright.web.config.ts), so
 * every email lands in EMAIL_FILE_DIR as `<template>-<outboxId>.{html,txt,json}`
 * instead of a mailbox. The `.json` is written LAST, so once it exists the
 * other two are complete. The outbox worker sends on a 30-second interval,
 * hence the long poll and test timeouts.
 *
 *   1. A super admin sends an invite from the Tenants page; the link from the
 *      email opens the sign-up form with the email locked; signing up creates
 *      the shop with that `contact_email`; the invite shows "used"; reopening
 *      the link shows the generic "not valid" message.
 *   2. A visitor clicks "Create your shop" on the sign-in page, asks for a link with an
 *      email and a shop name (LIRA-278: self-serve switched on, Turnstile
 *      off), checks the email does NOT echo that shop name, completes
 *      sign-up from the emailed link (shop name prefilled) and logs in.
 *      Asking again with the same email (LIRA-290) shows "This email already
 *      has a LiraTek shop." with a Sign in link, and queues nothing.
 *
 * Shared accumulating DB (rule 15): every email, slug and username is
 * `Date.now()`-unique, emails are matched by their `to` address (never by file
 * order), and the invite row by its email.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { hashPassword } from "@liratek/core";
import { test, expect, loginAsUser, BACKEND_URL } from "./fixtures";
import { EMAIL_FILE_DIR } from "../../playwright.web.config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(
  __dirname,
  "..",
  "..",
  "test-results",
  "e2e-web",
  "phone_shop.web.db",
);

const INVITE_INVALID = "This invite link is not valid";

/** Same escape hatch as lira-web-038: no REST/UI path creates a super admin. */
function seedSuperAdmin(username: string, password: string): void {
  const db = new Database(DB_PATH);
  try {
    db.prepare(
      `INSERT INTO users (tenant_id, username, password_hash, role, is_active)
       VALUES (NULL, ?, ?, 'super_admin', 1)`,
    ).run(username, hashPassword(password));
  } finally {
    db.close();
  }
}

function contactEmailOf(slug: string): string | null {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const row = db
      .prepare(`SELECT contact_email FROM tenants WHERE slug = ?`)
      .get(slug) as { contact_email: string | null } | undefined;
    return row?.contact_email ?? null;
  } finally {
    db.close();
  }
}

/** How many self-serve sign-up invites exist for `email`. */
function selfInviteCount(email: string): number {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    return (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM signup_invitations WHERE source = 'self' AND email = ?`,
        )
        .get(email) as { n: number }
    ).n;
  } finally {
    db.close();
  }
}

/** The plain-text body of the newest `signup-invite` email sent to `to`. */
function findInviteText(to: string): string | null {
  if (!fs.existsSync(EMAIL_FILE_DIR)) return null;
  let newest: { text: string; mtime: number } | null = null;
  for (const name of fs.readdirSync(EMAIL_FILE_DIR)) {
    if (!/^signup-invite-\d+\.json$/.test(name)) continue;
    const jsonPath = path.join(EMAIL_FILE_DIR, name);
    let meta: { to?: string };
    try {
      meta = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as { to?: string };
    } catch {
      continue;
    }
    if (meta.to !== to) continue;
    const mtime = fs.statSync(jsonPath).mtimeMs;
    if (!newest || mtime > newest.mtime) {
      newest = {
        text:
          fs.readFileSync(jsonPath.replace(/\.json$/, ".txt"), "utf8") +
          fs.readFileSync(jsonPath.replace(/\.json$/, ".html"), "utf8"),
        mtime,
      };
    }
  }
  return newest?.text ?? null;
}

/** The invite link from the newest `signup-invite` email sent to `to`. */
function findInviteLink(to: string): string | null {
  if (!fs.existsSync(EMAIL_FILE_DIR)) return null;
  const matches: { link: string; mtime: number }[] = [];
  for (const name of fs.readdirSync(EMAIL_FILE_DIR)) {
    if (!/^signup-invite-\d+\.json$/.test(name)) continue;
    const jsonPath = path.join(EMAIL_FILE_DIR, name);
    let meta: { to?: string };
    try {
      meta = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as { to?: string };
    } catch {
      continue;
    }
    if (meta.to !== to) continue;
    // The .txt body is not HTML-escaped, so the link reads back verbatim.
    const text = fs.readFileSync(jsonPath.replace(/\.json$/, ".txt"), "utf8");
    const link = /https?:\/\/\S+\/signup\?invite=[A-Za-z0-9_%-]+/.exec(text)?.[0];
    if (link) matches.push({ link, mtime: fs.statSync(jsonPath).mtimeMs });
  }
  matches.sort((a, b) => b.mtime - a.mtime);
  return matches[0]?.link ?? null;
}

async function waitForInviteLink(to: string): Promise<string> {
  await expect
    .poll(
      () => findInviteLink(to) !== null,
      {
        message: `no signup-invite email to ${to} in ${EMAIL_FILE_DIR}`,
        timeout: 75_000,
        intervals: [1_000],
      },
    )
    .toBe(true);
  const link = findInviteLink(to);
  if (!link) throw new Error(`invite link to ${to} vanished after polling`);
  return link;
}

test.describe("LIRA-267 — email invites and self-serve sign-up", () => {
  test("super admin invites by email; the link signs the shop up once", async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const suUsername = `l267_root_${ts}`;
    const suPassword = "L267RootPass!1";
    seedSuperAdmin(suUsername, suPassword);

    const email = `l267-admin-${ts}@example.com`;
    const shopName = `L267 Invited ${ts}`;
    const slug = `l267-inv-${ts}`;

    // ── 1. Send the invite from the Tenants page ──
    await loginAsUser(page, suUsername, suPassword);
    await expect(page).toHaveURL(/\/admin\/tenants/, { timeout: 15_000 });
    await page.getByRole("button", { name: "Send invite" }).click();
    await page.getByTestId("send-invite-email").fill(email);
    await page.getByTestId("send-invite-shop").fill(shopName);
    await page.getByTestId("send-invite-submit").click();
    await expect(page.getByTestId("send-invite-email")).toBeHidden({
      timeout: 15_000,
    });

    const inviteRow = page.locator(`tr[data-email="${email}"]`);
    await expect(inviteRow).toBeVisible({ timeout: 15_000 });
    await expect(inviteRow.getByText("pending")).toBeVisible();

    // ── 2. Read the link from the emailed file ──
    const link = await waitForInviteLink(email);
    expect(link).toContain("/signup?invite=");

    // ── 3. Open it logged out: email locked, shop name prefilled ──
    // A fresh context skips the fixture's init script, so point it at this
    // suite's backend the same way (fixtures.ts), or API calls hit Vite.
    const visitor = await browser.newContext();
    await visitor.addInitScript((url: string) => {
      (globalThis as { __LIRATEK_BACKEND_URL?: string }).__LIRATEK_BACKEND_URL =
        url;
    }, BACKEND_URL);
    try {
      const signupPage = await visitor.newPage();
      await signupPage.goto(link);
      const lockedEmail = signupPage.getByTestId("signup-email");
      await expect(lockedEmail).toHaveValue(email, { timeout: 15_000 });
      await expect(lockedEmail).toHaveAttribute("readonly", "");
      await expect(signupPage.getByTestId("signup-shop-name")).toHaveValue(
        shopName,
      );
      await expect(signupPage.getByTestId("signup-invite-code")).toHaveCount(0);

      await signupPage.getByTestId("signup-slug").fill(slug);
      await signupPage.getByTestId("signup-username").fill(`l267_owner_${ts}`);
      await signupPage.getByTestId("signup-password").fill("L267OwnerPass!1");
      await signupPage.getByTestId("signup-submit").click();

      // APP_BASE_DOMAIN is empty here, so the page shows the bare slug.
      await expect(signupPage.getByTestId("signup-login-url")).toContainText(
        slug,
        { timeout: 15_000 },
      );
      expect(contactEmailOf(slug)).toBe(email);

      // ── 4. The link works once ──
      // A fresh tab, as when the email link is clicked again. Re-using the
      // same tab would be a hash-only navigation to the URL it is already on,
      // which reloads nothing.
      const again = await visitor.newPage();
      await again.goto(link);
      await expect(again.getByRole("alert")).toContainText(INVITE_INVALID, {
        timeout: 15_000,
      });
      await expect(again.getByTestId("signup-submit")).toHaveCount(0);
    } finally {
      await visitor.close();
    }

    // ── 5. The admin list shows it used, by the new shop ──
    await page.reload();
    await expect(inviteRow.getByText("used")).toBeVisible({ timeout: 15_000 });
    await expect(inviteRow).toContainText(slug);
  });

  test("a visitor signs up from the login page with an email and a shop name", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const email = `l267-self-${ts}@example.com`;
    const slug = `l267-self-${ts}`;
    const username = `l267_self_${ts}`;
    const password = "L267SelfPass!1";

    const shopName = `L278 Self ${ts}`;

    // ── 1. Sign-in page -> Create your shop -> request form (email + shop name) ──
    await page.goto("/#/login");
    await page.getByRole("link", { name: "Create your shop" }).click();
    const emailField = page.getByTestId("signup-request-email");
    await expect(emailField).toBeVisible({ timeout: 15_000 });
    // The full shop form is the link's job, not this page's.
    await expect(page.getByTestId("signup-shop-name")).toHaveCount(0);
    // Turnstile is off in this environment (LIRA-278 launch config).
    await expect(page.getByTestId("turnstile-container")).toHaveCount(0);
    await emailField.fill(email);
    await page.getByTestId("signup-request-shop-name").fill(shopName);

    // A form sent in under 3 seconds is silently dropped as a bot (the
    // browser measures the time on its own clock), so a person's pace.
    await page.waitForTimeout(3_500);
    const submit = page.getByTestId("signup-request-submit");
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByText("Check your inbox")).toBeVisible({
      timeout: 15_000,
    });

    // ── 2. The email never echoes the visitor's shop name... ──
    const link = await waitForInviteLink(email);
    const emailText = findInviteText(email);
    expect(emailText).not.toBeNull();
    expect(emailText).not.toContain(shopName);

    // ── ...but the link opens the shop form with it prefilled ──
    await page.goto(link);
    await expect(page.getByTestId("signup-email")).toHaveValue(email, {
      timeout: 15_000,
    });
    await expect(page.getByTestId("signup-shop-name")).toHaveValue(shopName);
    await page.getByTestId("signup-slug").fill(slug);
    await page.getByTestId("signup-username").fill(username);
    await page.getByTestId("signup-password").fill(password);
    await page.getByTestId("signup-submit").click();
    await expect(page.getByTestId("signup-login-url")).toContainText(slug, {
      timeout: 15_000,
    });
    expect(contactEmailOf(slug)).toBe(email);

    // ── 3. LIRA-290: the same email cannot ask for a second shop — the page
    //    says so under the email field, with a Sign in link, and nothing is
    //    emailed (still exactly one self-serve invite for this address). ──
    await page.goto("/#/login");
    await page.getByRole("link", { name: "Create your shop" }).click();
    const againField = page.getByTestId("signup-request-email");
    await expect(againField).toBeVisible({ timeout: 15_000 });
    await againField.fill(email);
    await page.waitForTimeout(3_500);
    await page.getByTestId("signup-request-submit").click();
    const notice = page.getByTestId("signup-email-has-shop");
    await expect(notice).toContainText(
      "This email already has a LiraTek shop.",
      { timeout: 15_000 },
    );
    await expect(
      notice.getByRole("link", { name: /sign in instead/i }),
    ).toBeVisible();
    await expect(page.getByText("Check your inbox")).toHaveCount(0);
    expect(selfInviteCount(email)).toBe(1);

    // ── 4. The new owner can log in ──
    await loginAsUser(page, username, password);
    await expect(page).not.toHaveURL(/\/login/);
  });
});
