import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test as base, expect, type Page } from "@playwright/test";
// Same import global-setup.ts already uses — every spec in this suite runs
// under the Node ABI (rule "rebuild:node before ... web e2e"), so a direct
// better-sqlite3 open is safe from here too.
import Database from "better-sqlite3";
import { hashPassword } from "@liratek/core";
import { BACKEND_PORT } from "../../playwright.web.config";
// Imported from storageKey.ts, NOT useWhatsNew.ts: the hook module also
// imports releaseNotes.generated.json as a plain (non-asserted) ESM JSON
// import, which Node's native loader (this fixture runs under it) rejects —
// see storageKey.ts's own comment.
import { WHATS_NEW_STORAGE_KEY } from "../../src/features/whatsNew/storageKey";
import type { ReleaseNoteEntry } from "../../src/features/whatsNew/types";

export const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The "What's new" modal (frontend/src/features/whatsNew/) auto-opens once
// per fresh browser context whenever the seen version in localStorage is
// older than the newest entry here (useWhatsNew.ts) — which every context
// in this suite always is, since nothing has ever written the key. Its
// backdrop (`div.fixed.inset-0.z-[100]`) then intercepts pointer events for
// whichever spec runs first in a given worker/context, timing out that
// spec's first click. Pre-seed the "already seen" state below so the modal
// never auto-opens. Read from the generated JSON at fixture load (not
// hardcoded, and read with fs rather than a JSON import — the playwright
// tsconfig here has no `resolveJsonModule`/import-assertion setup) so this
// keeps working after every future release — the file's first entry is
// newest, mirroring useWhatsNew.ts's own `entries[0] ?? null`.
const WHATS_NEW_LATEST_VERSION: string | null = (() => {
  try {
    const raw = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "src",
        "features",
        "whatsNew",
        "releaseNotes.generated.json",
      ),
      "utf8",
    );
    const entries = JSON.parse(raw) as ReleaseNoteEntry[];
    return entries[0]?.version ?? null;
  } catch {
    // Worst case the modal auto-opens as it would for a real fresh user —
    // never let a missing/malformed file break test setup itself.
    return null;
  }
})();
// Mirrors global-setup.ts's own path resolution exactly — same DB file,
// this module lives in the same directory as global-setup.ts and every spec.
const DB_PATH = path.join(
  __dirname,
  "..",
  "..",
  "test-results",
  "e2e-web",
  "phone_shop.web.db",
);

/**
 * Web-mode test fixture: every page in the suite gets
 * `globalThis.__LIRATEK_BACKEND_URL` injected before app code runs, so the
 * frontend's httpClient talks to THIS suite's backend (port 3101) instead of
 * the default 127.0.0.1:3000 (which may be a dev backend or nothing at all).
 */
export const test = base.extend({
  context: async ({ context }, use) => {
    await context.addInitScript((url: string) => {
      (globalThis as { __LIRATEK_BACKEND_URL?: string }).__LIRATEK_BACKEND_URL =
        url;
    }, BACKEND_URL);
    if (WHATS_NEW_LATEST_VERSION) {
      await context.addInitScript(
        ({ key, version }: { key: string; version: string }) => {
          try {
            localStorage.setItem(key, version);
          } catch {
            // Private mode / blocked storage — same no-op fallback the app
            // itself uses (useWhatsNew.ts's writeLastSeen); worst case the
            // modal auto-opens as it would in a real fresh browser.
          }
        },
        { key: WHATS_NEW_STORAGE_KEY, version: WHATS_NEW_LATEST_VERSION },
      );
    }
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Playwright fixture `use`, not a React hook
    await use(context);
  },
});

export { expect };

/** Log in through the real UI form and wait for the authenticated shell. */
export async function loginAsUser(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  await page.goto("/#/login");
  await page.fill('input[placeholder="Enter username"]', username);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  // Successful login navigates away from #/login to the home route.
  await page.waitForURL((url) => !url.hash.includes("/login"), {
    timeout: 15_000,
  });
}

/** Log in as the seeded admin through the real UI form. */
export async function loginAsAdmin(page: Page): Promise<void> {
  await loginAsUser(page, "admin", "admin123");
}

/**
 * Seed (idempotently) a REAL `staff`-role user directly in the shared web
 * test DB — mirrors global-setup.ts's own admin-password bootstrap.
 *
 * Why not go over REST: `POST /api/users` (backend/src/api/users.ts) is an
 * unfinished placeholder — it validates the body, logs, and returns
 * `{success:true,id:1}` without writing a row, so it cannot create a
 * logically-real staff account. And `authenticateJWT` requires a live DB
 * `sessions` row behind the JWT's `sessionToken` (backend/src/middleware/
 * auth.ts), so a self-signed token (even with the correct role claim and
 * the right `JWT_SECRET`) is rejected the same way a stale one is — there
 * is no way to prove a route's role gate without a REAL login. The backend
 * jest suite's `x-test-role` header (recharge.api.test.ts,
 * databaseResetRoleGate.api.test.ts, profitsGate.api.test.ts, ...) is not a
 * usable shortcut either: it only exists inside that suite's own
 * `jest.mock("../../middleware/auth.js")`, never wired into the real
 * Express app this e2e suite drives.
 *
 * Idempotent AND unconditional: `INSERT OR IGNORE` no-ops against the
 * accumulating DB (rule 15) on every run after the first — the UPDATE that
 * follows forces the password/role/active state unconditionally, so a spec
 * never depends on what a PRIOR run happened to leave behind.
 *
 * `username`/`password` are caller-supplied (not a single shared constant)
 * so specs that seed their own staff user in parallel never collide on one
 * account's state.
 */
export function seedStaffUser(username: string, password: string): void {
  const db = new Database(DB_PATH);
  try {
    db.prepare(
      `INSERT OR IGNORE INTO users (tenant_id, username, password_hash, role, is_active)
       VALUES (1, ?, ?, 'staff', 1)`,
    ).run(username, hashPassword(password));
    db.prepare(
      `UPDATE users SET password_hash = ?, role = 'staff', is_active = 1 WHERE username = ?`,
    ).run(hashPassword(password), username);
  } finally {
    db.close();
  }
}

/**
 * Log a seeded user in over REST (`POST /api/auth/login`, the real route —
 * not `loginAsAdmin`'s UI form flow) and return ready-to-use `Authorization`
 * headers. Named for its primary use (a staff account seeded by
 * `seedStaffUser` above), but works for any real DB user, admin included —
 * the same `loginHeaders` helper lira-web-019/022/025 each hand-rolled
 * identically before this file consolidated it.
 */
export async function staffHeaders(
  page: Page,
  username: string,
  password: string,
): Promise<Record<string, string>> {
  const res = await (
    await page.request.post(`${BACKEND_URL}/api/auth/login`, {
      data: { username, password },
    })
  ).json();
  expect(res.success, JSON.stringify(res)).toBeTruthy();
  return { Authorization: `Bearer ${res.data.token as string}` };
}
