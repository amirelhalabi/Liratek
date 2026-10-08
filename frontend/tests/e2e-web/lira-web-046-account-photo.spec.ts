/**
 * lira-web-046 — LIRA-294: the Google profile photo is the account picture.
 *
 * Google is OFF in the web suite (nobody can sign in with it here), so the
 * photo is SEEDED on a fresh user's Google link (`user_identities.picture_url`,
 * what a Google sign-in writes). Google's image host is intercepted and
 * answered with a tiny PNG, so the run needs no network. Then:
 *   - the top bar's My account link shows the photo (a circle the size of
 *     the icon it replaces), not the icon;
 *   - My account → Profile shows it larger.
 *
 * Shared accumulating DB (rule 15): the user is `Date.now()`-unique.
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
} from "./fixtures";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(
  __dirname,
  "..",
  "..",
  "test-results",
  "e2e-web",
  "phone_shop.web.db",
);

/** 1x1 transparent PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

test.describe("LIRA-294 — account photo", () => {
  test("a user with a Google photo sees it in the top bar and on My account", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const username = `l294_photo_${ts}`;
    const password = "L294Seed!pw1";
    const photo = `https://lh3.googleusercontent.com/a/l294-${ts}=s96-c`;
    seedStaffUser(username, password);
    const db = new Database(DB_PATH);
    try {
      const user = db
        .prepare(`SELECT id FROM users WHERE username = ? AND tenant_id = 1`)
        .get(username) as { id: number };
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO user_identities (user_id, tenant_id, provider, subject, email, picture_url, created_at, updated_at)
         VALUES (?, 1, 'google', ?, ?, ?, ?, ?)`,
      ).run(user.id, `sub-l294-${ts}`, `l294-${ts}@gmail.com`, photo, now, now);
    } finally {
      db.close();
    }

    let served = 0;
    await page.route("https://lh3.googleusercontent.com/**", (route) => {
      served += 1;
      return route.fulfill({
        status: 200,
        contentType: "image/png",
        body: PNG,
      });
    });

    await loginAsUser(page, username, password);
    await closeAutoCheckpoint(page);

    const link = page.getByTestId("my-account-link");
    const img = link.getByRole("img", { name: "My account" });
    await expect(img).toBeVisible({ timeout: 15_000 });
    await expect(img).toHaveAttribute("src", photo);
    await expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
    const box = await img.boundingBox();
    expect(Math.round(box!.width)).toBe(20);
    expect(Math.round(box!.height)).toBe(20);
    expect(served).toBeGreaterThan(0);

    await link.click();
    await page.waitForURL((url) => url.hash.startsWith("#/account"), {
      timeout: 15_000,
    });
    const profile = page.getByRole("region", { name: "Profile" });
    await expect(
      profile.getByRole("img", { name: "Account photo" }),
    ).toHaveAttribute("src", photo);
  });
});
