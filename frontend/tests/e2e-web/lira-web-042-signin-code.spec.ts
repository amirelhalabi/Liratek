/**
 * lira-web-042 — LIRA-287: "email me a code" sign-in, through the REAL server.
 *
 * The page itself (www's PlatformSignIn) only renders on the platform host,
 * which this suite cannot be (APP_BASE_DOMAIN is pinned empty), so this spec
 * drives the two public routes over HTTP — through server.ts's real mount
 * and every global middleware in front of it — and reads the code out of
 * the email the real outbox worker renders (EMAIL_TRANSPORT=file).
 *
 *   1. A staff user with a VERIFIED email asks for a code: the generic reply.
 *   2. The `signin-code` email arrives with a 6-digit code.
 *   3. The code returns that user's shop and username; it works once.
 *
 * Shared accumulating DB (rule 15): the username and email are
 * `Date.now()`-unique and the email is matched by its `to` address.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { test, expect, seedStaffUser, BACKEND_URL } from "./fixtures";
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

const GENERIC = "If this email has a LiraTek account, we've sent a code.";

/** Gives the seeded user a verified email; returns tenant 1's slug + name. */
function verifyEmailOf(
  username: string,
  email: string,
): { slug: string; name: string } {
  const db = new Database(DB_PATH);
  try {
    db.prepare(
      `UPDATE users SET email = ?, email_verified_at = ? WHERE username = ? AND tenant_id = 1`,
    ).run(email, new Date().toISOString(), username);
    const row = db
      .prepare(`SELECT slug, name FROM tenants WHERE id = 1`)
      .get() as { slug: string; name: string } | undefined;
    if (!row) throw new Error("tenant 1 missing from the web test DB");
    return row;
  } finally {
    db.close();
  }
}

/** The code in the newest `signin-code` email sent to `to`. */
function findCode(to: string): string | null {
  if (!fs.existsSync(EMAIL_FILE_DIR)) return null;
  const matches: { code: string; mtime: number }[] = [];
  for (const name of fs.readdirSync(EMAIL_FILE_DIR)) {
    if (!/^signin-code-\d+\.json$/.test(name)) continue;
    const jsonPath = path.join(EMAIL_FILE_DIR, name);
    let meta: { to?: string };
    try {
      meta = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as { to?: string };
    } catch {
      continue;
    }
    if (meta.to !== to) continue;
    const text = fs.readFileSync(jsonPath.replace(/\.json$/, ".txt"), "utf8");
    const code = /^\s*(\d{6})\s*$/m.exec(text)?.[1];
    if (code) matches.push({ code, mtime: fs.statSync(jsonPath).mtimeMs });
  }
  matches.sort((a, b) => b.mtime - a.mtime);
  return matches[0]?.code ?? null;
}

test.describe("LIRA-287 — sign-in code", () => {
  test("a verified email gets a code that lists its shop, once", async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const username = `l287_staff_${ts}`;
    const email = `l287-${ts}@example.com`;
    seedStaffUser(username, "L287Pass!1");
    const shop = verifyEmailOf(username, email);

    // ── 1. Ask for a code: the generic reply ──
    const asked = await request.post(
      `${BACKEND_URL}/api/auth/signin-code/request`,
      { data: { email } },
    );
    expect(asked.status()).toBe(200);
    expect(await asked.json()).toEqual({
      success: true,
      data: { message: GENERIC },
    });

    // ── 2. The emailed code ──
    await expect
      .poll(() => findCode(email) !== null, {
        message: `no signin-code email to ${email} in ${EMAIL_FILE_DIR}`,
        timeout: 75_000,
        intervals: [1_000],
      })
      .toBe(true);
    const code = findCode(email);
    if (!code) throw new Error("code vanished after polling");

    // ── 3. The code lists the shop with the username; it works once ──
    const checked = await request.post(
      `${BACKEND_URL}/api/auth/signin-code/verify`,
      { data: { email, code } },
    );
    expect(checked.status()).toBe(200);
    const body = (await checked.json()) as {
      success: boolean;
      data: { shops: { slug: string; name: string; username: string }[] };
    };
    expect(body.success).toBe(true);
    expect(body.data.shops).toContainEqual({
      slug: shop.slug,
      name: shop.name,
      username,
    });

    const again = await request.post(
      `${BACKEND_URL}/api/auth/signin-code/verify`,
      { data: { email, code } },
    );
    expect(((await again.json()) as { code?: string }).code).toBe(
      "SIGNIN_CODE_INVALID",
    );
  });
});
