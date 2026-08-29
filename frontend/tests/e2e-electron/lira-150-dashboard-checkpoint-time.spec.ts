/**
 * E2E: Dashboard "last checkpoint" chip reflects the DRAWER'S OWN latest
 * checkpoint, not a stale multi-drawer one (LIRA-156, owner-reported
 * 2026-08-29: "Dashboard checkpoint is not changing the last checkpoint
 * time in dashboard but is propagating correctly in checkpoint timeline.").
 *
 * Root cause (see ClosingRepository.getLastCheckpointPerDrawer()'s doc
 * comment for the full explanation): every shop carries at least one
 * multi-drawer `AGGREGATED` checkpoint from the setup wizard
 * (`StepComplete.tsx`, runs on every fresh install). The old query's
 * `closing_id IN (SELECT MAX(closing_id) ... GROUP BY drawer_name)` computed
 * the right id per drawer but flattened it into one bare id list with no
 * link back to which drawer it belonged to — so once "General" also has its
 * OWN individual checkpoint, the old query let BOTH closings' rows through
 * for General, and a missing time-ordering (`ORDER BY drawer_name,
 * currency_code` only) meant `checked_at` could end up taken from the
 * OLDER (aggregated) closing while `amounts` came from the newer one: the
 * numbers on the dashboard updated, but the time looked frozen — exactly
 * the reported symptom. The Checkpoint Timeline reads a different, already
 * time-ordered method (`getCheckpointTimeline`), which is why it showed the
 * right time all along and made this asymmetry visible.
 *
 * Proof strategy (CLAUDE.md rule 15 — identity, never absolute/position):
 * this test creates ONE new "General" checkpoint carrying a unique `notes`
 * marker, reads back that checkpoint's OWN `created_at` from
 * `getCheckpointTimeline()` (the read already proven correct — see
 * lira-100-checkpoint-timeline-timezone.spec.ts), and asserts
 * `getLastCheckpointPerDrawer()['General'].checked_at` equals THAT exact
 * value — not a hardcoded/absolute time, and not "whatever changed", but
 * the identity-matched ground truth for the row this test itself created.
 * Given General already carries an older AGGREGATED checkpoint from setup
 * (guaranteed on every worker), the pre-fix query has a real, non-hypothetical
 * older closing to wrongly prefer here.
 *
 * A literal "chip text differs before vs. after" assertion was deliberately
 * NOT used: the dashboard's `formatCheckpointTime` renders hour:minute only
 * (no seconds), so two checkpoints created a second or two apart — the only
 * gap a fast e2e run naturally produces — can legitimately render IDENTICAL
 * text even when the underlying fix is completely correct, which would make
 * that assertion flaky by construction rather than a real regression signal.
 * Forcing a genuine minute-boundary gap would mean an unconditional
 * `waitForTimeout` of up to 60s, which this suite's own
 * OPTIMIZATION_PLAN.md is actively trying to eliminate, not add to. Instead,
 * the UI assertion below computes the EXPECTED chip text from the same
 * freshly-read `created_at` (mirroring lira-100's pattern) and checks the
 * dashboard renders exactly that — which the pre-fix query cannot reliably
 * do, without needing any wait at all.
 */

import { test, expect, navigateTo } from "./fixtures";

test.describe.configure({ retries: 0 });

const NOTE = `E2E-LIRA-150 dashboard checkpoint time ${Date.now()}`;

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
          drawer_name: string;
          notes?: string;
          created_at: string;
        }>;
      }>;
      getLastCheckpointPerDrawer: () => Promise<{
        success: boolean;
        error?: string;
        data?: Record<
          string,
          {
            drawer_name: string;
            checked_at: string;
            amounts: Record<string, { physical: number; expected: number }>;
          }
        >;
      }>;
    };
  };
};

test.describe("Dashboard — per-drawer checkpoint time (LIRA-156)", () => {
  test("General's dashboard chip reflects its OWN latest checkpoint, not a stale AGGREGATED one", async ({
    appPage,
  }) => {
    // ── Baseline: whatever General currently reports (from setup's
    // AGGREGATED baseline and/or any earlier spec) — used only as a sanity
    // "it moved" signal, never as the correctness proof itself. ──
    const before = await appPage.evaluate(async () => {
      const w = window as unknown as Api;
      const res = await w.api.closing.getLastCheckpointPerDrawer();
      return res.data?.General?.checked_at ?? null;
    });

    // ── Create a zero-variance, General-only checkpoint (mirrors the real
    // per-drawer Checkpoint page, not the multi-drawer AGGREGATED baseline)
    // carrying a unique notes marker so it can be matched by IDENTITY. ──
    const seeded = await appPage.evaluate(
      async ({ note }: { note: string }) => {
        const w = window as unknown as Api;
        const bal = await w.api.closing.getSystemExpectedBalancesDynamic();
        const usd = bal?.General?.USD ?? 0;
        const lbp = bal?.General?.LBP ?? 0;

        const res = await w.api.closing.createCheckpoint({
          user_id: 1,
          drawer_name: "General",
          notes: note,
          amounts: [
            {
              drawer_name: "General",
              currency_code: "USD",
              expected_amount: usd,
              physical_amount: usd,
            },
            {
              drawer_name: "General",
              currency_code: "LBP",
              expected_amount: lbp,
              physical_amount: lbp,
            },
          ],
        });
        return { ok: res.success, id: res.id ?? null, error: res.error ?? null };
      },
      { note: NOTE },
    );
    expect(seeded.error).toBeNull();
    expect(seeded.ok).toBe(true);

    // ── Ground truth: this checkpoint's OWN created_at, read back by its
    // unique notes marker (never by position/recency — rule 15). ──
    const expectedCheckedAt = await appPage.evaluate(async (note: string) => {
      const w = window as unknown as Api;
      const res = await w.api.closing.getCheckpointTimeline({ type: "ALL" });
      const row = res.checkpoints?.find(
        (c) => c.drawer_name === "General" && c.notes?.includes(note),
      );
      return row?.created_at ?? null;
    }, NOTE);
    expect(expectedCheckedAt).not.toBeNull();

    // ── Repository-level proof: getLastCheckpointPerDrawer() must report
    // THIS checkpoint's own time for General, not the older AGGREGATED
    // baseline's. ──
    const statuses = await appPage.evaluate(async () => {
      const w = window as unknown as Api;
      const res = await w.api.closing.getLastCheckpointPerDrawer();
      return res.data;
    });
    expect(statuses?.General?.checked_at).toBe(expectedCheckedAt);
    // Sanity delta — General's reported time actually moved from whatever
    // it was before this test's action (belt-and-braces; the equality
    // check above is the real proof).
    expect(statuses?.General?.checked_at).not.toBe(before);

    // ── Dashboard UI: force a fresh mount (README "Assertion discipline" —
    // a parked viewer shows a stale list/state) and assert the chip renders
    // the EXPECTED text derived from the actual fresh created_at (same
    // parseUtc + formatting the app itself uses — see formatCheckpointTime
    // in Dashboard.tsx and lira-100-checkpoint-timeline-timezone.spec.ts),
    // never a hardcoded/absolute time. ──
    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/"); // already on "/" — forces a same-route remount

    const expectedChipText = await appPage.evaluate((iso: string) => {
      const parseUtc = (s: string) =>
        /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)
          ? new Date(s)
          : new Date(`${s.replace(" ", "T")}Z`);
      const date = parseUtc(iso);
      const now = new Date();
      const time = date.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      const sameDay =
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate();
      if (sameDay) return time;
      const day = date.toLocaleDateString([], {
        month: "short",
        day: "numeric",
      });
      return `${day}, ${time}`;
    }, expectedCheckedAt as string);

    const card = appPage
      .locator("div.bg-slate-800.rounded-xl")
      .filter({ has: appPage.getByRole("heading", { name: "General", exact: true }) })
      .first();
    await expect(card).toBeVisible();
    const chip = card.locator("span.truncate");
    await expect(chip).toHaveText(expectedChipText);
  });
});
