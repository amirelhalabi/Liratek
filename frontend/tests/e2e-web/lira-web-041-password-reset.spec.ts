/**
 * lira-web-041 — LIRA-275: "Forgot password?" end to end on the web app.
 *
 * The backend runs with EMAIL_TRANSPORT=file (playwright.web.config.ts), so
 * the reset email lands in EMAIL_FILE_DIR as `password-reset-<outboxId>.*`.
 * The `.json` is written LAST. The outbox worker sends on a 30-second
 * interval, hence the long poll and test timeout.
 *
 * APP_BASE_DOMAIN is pinned empty here, so the host names no shop: the
 * forgot page asks for the shop address too (the www path), and the emailed
 * link points at SIGNUP_INVITE_BASE_URL (this suite's own origin).
 *
 *   1. A staff user with a VERIFIED email clicks "Forgot password?" on the
 *      login page, types email + shop address, sees the generic message.
 *   2. The emailed link names the account; a new password is chosen.
 *   3. The new password signs in; the link works only once.
 *
 * Shared accumulating DB (rule 15): the username and email are
 * `Date.now()`-unique and the email is matched by its `to` address.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { test, expect, loginAsUser, seedStaffUser } from "./fixtures";
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

const GENERIC =
  "If this email belongs to an account in this shop, we've sent a link.";
const INVALID = "This reset link is not valid. Ask for a new one.";

/** Gives the seeded user a verified email; returns the shop's slug. */
function verifyEmailOf(username: string, email: string): string {
  const db = new Database(DB_PATH);
  try {
    db.prepare(
      `UPDATE users SET email = ?, email_verified_at = ? WHERE username = ? AND tenant_id = 1`,
    ).run(email, new Date().toISOString(), username);
    const row = db.prepare(`SELECT slug FROM tenants WHERE id = 1`).get() as
      | { slug: string }
      | undefined;
    if (!row) throw new Error("tenant 1 missing from the web test DB");
    return row.slug;
  } finally {
    db.close();
  }
}

/** The reset link from the newest `password-reset` email sent to `to`. */
function findResetLink(to: string): string | null {
  if (!fs.existsSync(EMAIL_FILE_DIR)) return null;
  const matches: { link: string; mtime: number }[] = [];
  for (const name of fs.readdirSync(EMAIL_FILE_DIR)) {
    if (!/^password-reset-\d+\.json$/.test(name)) continue;
    const jsonPath = path.join(EMAIL_FILE_DIR, name);
    let meta: { to?: string };
    try {
      meta = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as { to?: string };
    } catch {
      continue;
    }
    if (meta.to !== to) continue;
    const text = fs.readFileSync(jsonPath.replace(/\.json$/, ".txt"), "utf8");
    const link = /https?:\/\/\S+\/#\/reset-password\?token=[A-Za-z0-9_%-]+/.exec(
      text,
    )?.[0];
    if (link) matches.push({ link, mtime: fs.statSync(jsonPath).mtimeMs });
  }
  matches.sort((a, b) => b.mtime - a.mtime);
  return matches[0]?.link ?? null;
}

test.describe("LIRA-275 — forgot password", () => {
  test("a user with a verified email resets the password from the emailed link", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const username = `l275_staff_${ts}`;
    const email = `l275-${ts}@example.com`;
    const newPassword = "L275NewPass!1";
    seedStaffUser(username, "L275OldPass!1");
    const slug = verifyEmailOf(username, email);

    // ── 1. Login page -> Forgot password? -> email + shop address ──
    await page.goto("/#/login");
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await page.getByTestId("forgot-email").fill(email);
    await page.getByTestId("forgot-shop").fill(slug);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText(GENERIC)).toBeVisible({ timeout: 15_000 });

    // ── 2. The emailed link names the account; choose a new password ──
    await expect
      .poll(() => findResetLink(email) !== null, {
        message: `no password-reset email to ${email} in ${EMAIL_FILE_DIR}`,
        timeout: 75_000,
        intervals: [1_000],
      })
      .toBe(true);
    const link = findResetLink(email);
    if (!link) throw new Error("reset link vanished after polling");

    await page.goto(link);
    await expect(page.getByText(username)).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("reset-password").fill(newPassword);
    await page.getByTestId("reset-confirm").fill(newPassword);
    await page.getByRole("button", { name: "Set new password" }).click();
    await expect(page.getByText("Password changed")).toBeVisible({
      timeout: 15_000,
    });

    // ── 3. The new password signs in ──
    await loginAsUser(page, username, newPassword);
    await expect(page).not.toHaveURL(/\/login/);

    // ── 4. The link works once (a fresh tab: a hash-only navigation to the
    //       same URL would reload nothing) ──
    const again = await page.context().newPage();
    await again.goto(link);
    await expect(again.getByRole("alert")).toContainText(INVALID, {
      timeout: 15_000,
    });
    await expect(again.getByTestId("reset-password")).toHaveCount(0);
  });
});
