/**
 * E2E: LIRA-102 — Monthly P&L buckets by the LOCAL (Beirut) month, not UTC.
 *
 * `FinancialRepository.getMonthlyPL(month)` sums commissions where
 * `strftime('%Y-%m', created_at, 'localtime') = ?`. A service created at
 * 00:30 Beirut on the 1st of a month is stored as the PREVIOUS UTC month
 * (21:30 on the last day). Pre-fix the query used bare UTC `strftime('%Y-%m',
 * created_at)`, so that commission landed in the wrong month; the Dashboard now
 * also asks for `localMonth()`. This proves, end-to-end through the real IPC →
 * @liratek/core → SQLite stack, that a month-boundary commission is counted in
 * the LOCAL month and NOT the UTC month.
 *
 * Determinism: fixed months (2026-07 local / 2026-06 UTC), not "now", so the
 * discrimination holds on any run. The OMT flow computes its own commission, so
 * the row's actual `commission` is read back and used as the expected delta
 * (the test asserts the BUCKET, not a hard-coded profit figure). Runs under
 * Beirut TZ (the desktop app's machine zone).
 *
 * Rule 15 (shared accumulating DB): asserts DELTAS around a single insert —
 * never absolute month totals (other specs write to the current month too).
 */

import { test, expect } from "./fixtures";

// Delta-based (before/after bracket each attempt's own single insert), so unlike
// marker-matching specs a retry does NOT double-count — inherit the suite's
// retries to absorb transient Electron-launch flakiness.

// created_at is stored verbatim; SQLite reads a naive datetime as UTC. This UTC
// instant is 2026-06-30 22:00 → 2026-07-01 01:00 in Beirut (+3): UTC month June,
// LOCAL month July. That gap is the whole point.
const BOUNDARY_UTC = "2026-06-30 22:00:00";
const LOCAL_MONTH = "2026-07";
const UTC_MONTH = "2026-06";

type Api = {
  api: {
    omt: {
      addTransaction: (
        d: Record<string, unknown>,
      ) => Promise<{ success?: boolean; id?: number; error?: string }>;
      getById: (
        id: number,
      ) => Promise<{ commission: number; created_at: string } | null>;
    };
    financial: {
      getMonthlyPL: (
        month: string,
      ) => Promise<{ serviceCommissionsUSD: number }>;
    };
  };
};

test.describe("LIRA-102 — monthly P&L uses the local business month", () => {
  test("a 00:30-Beirut commission on the 1st counts in the LOCAL month, not the UTC month", async ({
    appPage,
  }) => {
    const r = await appPage.evaluate(
      async ({ boundary, localMonth, utcMonth }) => {
        const w = window as unknown as Api;

        const julBefore = (await w.api.financial.getMonthlyPL(localMonth))
          .serviceCommissionsUSD;
        const junBefore = (await w.api.financial.getMonthlyPL(utcMonth))
          .serviceCommissionsUSD;

        const seed = await w.api.omt.addTransaction({
          provider: "OMT",
          serviceType: "SEND",
          amount: 100,
          currency: "USD",
          commission: 5,
          omtServiceType: "INTRA",
          paidByMethod: "CASH",
          transaction_time: boundary,
        });

        const julAfter = (await w.api.financial.getMonthlyPL(localMonth))
          .serviceCommissionsUSD;
        const junAfter = (await w.api.financial.getMonthlyPL(utcMonth))
          .serviceCommissionsUSD;

        // Read the row back: the OMT flow computes its own commission, and we
        // need to confirm transaction_time was honored (not defaulted to now).
        const row = seed.id ? await w.api.omt.getById(seed.id) : null;

        return {
          error: seed.error ?? null,
          ok: seed.success !== false,
          commission: row?.commission ?? null,
          createdAt: row?.created_at ?? null,
          julDelta: julAfter - julBefore,
          junDelta: junAfter - junBefore,
        };
      },
      { boundary: BOUNDARY_UTC, localMonth: LOCAL_MONTH, utcMonth: UTC_MONTH },
    );

    expect(r.error).toBeNull();
    expect(r.ok).toBe(true);

    // transaction_time was honored — the row really sits on the UTC June 30
    // instant (not "now"), so the month boundary is genuinely exercised.
    expect(r.createdAt).toContain("2026-06-30");

    // The commission is a positive amount the flow computed…
    expect(r.commission).toBeGreaterThan(0);
    // …it lands in the LOCAL month (July) …
    expect(r.julDelta).toBeCloseTo(r.commission as number, 2);
    // … and NOT in the UTC month (June). Pre-fix these were swapped.
    expect(r.junDelta).toBeCloseTo(0, 2);
  });
});
