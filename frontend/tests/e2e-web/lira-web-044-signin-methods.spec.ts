/**
 * lira-web-044 — LIRA-291: sign-in methods for users who joined with Google,
 * through the REAL server and the real web app.
 *
 * The suite runs with Google OFF (GOOGLE_CLIENT_ID pinned empty in
 * playwright.web.config.ts), so nobody can actually join with Google here.
 * A Google-only user is therefore SEEDED: `has_password = 0` (what Join with
 * Google writes, v202), a confirmed email, and a `user_identities` row (plus
 * its sign-in directory row, as lira-web-043 does). The seeded password hash
 * only exists to open a session; the flag is what drives the behaviour.
 *
 *   1. Own disconnect is refused SET_PASSWORD_FIRST by the server (with
 *      Google off the panel shows no Disconnect button, so the route is
 *      called directly), and the link is kept.
 *   2. A STAFF member opens "My account" from the top bar (Settings stays
 *      admin-only: /settings sends staff home) and uses "Sign-in methods":
 *      Set a password works. The flag flips to 1, a `password-added` notice
 *      is queued, and the same DELETE now gets past the password rule (it
 *      answers Google-off).
 *   3. The new password signs in with the username (a fresh browser).
 *   4. An admin disconnecting ANOTHER Google-only user is warned, and a
 *      `password-set` email is queued to that user.
 *   5. That email's link opens "Set a password" with show/hide eyes on both
 *      fields.
 *
 * What it cannot prove: "Disconnect works after a password is set" through
 * Google itself (Google is off here); core + backend jest cover it.
 *
 * Shared accumulating DB (rule 15): usernames and emails are
 * `Date.now()`-unique and rows are matched by identity, never position.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import {
  test,
  expect,
  loginAsAdmin,
  loginAsUser,
  closeAutoCheckpoint,
  seedStaffUser,
  staffHeaders,
  BACKEND_URL,
} from "./fixtures";
import { EMAIL_FILE_DIR, WEB_PORT } from "../../playwright.web.config";

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

/** Makes a seeded tenant-1 user look exactly like a Join-with-Google user:
 * no password (has_password = 0), a confirmed email, Google linked. */
function makeGoogleOnly(
  username: string,
  email: string,
  role: "admin" | "staff",
): number {
  return withDb((db) => {
    const now = new Date().toISOString();
    const user = db
      .prepare(`SELECT id FROM users WHERE username = ? AND tenant_id = 1`)
      .get(username) as { id: number } | undefined;
    if (!user) throw new Error(`no tenant-1 user ${username}`);
    db.prepare(
      `UPDATE users SET role = ?, has_password = 0, email = ?, email_verified_at = ? WHERE id = ?`,
    ).run(role, email, now, user.id);
    const subject = `sub-${username}`;
    db.prepare(
      `INSERT INTO user_identities (user_id, tenant_id, provider, subject, email, created_at, updated_at)
       VALUES (?, 1, 'google', ?, ?, ?, ?)`,
    ).run(user.id, subject, email, now, now);
    db.prepare(
      `INSERT OR REPLACE INTO signin_directory
         (kind, value, target_tenant_id, target_user_id, username, display_email, created_at, updated_at)
       VALUES ('google', ?, 1, ?, ?, ?, ?, ?)`,
    ).run(subject, user.id, username, email, now, now);
    return user.id;
  });
}

const flagOf = (userId: number): number =>
  withDb(
    (db) =>
      (
        db.prepare(`SELECT has_password FROM users WHERE id = ?`).get(userId) as {
          has_password: number;
        }
      ).has_password,
  );

const identities = (userId: number): number =>
  withDb(
    (db) =>
      (
        db
          .prepare(`SELECT COUNT(*) AS n FROM user_identities WHERE user_id = ?`)
          .get(userId) as { n: number }
      ).n,
  );

const outboxTemplatesTo = (to: string): string[] =>
  withDb((db) =>
    (
      db
        .prepare(`SELECT template FROM email_outbox WHERE to_email = ? ORDER BY id`)
        .all(to) as { template: string }[]
    ).map((r) => r.template),
  );

/** The link from the newest `password-set` email sent to `to`. */
function findSetLink(to: string): string | null {
  if (!fs.existsSync(EMAIL_FILE_DIR)) return null;
  const matches: { link: string; mtime: number }[] = [];
  for (const name of fs.readdirSync(EMAIL_FILE_DIR)) {
    if (!/^password-set-\d+\.json$/.test(name)) continue;
    const jsonPath = path.join(EMAIL_FILE_DIR, name);
    try {
      const meta = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as { to?: string };
      if (meta.to !== to) continue;
      const text = fs.readFileSync(jsonPath.replace(/\.json$/, ".txt"), "utf8");
      const link = /https?:\/\/\S+\/#\/reset-password\?token=[A-Za-z0-9_%-]+/.exec(
        text,
      )?.[0];
      if (link) matches.push({ link, mtime: fs.statSync(jsonPath).mtimeMs });
    } catch {
      continue;
    }
  }
  matches.sort((a, b) => b.mtime - a.mtime);
  return matches[0]?.link ?? null;
}

test.describe("LIRA-291 — sign-in methods", () => {
  test("a Google-only STAFF member cannot remove their last way in, sets a password in My account, and signs in with it", async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const username = `l291_own_${ts}`;
    const email = `l291-own-${ts}@example.com`;
    const seeded = "L291Seed!pw1";
    const chosen = "xY7-pq_Rt.9mZ"; // a browser-style generated password
    seedStaffUser(username, seeded);
    const userId = makeGoogleOnly(username, email, "staff");

    // ── 1. Own disconnect: refused by the server, the link is kept ──
    const headers = await staffHeaders(page, username, seeded);
    const refused = await (
      await page.request.delete(`${BACKEND_URL}/api/auth/google/link`, { headers })
    ).json();
    expect(refused).toMatchObject({ success: false, code: "SET_PASSWORD_FIRST" });
    expect(identities(userId)).toBe(1);
    const status = await (
      await page.request.get(`${BACKEND_URL}/api/auth/google/link`, { headers })
    ).json();
    expect(status.data).toMatchObject({ linked: true, hasPassword: false });

    // ── 2. Staff: Settings stays admin-only; My account is reachable ──
    await loginAsUser(page, username, seeded);
    await closeAutoCheckpoint(page);
    await page.goto("/#/settings");
    await page.waitForURL((url) => !url.hash.includes("settings"), { timeout: 15_000 });
    await page.getByTestId("my-account-link").click();
    await page.waitForURL((url) => url.hash.startsWith("#/account"), { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "My account" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("heading", { name: "Sign-in methods" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/You sign in with Google only/)).toBeVisible();
    await page.locator("#set-password-new").fill(chosen);
    await page.locator("#set-password-confirm").fill(chosen);
    await page.getByRole("button", { name: "Set a password", exact: true }).click();
    await expect(page.getByText(/^Password set\./)).toBeVisible({ timeout: 15_000 });

    expect(flagOf(userId)).toBe(1);
    expect(identities(userId)).toBe(1); // Google stays connected
    expect(outboxTemplatesTo(email)).toContain("password-added");

    // The same DELETE now passes the password rule (Google itself is off).
    const after = await (
      await page.request.delete(`${BACKEND_URL}/api/auth/google/link`, { headers })
    ).json();
    expect(after.code).not.toBe("SET_PASSWORD_FIRST");

    // ── 3. Username + the new password sign in (a fresh browser) ──
    // Over REST first, then through the sign-in form in a fresh browser
    // (which needs the suite's backend address, as the `test` fixture does).
    await staffHeaders(page, username, chosen);
    const fresh = await browser.newContext({ baseURL: `http://localhost:${WEB_PORT}` });
    await fresh.addInitScript((url: string) => {
      (globalThis as { __LIRATEK_BACKEND_URL?: string }).__LIRATEK_BACKEND_URL = url;
    }, BACKEND_URL);
    try {
      const other = await fresh.newPage();
      await loginAsUser(other, username, chosen);
      await expect(other).not.toHaveURL(/\/login/);
    } finally {
      await fresh.close();
    }
  });

  test("an admin disconnecting a Google-only user is warned and a set-password email goes out; its page has show/hide eyes", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const username = `l291_staff_${ts}`;
    const email = `l291-staff-${ts}@example.com`;
    seedStaffUser(username, "L291Seed!pw2");
    const userId = makeGoogleOnly(username, email, "staff");

    // ── 4. Settings → Users: the label, the warning, the email ──
    await loginAsAdmin(page);
    await page.goto("/#/settings?tab=users");
    const row = page.locator("tr", { hasText: username });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByTestId(`user-signin-${userId}`)).toHaveText("Google");

    await row.getByRole("button", { name: "Disconnect Google" }).click();
    await expect(page.getByTestId("confirm-modal")).toContainText(
      `${username} has no password. We'll email them a link to set one.`,
    );
    await page.getByTestId("confirm-modal-confirm-btn").click();
    await expect
      .poll(() => identities(userId), { timeout: 15_000 })
      .toBe(0);
    expect(outboxTemplatesTo(email)).toEqual(["password-set"]);
    await expect(row.getByTestId(`user-signin-${userId}`)).toHaveText("None", {
      timeout: 15_000,
    });

    // ── 5. The emailed link: "Set a password", eyes on both fields ──
    await expect
      .poll(() => findSetLink(email) !== null, {
        message: `no password-set email to ${email} in ${EMAIL_FILE_DIR}`,
        timeout: 75_000,
        intervals: [1_000],
      })
      .toBe(true);
    const link = findSetLink(email);
    if (!link) throw new Error("set-password link vanished after polling");

    const setPage = await page.context().newPage();
    await setPage.goto(link);
    await expect(setPage.getByRole("heading", { name: "Set a password" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(setPage.getByText(username)).toBeVisible();
    const eyes = setPage.getByRole("button", { name: "Show password" });
    await expect(eyes).toHaveCount(2);
    await setPage.getByTestId("reset-password").fill("Abc-def_1.x");
    await expect(setPage.getByTestId("reset-password")).toHaveAttribute("type", "password");
    await eyes.first().click();
    await expect(setPage.getByTestId("reset-password")).toHaveAttribute("type", "text");
    await expect(setPage.getByTestId("reset-confirm")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
  });
});
