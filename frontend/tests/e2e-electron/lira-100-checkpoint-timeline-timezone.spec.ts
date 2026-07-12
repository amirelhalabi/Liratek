/**
 * E2E: Checkpoint Timeline shows local time, not raw UTC.
 *
 * Same bug class as lira-transactions-timezone.spec.ts ("Issue 3"): SQLite
 * stores daily_closings.created_at as a marker-less UTC string
 * ("YYYY-MM-DD HH:MM:SS"). The Checkpoint Timeline's "Time" column used a
 * bare `new Date(str)`, which JS parses as LOCAL time, so every checkpoint
 * displayed hours off (≈3h behind in Beirut, UTC+3) — while the Dashboard's
 * "last checkpoint" widget (which already used parseDbDate) showed the
 * correct time for the same row. The fix routes the Timeline's "Time"
 * column through the same parseDbDate helper.
 *
 * This test seeds a checkpoint through the same IPC the app uses, reads back
 * its stored created_at, and asserts the rendered Time cell equals the
 * UTC-pinned interpretation of that value — computed inside the renderer so
 * it shares the app's own ICU/timezone. A regression to raw `new Date(str)`
 * renders a different string on any non-UTC machine (the only machines
 * where this bug can manifest) and fails this test.
 *
 * Shared Electron instance / accumulating DB; the row is matched by a
 * unique notes marker, never by position (CLAUDE.md rule 15).
 */

import { test, expect, navigateTo } from "./fixtures";

test.describe.configure({ retries: 0 });

const NOTE = "E2E-LIRA-100 timezone marker";

type Api = {
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
      getCheckpointTimeline: (filters: { type?: string }) => Promise<{
        success: boolean;
        error?: string;
        checkpoints?: Array<{
          id: number;
          notes?: string;
          created_at: string;
        }>;
      }>;
    };
  };
};

test.describe("Checkpoint Timeline — timezone", () => {
  test("a fresh checkpoint renders its UTC-stored time as local wall-clock time", async ({
    appPage,
  }) => {
    // ── Seed one checkpoint with a zero-reconciliation, uniquely-marked row ──
    const seeded = await appPage.evaluate(async (note) => {
      const w = window as unknown as Api;
      const bal = await w.api.closing.getSystemExpectedBalancesDynamic();
      const currentUsd = bal?.General?.USD ?? 0;

      const res = await w.api.closing.createCheckpoint({
        user_id: 1,
        drawer_name: "General",
        notes: note,
        amounts: [
          {
            drawer_name: "General",
            currency_code: "USD",
            physical_amount: currentUsd,
            expected_amount: currentUsd,
          },
        ],
      });

      return { ok: res.success, id: res.id ?? null, error: res.error ?? null };
    }, NOTE);

    expect(seeded.error).toBeNull();
    expect(seeded.ok).toBe(true);
    expect(seeded.id).not.toBeNull();

    // ── Read back the stored (marker-less UTC) created_at for our row ────────
    const createdAt = await appPage.evaluate(async (note) => {
      const w = window as unknown as Api;
      const res = await w.api.closing.getCheckpointTimeline({ type: "ALL" });
      const row = res.checkpoints?.find((c) => c.notes?.includes(note));
      return row?.created_at ?? null;
    }, NOTE);
    expect(createdAt).not.toBeNull();

    // Expected display string, computed in the renderer's own ICU + timezone
    // (matches the app's `formatTime`: parseDbDate + en-US 2-digit h:mm).
    const expectedTime = await appPage.evaluate((iso: string) => {
      const parseUtc = (s: string) =>
        /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)
          ? new Date(s)
          : new Date(`${s.replace(" ", "T")}Z`);
      return parseUtc(iso).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      });
    }, createdAt as string);

    // ── Open the Checkpoint Timeline and isolate our row by its notes marker ──
    await navigateTo(appPage, "/checkpoint-timeline");
    const search = appPage.getByPlaceholder("Search drawer");
    await expect(search).toBeVisible();
    await search.fill(NOTE);

    const row = appPage.locator("tbody tr").filter({ hasText: NOTE }).first();
    await expect(row).toBeVisible();

    // Time is the first column. A regression to raw `new Date(str)` would
    // shift this by the machine's UTC offset (e.g. 3h behind in Beirut).
    const timeCell = row.locator("td").first();
    await expect(timeCell).toHaveText(expectedTime);
  });
});
