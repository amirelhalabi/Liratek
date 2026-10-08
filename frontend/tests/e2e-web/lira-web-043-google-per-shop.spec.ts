/**
 * lira-web-043 — LIRA-288: Google sign-in per shop, through the REAL server.
 *
 * What this suite CANNOT do: complete a Google sign-in. The callback trades
 * Google's code at Google's own token endpoint and checks the ID token
 * against Google's published keys; the web suite runs with Google OFF
 * (GOOGLE_CLIENT_ID pinned empty in playwright.web.config.ts) and has no way
 * to stand in for Google end to end. The "Join with Google" callback itself
 * — user created + linked + signed in, and every refusal returning to the
 * invite page — is covered instead by backend `googleAuth.api.test.ts`
 * ("Join with Google (invite links)") and core
 * `UserInvitationService.joinWithGoogle.test.ts` (real database). The start
 * route is covered with Google ON in `userInvitations.api.test.ts`.
 *
 * What it does prove, end to end:
 *   1. With Google off, the invite page offers no "Join with Google", the
 *      start route answers GOOGLE_NOT_CONFIGURED, and the password path is
 *      unaffected (the regression risk of the reworked page).
 *   2. Settings -> Users shows each user's Google email, and the admin's
 *      Disconnect (after confirming) removes the link AND its www sign-in
 *      directory row — the sync running inside the real server.
 *
 * Shared accumulating DB (rule 15): usernames, emails and Google subjects are
 * `Date.now()`-unique and rows are matched by identity, never position.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { test, expect, loginAsAdmin, seedStaffUser, BACKEND_URL } from "./fixtures";
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

function withDb<T>(fn: (db: Database.Database) => T): T {
  const db = new Database(DB_PATH);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/**
 * Links a Google account to a tenant-1 user, as "Connect Google" would. This
 * write bypasses the app, so it also writes the directory row the app's sync
 * would (`SigninDirectoryService.buildDirectoryRows`: kind 'google').
 */
function linkGoogle(username: string, subject: string, googleEmail: string): number {
  return withDb((db) => {
    const now = new Date().toISOString();
    const user = db
      .prepare(`SELECT id FROM users WHERE username = ? AND tenant_id = 1`)
      .get(username) as { id: number } | undefined;
    if (!user) throw new Error(`no tenant-1 user ${username}`);
    db.prepare(
      `INSERT INTO user_identities (user_id, tenant_id, provider, subject, email, created_at, updated_at)
       VALUES (?, 1, 'google', ?, ?, ?, ?)`,
    ).run(user.id, subject, googleEmail, now, now);
    db.prepare(
      `INSERT OR REPLACE INTO signin_directory
         (kind, value, target_tenant_id, target_user_id, username, display_email, created_at, updated_at)
       VALUES ('google', ?, 1, ?, ?, ?, ?, ?)`,
    ).run(subject, user.id, username, googleEmail, now, now);
    return user.id;
  });
}

const JOIN_LINK = /https?:\/\/\S+\/#\/join\?invite=[A-Za-z0-9_%-]+/;

/** The newest /#/join link emailed to `to` (EMAIL_TRANSPORT=file), as
 * lira-web-040 reads it: the `.json` is written last, then the `.txt`. */
function findJoinLink(to: string): string | null {
  if (!fs.existsSync(EMAIL_FILE_DIR)) return null;
  const matches: { link: string; mtime: number }[] = [];
  for (const name of fs.readdirSync(EMAIL_FILE_DIR)) {
    if (!/^user-invite-\d+\.json$/.test(name)) continue;
    const jsonPath = path.join(EMAIL_FILE_DIR, name);
    try {
      const meta = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as { to?: string };
      if (meta.to !== to) continue;
      const link = JOIN_LINK.exec(fs.readFileSync(jsonPath.replace(/\.json$/, ".txt"), "utf8"))?.[0];
      if (link) matches.push({ link, mtime: fs.statSync(jsonPath).mtimeMs });
    } catch {
      continue;
    }
  }
  matches.sort((a, b) => b.mtime - a.mtime);
  return matches[0]?.link ?? null;
}

const count = (sql: string, ...params: unknown[]): number =>
  withDb((db) => (db.prepare(sql).get(...params) as { n: number }).n);

test.describe("LIRA-288 — Google sign-in per shop", () => {
  test("Google off: no Join with Google on the invite page; the start route says so", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const email = `l288-off-${ts}@example.com`;

    await loginAsAdmin(page);
    await page.goto("/#/settings?tab=users");
    await page.getByTestId("add-user-mode").getByRole("button").click();
    await page.getByRole("option", { name: "Send invitation" }).click();
    await page.getByTestId("invite-email").fill(email);
    await page.getByTestId("invite-submit").click();
    await expect(page.locator("tr", { hasText: email })).toBeVisible({ timeout: 15_000 });

    // The raw token never leaves the email, so the start route is driven with
    // an unknown one: with Google off it must refuse BEFORE looking.
    const res = await page.request.post(`${BACKEND_URL}/api/user-invitations/google/start`, {
      data: { token: `unknown-${ts}`, username: `l288_off_${ts}` },
    });
    const body = (await res.json()) as { success: boolean; error?: { code?: string } };
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe("GOOGLE_NOT_CONFIGURED");

    // The real invite link opens the form — username and password, no
    // Google while it is off.
    await expect
      .poll(() => findJoinLink(email) !== null, {
        message: `no user-invite email to ${email} in ${EMAIL_FILE_DIR}`,
        timeout: 75_000,
        intervals: [1_000],
      })
      .toBe(true);
    const link = findJoinLink(email)!;
    const visitor = await page.context().browser()!.newContext();
    await visitor.addInitScript((url: string) => {
      (globalThis as { __LIRATEK_BACKEND_URL?: string }).__LIRATEK_BACKEND_URL = url;
    }, BACKEND_URL);
    try {
      const joinPage = await visitor.newPage();
      await joinPage.goto(link);
      await expect(joinPage.getByTestId("join-email")).toHaveValue(email, { timeout: 15_000 });
      await expect(joinPage.getByTestId("join-username")).toBeVisible();
      await expect(joinPage.getByTestId("join-password")).toBeVisible();
      await expect(joinPage.getByTestId("join-google")).toHaveCount(0);
    } finally {
      await visitor.close();
    }
  });

  test("Settings -> Users shows a user's Google and the admin disconnects it (link and directory row)", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const username = `l288_google_${ts}`;
    const subject = `l288-sub-${ts}`;
    const googleEmail = `l288-${ts}@gmail.com`;
    seedStaffUser(username, "L288StaffPass!1");
    const userId = linkGoogle(username, subject, googleEmail);

    await loginAsAdmin(page);
    await page.goto("/#/settings?tab=users");
    const cell = page.getByTestId(`user-google-${userId}`);
    await expect(cell).toContainText(googleEmail, { timeout: 15_000 });

    await cell.getByText("Disconnect Google").click();
    await expect(page.getByTestId("confirm-modal")).toContainText(username);
    await page.getByTestId("confirm-modal-confirm-btn").click();

    await expect(cell).toContainText("—", { timeout: 15_000 });
    await expect(cell).not.toContainText(googleEmail);
    expect(
      count(`SELECT COUNT(*) AS n FROM user_identities WHERE user_id = ? AND tenant_id = 1`, userId),
    ).toBe(0);
    expect(
      count(`SELECT COUNT(*) AS n FROM signin_directory WHERE kind = 'google' AND value = ?`, subject),
    ).toBe(0);
  });
});
