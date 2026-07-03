/**
 * E2E: LIRA-091 — Checkpoint Timeline surfaces ANY drawer variance (no tolerance)
 *
 * Acceptance criteria (from the request):
 *   AC1  The Checkpoint Timeline shows the difference between the expected and
 *        counted amounts — both at-a-glance on the timeline ROW and inside the
 *        "View details" modal.
 *   AC2  There is NO tolerance: differences far below the old 5% threshold
 *        (~1% for USD, ~0.1% for LBP here) are still flagged.
 *   AC3  Any difference reads as a single amber "attention" style, whether it is
 *        an overage OR a shortage — never green-for-over / red-for-short.
 *
 * Why this fails on the PRE-CHANGE code (rule 17 — the guard must be able to
 * fail on the buggy version):
 *   - Pre-change the timeline ROW had no variance indicator at all, so the amber
 *     row badge assertion could not pass.
 *   - Pre-change the modal coloured an overage GREEN (text-green-400) and a
 *     shortage RED (text-red-400); the "no green / no red, amber only" assertions
 *     would fail.
 *
 * Method / safety (rule 15 — shared accumulating DB):
 *   The checkpoint is seeded through the same IPC the app uses. The COUNTED
 *   (physical) amount is set to each currency's CURRENT balance so the
 *   reconciliation delta is zero — the shared General drawer is NOT disturbed.
 *   The variance is created purely via the EXPECTED (opening) amount: $5 below
 *   the count for USD (a +$5.00 overage) and 10,000 above the count for LBP (a
 *   −10,000 shortage). The row is matched by a UNIQUE notes marker (never by
 *   position), and assertions are on the presence/style of the badge, never on
 *   absolute totals.
 */

import { test, expect } from "./fixtures";
import { navigateTo } from "./fixtures";

// A retry would seed a SECOND checkpoint carrying the same notes marker and
// break the "exactly my row" search; keep this deterministic.
test.describe.configure({ retries: 0 });

const NOTE = "E2E-LIRA-091 variance marker";

type SeedApi = {
  api: {
    closing: {
      getSystemExpectedBalancesDynamic: () => Promise<
        Record<string, Record<string, number>>
      >;
      createCheckpoint: (data: {
        user_id: number;
        drawer_name: string;
        notes?: string;
        amounts: Array<{
          drawer_name: string;
          currency_code: string;
          expected_amount: number;
          physical_amount: number;
        }>;
      }) => Promise<{ success: boolean; id?: number; error?: string }>;
    };
  };
};

test.describe("LIRA-091 — checkpoint timeline variance (no tolerance)", () => {
  test("timeline flags a sub-tolerance overage AND shortage with amber attention", async ({
    appPage,
  }) => {
    // ── Seed one checkpoint with a controlled variance, zero reconciliation ──
    const seeded = await appPage.evaluate(async (note) => {
      const w = window as unknown as SeedApi;
      const bal = await w.api.closing.getSystemExpectedBalancesDynamic();
      const currentUsd = bal?.General?.USD ?? 0;
      const currentLbp = bal?.General?.LBP ?? 0;

      const res = await w.api.closing.createCheckpoint({
        user_id: 1, // admin (first user created by the setup wizard)
        drawer_name: "General",
        notes: note,
        amounts: [
          {
            drawer_name: "General",
            currency_code: "USD",
            // counted == current balance → reconciliation delta 0 (no disturbance)
            physical_amount: currentUsd,
            // system expected $5 LESS than counted → +$5.00 OVERAGE in the timeline
            expected_amount: currentUsd - 5,
          },
          {
            drawer_name: "General",
            currency_code: "LBP",
            physical_amount: currentLbp,
            // system expected 10,000 MORE than counted → −10,000 SHORTAGE
            expected_amount: currentLbp + 10_000,
          },
        ],
      });

      return {
        ok: res.success,
        id: res.id ?? null,
        error: res.error ?? null,
        currentUsd,
        currentLbp,
      };
    }, NOTE);

    expect(seeded.error).toBeNull();
    expect(seeded.ok).toBe(true);
    expect(seeded.id).not.toBeNull();
    // AC2 sanity: the base balances are large enough that $5 / 10,000 are FAR
    // below the old 5% tolerance — so flagging them proves tolerance is gone.
    expect(seeded.currentUsd).toBeGreaterThan(100); // 5 / 100 = 5% → we're under it
    expect(seeded.currentLbp).toBeGreaterThan(200_000); // 10k / 200k = 5%

    // ── Open the Checkpoint Timeline and isolate our row by its notes marker ──
    await navigateTo(appPage, "/checkpoint-timeline");
    const search = appPage.getByPlaceholder("Search drawer");
    await expect(search).toBeVisible();
    await search.fill(NOTE);

    const row = appPage.locator("tbody tr").filter({ hasText: NOTE }).first();
    await expect(row).toBeVisible();

    // ── AC1 + AC3 on the ROW: one amber attention badge carrying BOTH deltas ──
    const rowBadge = row.locator("span.text-amber-400");
    await expect(rowBadge).toBeVisible();
    await expect(rowBadge).toContainText("USD +5.00"); // overage, amber
    await expect(rowBadge).toContainText("LBP -10,000"); // shortage, amber
    // The row must NOT use the old sign-based green/red colouring.
    await expect(row.locator("span.text-green-400")).toHaveCount(0);
    await expect(row.locator("span.text-red-400")).toHaveCount(0);

    // ── Open the detail modal ────────────────────────────────────────────────
    await row.locator('button[title="View details"]').click();
    const dialog = appPage
      .locator("div.fixed.inset-0")
      .filter({ hasText: "Checkpoint Details" })
      .first();
    await expect(dialog).toBeVisible();

    // AC1: the modal shows the expected → counted breakdown …
    await expect(dialog.getByText("Expected → Counted")).toBeVisible();
    // … and both the overage and the shortage as amber attention badges.
    await expect(
      dialog.locator("span.text-amber-400").filter({ hasText: "+5.00" }),
    ).toBeVisible();
    await expect(
      dialog.locator("span.text-amber-400").filter({ hasText: "-10,000" }),
    ).toBeVisible();

    // AC3: no green-for-over, no red-for-short anywhere in the modal.
    await expect(dialog.locator("span.text-green-400")).toHaveCount(0);
    await expect(dialog.locator("span.text-red-400")).toHaveCount(0);

    // Tidy up so the modal cannot block the next spec's navigation.
    await dialog.getByRole("button", { name: /^Close$/ }).click();
    await expect(dialog).toBeHidden();
  });
});
