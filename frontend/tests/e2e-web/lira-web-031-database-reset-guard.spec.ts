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
 * Case 4 (non-admin cannot reset) is SKIPPED here: this suite has no staff
 * login fixture (grepped — only `loginAsAdmin` exists; lira-web-028's and
 * lira-web-029's own comments document the same gap for their tickets), so
 * there is no way to drive this case without inventing a helper — which the
 * task instructions explicitly say not to do. The role gate itself
 * (`requireRole(["admin"])` on both `/api/database/reset/preview` and
 * `POST /api/database/reset`, identical to the IPC handlers) is covered at
 * the backend/core level instead.
 */

import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";
import type { Page } from "@playwright/test";

const WRONG_PHRASE = "definitely not the phrase";
const LOWERCASE_NEAR_MISS = "reset all data";
const TRAILING_SPACE_NEAR_MISS = "RESET ALL DATA ";

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

  // 4. Non-admin cannot reset — SKIPPED, see file header: no staff login
  // fixture exists in this suite (same gap lira-web-028/029 document).
  test.skip(
    "4. a non-admin (staff) cannot reach preview or reset at all — SKIPPED (no staff login fixture in this suite; see file header comment)",
    () => {},
  );
});
