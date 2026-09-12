/**
 * E2E: LIRA-165 — Database Reset (Settings › Reset Data) — GUARD ONLY.
 *
 * =====================================================================
 * ABSOLUTE CONSTRAINT — READ BEFORE TOUCHING THIS FILE
 * =====================================================================
 * This spec MUST NEVER trigger a real database reset. `test:e2e` shares ONE
 * accumulating SQLite DB across every spec in the suite, run in a fixed
 * order (CLAUDE.md rule 15 / README.md "Execution model"). A real reset
 * mid-suite would delete every earlier spec's rows and break every spec
 * that runs after this one — indistinguishable from a mass regression, with
 * no obvious cause, discovered far away from this file.
 *
 * Enforced here by construction:
 *   - No test ever fills the modal's phrase input with the real
 *     `DATABASE_RESET_CONFIRMATION_PHRASE` ("RESET ALL DATA").
 *   - No test ever clicks `reset-data-confirm-btn`.
 *   - The only `window.api.database.reset(...)` calls in this file pass a
 *     DELIBERATELY WRONG confirmation string, specifically to prove the
 *     server rejects it.
 *
 * Do NOT "complete" this test by making it actually reset. The wipe itself
 * (create → reset → assert every wipe-bucket table is empty, tenant
 * isolation, reseed, supplier partial-wipe, balance zeroing) is covered by
 * core jest against a disposable temp DB — see `packages/core/src/
 * repositories/__tests__/DatabaseResetRepository.test.ts` and the plan doc's
 * Phase 1 test list (`docs/plans/done_plans/DATABASE_RESET_PLAN.md`). This
 * file only proves the GUARD: the UI won't let you type it wrong, the
 * server won't accept a wrong phrase, and a non-admin can't reach it at
 * all — none of which require ever actually wiping anything.
 * =====================================================================
 *
 * `RESET_RESEED_TABLES` (`product_categories`, `service_presets`) are
 * seeded unconditionally by `electron-app/create_db.sql` on every fresh
 * install, so the preview's "Products & stock" bucket (which includes
 * `product_categories`) and the overall total are non-zero from the very
 * first spec in the suite — this file's assertions hold whether run as
 * part of the full ordered suite (where transactions/clients/etc. have
 * also accumulated by this point) or in isolation via `-g`.
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

const WRONG_PHRASE = "definitely not the phrase";
const LOWERCASE_NEAR_MISS = "reset all data";
const TRAILING_SPACE_NEAR_MISS = "RESET ALL DATA ";

const STAFF_USERNAME = "lira165_staff";
const STAFF_PASSWORD = "StaffPass1!";

interface ResetPreview {
  counts: Record<string, number>;
  totalRows: number;
}
interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

type ResetApi = {
  database: {
    resetPreview: () => Promise<Envelope<ResetPreview>>;
    reset: (data: { confirmation: string }) => Promise<Envelope<unknown>>;
  };
  auth: {
    createUser: (
      username: string,
      password: string,
      role: "admin" | "staff",
    ) => Promise<{ success: boolean; id?: number; error?: string }>;
    login: (
      username: string,
      password: string,
      rememberMe?: boolean,
    ) => Promise<{
      success: boolean;
      user?: { id: number; username: string; role: string };
      sessionToken?: string | null;
      error?: string;
    }>;
  };
};

async function getPreview(page: Page): Promise<ResetPreview> {
  const res = await page.evaluate(async () => {
    const api = (window as unknown as { api: ResetApi }).api;
    return api.database.resetPreview();
  });
  if (!res.success || !res.data) {
    throw new Error(`resetPreview failed: ${res.error ?? "no data"}`);
  }
  return res.data;
}

/** Create a staff user (idempotent) and log them in; returns their session token. */
async function createAndLoginStaff(page: Page): Promise<string> {
  return page.evaluate(
    async ({ username, password }) => {
      const api = (window as unknown as { api: ResetApi }).api;
      // createUser is admin-only; the shared session is admin at this point.
      // Ignore "already exists" so the spec is safe on a warm DB / re-run.
      await api.auth.createUser(username, password, "staff").catch(() => ({
        success: false,
      }));
      const res = await api.auth.login(username, password, false);
      if (!res.success || !res.sessionToken) {
        throw new Error(
          `staff login failed: ${res.error ?? "no session token"}`,
        );
      }
      return res.sessionToken;
    },
    { username: STAFF_USERNAME, password: STAFF_PASSWORD },
  );
}

/** Swap the persisted session token and reload so AuthContext restores it. */
async function reloadAs(page: Page, sessionToken: string): Promise<void> {
  await page.evaluate((token) => {
    localStorage.setItem("sessionToken", token);
  }, sessionToken);
  await page.reload();
  await page.waitForLoadState("load");
  await page.waitForSelector("nav a[href]", { timeout: 15_000 });
}

test.describe("LIRA-165 — Database Reset guard (no real reset ever runs)", () => {
  test("1. preview is reachable, real, and shows a recognisable non-zero category", async ({
    appPage,
  }) => {
    await navigateTo(appPage, "/settings?tab=reset");

    await expect(appPage.getByTestId("reset-data-panel")).toBeVisible({
      timeout: 15_000,
    });
    const previewTable = appPage.getByTestId("reset-data-preview");
    await expect(previewTable).toBeVisible({ timeout: 15_000 });

    // `product_categories` (create_db.sql's 6-row seed) always lands in the
    // "Products & stock" group and is always > 0, so this is a stable,
    // order-independent recognisable category — not reliant on how much of
    // the rest of the suite has already run.
    await expect(
      previewTable.locator("tr").filter({ hasText: "Products & stock" }),
    ).toBeVisible({ timeout: 10_000 });

    // Ground truth over IPC (not just DOM text) — a zero total here means
    // the preview query itself is broken, not a rendering issue.
    const preview = await getPreview(appPage);
    expect(preview.totalRows).toBeGreaterThan(0);
    expect(preview.counts.product_categories ?? 0).toBeGreaterThan(0);
  });

  test("2. the typed-phrase gate holds in the UI; cancel closes without ever confirming", async ({
    appPage,
  }) => {
    await navigateTo(appPage, "/settings?tab=reset");
    await expect(appPage.getByTestId("reset-data-panel")).toBeVisible({
      timeout: 15_000,
    });

    await appPage.getByTestId("reset-data-open-modal-btn").click();
    const modal = appPage.getByTestId("reset-data-modal");
    await expect(modal).toBeVisible({ timeout: 10_000 });

    const phraseInput = appPage.getByTestId("reset-data-phrase-input");
    const confirmBtn = appPage.getByTestId("reset-data-confirm-btn");

    // Empty phrase: disabled.
    await expect(confirmBtn).toBeDisabled();

    // Near miss #1: lowercase.
    await phraseInput.fill(LOWERCASE_NEAR_MISS);
    await expect(confirmBtn).toBeDisabled();

    // Near miss #2: correct phrase but with a trailing space.
    await phraseInput.fill(TRAILING_SPACE_NEAR_MISS);
    await expect(confirmBtn).toBeDisabled();

    // Never confirm — cancel out.
    await appPage.getByTestId("reset-data-cancel-btn").click();
    await expect(modal).toHaveCount(0, { timeout: 10_000 });
  });

  test("3. the server rejects a wrong confirmation phrase (defence in depth); the DB is untouched", async ({
    appPage,
  }) => {
    const before = await getPreview(appPage);

    const result = await appPage.evaluate(async (confirmation) => {
      const api = (window as unknown as { api: ResetApi }).api;
      return api.database.reset({ confirmation });
    }, WRONG_PHRASE);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(typeof result.error).toBe("string");

    // Delta assertion (rule 15) — never an absolute total — proves the
    // rejected call never reached the repository.
    const after = await getPreview(appPage);
    expect(after.totalRows).toBe(before.totalRows);
    expect(after.counts).toEqual(before.counts);
  });

  test("4. a non-admin (staff) cannot reach preview or reset at all", async ({
    appPage,
  }) => {
    const adminToken = await appPage.evaluate(
      () => localStorage.getItem("sessionToken") ?? "",
    );
    expect(adminToken).not.toBe("");

    try {
      const staffToken = await createAndLoginStaff(appPage);
      await reloadAs(appPage, staffToken);

      // Both channels are `requireRole(["admin"])` (databaseResetHandlers.ts)
      // — staff must be rejected on BOTH the read (preview) and the write
      // (reset) path, before either ever reaches the service/repository.
      // The reset call still deliberately carries a WRONG phrase (never the
      // real one) so this proves the ROLE gate specifically: the handler
      // checks role before it would ever validate the phrase, so a
      // "Forbidden" (not a phrase-mismatch) error here is the discriminating
      // proof that role-gating — not phrase-checking — is what stopped it.
      const previewResult = await appPage.evaluate(async () => {
        const api = (window as unknown as { api: ResetApi }).api;
        return api.database.resetPreview();
      });
      expect(previewResult.success).toBe(false);
      expect(previewResult.error).toBe("Forbidden");

      const resetResult = await appPage.evaluate(async (confirmation) => {
        const api = (window as unknown as { api: ResetApi }).api;
        return api.database.reset({ confirmation });
      }, WRONG_PHRASE);
      expect(resetResult.success).toBe(false);
      expect(resetResult.error).toBe("Forbidden");
    } finally {
      // Restore the shared admin session for every spec that runs after
      // this one in the file/suite.
      await reloadAs(appPage, adminToken);
      await expect(appPage.locator("nav a[href]").first()).toBeVisible({
        timeout: 15_000,
      });
    }
  });
});
