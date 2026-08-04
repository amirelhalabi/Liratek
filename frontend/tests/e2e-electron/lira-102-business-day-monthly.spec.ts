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
// Derived from the RUNNER's actual UTC offset, not hardcoded to Beirut (+3).
// The old constants ("2026-06-30 22:00:00" → local month 2026-07) silently
// encoded a machine east of UTC: on a UTC runner that instant's local month is
// June, so the July delta was always 0 and this spec failed in CI while passing
// on a Beirut laptop. Build the instant from a LOCAL target instead, so the
// local-vs-UTC month gap is real on any positive-offset machine.
//
// Local target: the 1st of the current local month at 00:30. `new Date(y, m, 1,
// 0, 30)` is a local-time constructor, so its UTC rendering is the same instant
// expressed in UTC — which lands in the PREVIOUS month whenever offset > 0.
const LOCAL_TARGET = (() => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 30, 0);
})();
const pad2 = (n: number) => String(n).padStart(2, "0");
/** Naive "YYYY-MM-DD HH:MM:SS" in UTC — how SQLite reads a bare datetime. */
const BOUNDARY_UTC = LOCAL_TARGET.toISOString().slice(0, 19).replace("T", " ");
const LOCAL_MONTH = `${LOCAL_TARGET.getFullYear()}-${pad2(LOCAL_TARGET.getMonth() + 1)}`;
const UTC_MONTH = BOUNDARY_UTC.slice(0, 7);
/** The UTC calendar date of that instant — asserted below to prove the backdate. */
const BOUNDARY_UTC_DATE = BOUNDARY_UTC.slice(0, 10);
// At offset <= 0 (UTC runners included) a local instant can never fall in an
// EARLIER UTC month, so there is no boundary to exercise and the whole premise
// is unconstructible. The rigorous, TZ-independent proof lives in the core unit
// test ClosingRepository.localBusinessDay.test.ts — this spec only adds the
// end-to-end IPC → core → SQLite path on machines where the gap exists.
const HAS_MONTH_GAP = LOCAL_MONTH !== UTC_MONTH;

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
  test("a 00:30-local commission on the 1st counts in the LOCAL month, not the UTC month", async ({
    appPage,
  }) => {
    test.skip(
      !HAS_MONTH_GAP,
      `runner offset gives no local/UTC month gap (local ${LOCAL_MONTH} === utc ${UTC_MONTH}) — see ClosingRepository.localBusinessDay.test.ts`,
    );
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

    // transaction_time was honored — the row really sits on the derived UTC
    // instant (not "now"), so the month boundary is genuinely exercised.
    expect(r.createdAt).toContain(BOUNDARY_UTC_DATE);

    // The commission is a positive amount the flow computed…
    expect(r.commission).toBeGreaterThan(0);
    // …it lands in the LOCAL month (July) …
    expect(r.julDelta).toBeCloseTo(r.commission as number, 2);
    // … and NOT in the UTC month (June). Pre-fix these were swapped.
    expect(r.junDelta).toBeCloseTo(0, 2);
  });
});
