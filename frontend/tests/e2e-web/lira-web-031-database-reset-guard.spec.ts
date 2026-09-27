/**
 * lira-web-031 — Database Reset (Settings › Reset Data) — GUARD ONLY, web
 * (REST) transport. REST twin of the desktop
 * `lira-165-database-reset-guard.spec.ts`.
 *
 * =====================================================================
 * ABSOLUTE CONSTRAINT — READ BEFORE TOUCHING THIS FILE
 * =====================================================================
 * This spec MUST NEVER trigger a real database reset. The web suite's DB
 * accumulates across every spec file, run in order (tests/e2e-web/
 * README.md "Conventions" — same rule as the desktop suite, CLAUDE.md rule
 * 15). A real reset here would delete every earlier spec's rows and break
 * every spec that runs after this one.
 *
 * Enforced here by construction:
 *   - No test ever fills the modal's phrase input with the real
 *     `DATABASE_RESET_CONFIRMATION_PHRASE` ("RESET ALL DATA").
 *   - No test ever clicks `reset-data-confirm-btn`.
 *   - The only `POST /api/database/reset` calls in this file carry a
 *     DELIBERATELY WRONG confirmation string, specifically to prove the
 *     server rejects it.
 *
 * Do NOT "complete" this test by making it actually reset. The wipe itself
 * is covered by core jest against a disposable temp DB
 * (`packages/core/src/repositories/__tests__/DatabaseResetRepository.test.ts`).
 * This file only proves the GUARD holds over REST + the real browser UI.
 * =====================================================================
 *
 * `RESET_RESEED_TABLES` (`product_categories`, `service_presets`) are
 * seeded unconditionally by `electron-app/create_db.sql` on every fresh
 * install, so the preview's "Products & stock" bucket is non-zero from the
 * very first spec in the suite — these assertions hold regardless of how
 * much of the rest of the suite has run before this file.
 *
 * Case 4 (non-admin cannot reset) is a REAL test now (LIRA-235) — the suite
 * gained a shared staff-login fixture (`seedStaffUser`/`staffHeaders` in
 * `./fixtures`), so this file no longer needs to lean solely on the
 * backend/core-level regression coverage. That coverage is still the more
 * detailed guard and stays in place alongside this end-to-end proof:
 * `backend/src/api/__tests__/databaseResetRoleGate.api.test.ts` (REST
 * transport — staff 403 on both routes with `{ error: "Forbidden" }`, admin
 * 200, unauthenticated 401) and `electron-app/handlers/__tests__/
 * databaseResetHandlers.roleGate.test.ts` (desktop IPC transport — same
 * staff-refused/admin-allowed shape on `database:resetPreview`/
 * `database:reset`). Case 4 below hits the REAL Express app (not the mocked
 * router those files use) with a REAL staff login, over both routes, and
 * confirms nothing moved — never sending the real confirmation phrase,
 * per the ABSOLUTE CONSTRAINT above (the role gate refuses the request
 * before the phrase is ever checked, but this file takes no chances).
 *
 * The real `requireRole` middleware (`backend/src/middleware/auth.ts`)
 * answers a refusal with `{ error: "Forbidden" }` — NO `success` key — unlike
 * the mocked auth module `databaseResetRoleGate.api.test.ts` uses for its own
 * assertions (`{ success: false, error: "Forbidden" }`); this file only
 * asserts the HTTP status, matching how lira-web-019's role-parity case (c)
 * already asserts the same real middleware.
 */

import {
  test,
  expect,
  loginAsAdmin,
  seedStaffUser,
  staffHeaders,
  BACKEND_URL,
} from "./fixtures";
import type { Page } from "@playwright/test";

const WRONG_PHRASE = "definitely not the phrase";
const LOWERCASE_NEAR_MISS = "reset all data";
const TRAILING_SPACE_NEAR_MISS = "RESET ALL DATA ";
const STAFF_USERNAME = "e2e031staff";
const STAFF_PASSWORD = "E2e031Staff!1";

interface ResetPreview {
  counts: Record<string, number>;
  totalRows: number;
}
interface PreviewEnvelope {
  success: boolean;
  data?: ResetPreview;
  error?: string;
}
interface ResetEnvelope {
  success: boolean;
  data?: unknown;
  error?: string;
}

async function authHeaders(page: Page): Promise<Record<string, string>> {
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  if (!token) throw new Error("No JWT in localStorage after loginAsAdmin");
  return { Authorization: `Bearer ${token}` };
}

async function getPreview(
  page: Page,
  headers: Record<string, string>,
): Promise<ResetPreview> {
  const res = await page.request.get(
    `${BACKEND_URL}/api/database/reset/preview`,
    { headers },
  );
  const body = (await res.json()) as PreviewEnvelope;
  expect(body.success, JSON.stringify(body)).toBe(true);
  if (!body.data) throw new Error("preview succeeded with no data");
  return body.data;
}

test.describe("Database Reset guard (web/REST) — LIRA-165 (no real reset ever runs)", () => {
  test("1. preview is reachable, real, and shows a recognisable non-zero category", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const headers = await authHeaders(page);

    // Ground truth over REST first — a zero total means the preview query
    // itself is broken, independent of any UI rendering issue.
    const preview = await getPreview(page, headers);
    expect(preview.totalRows).toBeGreaterThan(0);
    expect(preview.counts.product_categories ?? 0).toBeGreaterThan(0);

    // Then the real UI, driven fresh (same login, same page).
    await page.goto("/#/settings?tab=reset");
    await expect(page.getByTestId("reset-data-panel")).toBeVisible({
      timeout: 15_000,
    });
    const previewTable = page.getByTestId("reset-data-preview");
    await expect(previewTable).toBeVisible({ timeout: 15_000 });
    await expect(
      previewTable.locator("tr").filter({ hasText: "Products & stock" }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("2. the typed-phrase gate holds in the UI; cancel closes without ever confirming", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/#/settings?tab=reset");
    await expect(page.getByTestId("reset-data-panel")).toBeVisible({
      timeout: 15_000,
    });

    await page.getByTestId("reset-data-open-modal-btn").click();
    const modal = page.getByTestId("reset-data-modal");
    await expect(modal).toBeVisible({ timeout: 10_000 });

    const phraseInput = page.getByTestId("reset-data-phrase-input");
    const confirmBtn = page.getByTestId("reset-data-confirm-btn");

    // Empty phrase: disabled.
    await expect(confirmBtn).toBeDisabled();

    // Near miss #1: lowercase.
    await phraseInput.fill(LOWERCASE_NEAR_MISS);
    await expect(confirmBtn).toBeDisabled();

    // Near miss #2: correct phrase but with a trailing space.
    await phraseInput.fill(TRAILING_SPACE_NEAR_MISS);
    await expect(confirmBtn).toBeDisabled();

    // Never confirm — cancel out.
    await page.getByTestId("reset-data-cancel-btn").click();
    await expect(modal).toHaveCount(0, { timeout: 10_000 });

    await expect(page.locator("#root")).not.toContainText(
      "Something went wrong",
    );
  });

  test("3. the server rejects a wrong confirmation phrase over REST (defence in depth); the DB is untouched", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const headers = await authHeaders(page);

    const before = await getPreview(page, headers);

    const res = await page.request.post(`${BACKEND_URL}/api/database/reset`, {
      headers,
      data: { confirmation: WRONG_PHRASE },
    });
    // Rule 19c: envelope parity — HTTP 200 even on a rejected business rule,
    // never a 4xx.
    expect(res.status()).toBe(200);
    const body = (await res.json()) as ResetEnvelope;
    expect(body.success).toBe(false);
    expect(typeof body.error).toBe("string");
    expect(body.error).toBeTruthy();

    // Delta assertion (rule 15) — never an absolute total — proves the
    // rejected call never reached the repository.
    const after = await getPreview(page, headers);
    expect(after.totalRows).toBe(before.totalRows);
    expect(after.counts).toEqual(before.counts);
  });

  test("4. a non-admin (staff) cannot reach preview or reset at all; the DB is untouched", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const adminHeaders = await authHeaders(page);

    seedStaffUser(STAFF_USERNAME, STAFF_PASSWORD);
    const staff = await staffHeaders(page, STAFF_USERNAME, STAFF_PASSWORD);

    // `before` is snapshotted here, AFTER seeding the staff user and logging
    // them in — both legitimately write rows (a `users` row and a login
    // `sessions` row) — and immediately before the two refused calls below,
    // so the delta assertion proves exactly what it claims: the refused
    // preview/reset calls changed nothing, not that setup was a no-op.
    const before = await getPreview(page, adminHeaders);

    // `requireRole(["admin"])` (databaseReset.ts:52) runs before either
    // handler body, so a staff caller never reaches `preview()`/`reset()` —
    // the real middleware answers 403 with `{ error: "Forbidden" }` (no
    // `success` key, unlike the mocked-auth backend test's own assertion
    // shape), so this only asserts status, matching lira-web-019 case (c).
    const previewRes = await page.request.get(
      `${BACKEND_URL}/api/database/reset/preview`,
      { headers: staff },
    );
    expect(previewRes.status()).toBe(403);

    // WRONG_PHRASE, never the real confirmation phrase — per the ABSOLUTE
    // CONSTRAINT above. The role gate refuses this before the phrase is even
    // read, but this file takes no chances regardless of caller.
    const resetRes = await page.request.post(
      `${BACKEND_URL}/api/database/reset`,
      { headers: staff, data: { confirmation: WRONG_PHRASE } },
    );
    expect(resetRes.status()).toBe(403);

    // Delta assertion (rule 15) — neither refused call reached the
    // repository.
    const after = await getPreview(page, adminHeaders);
    expect(after.totalRows).toBe(before.totalRows);
    expect(after.counts).toEqual(before.counts);
  });
});
