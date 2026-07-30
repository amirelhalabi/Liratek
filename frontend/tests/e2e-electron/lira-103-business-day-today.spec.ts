/**
 * E2E: LIRA-103 — "Today's" daily stats use the LOCAL (Beirut) day, not UTC.
 *
 * `ClosingRepository.getDailyStatsSnapshot()` sums today's figures with
 * `DATE(col, 'localtime') = DATE('now', 'localtime')`. A commission booked at
 * 01:00 Beirut is stored as the PREVIOUS UTC day (22:00). Pre-fix the query used
 * bare UTC `DATE(created_at) = <UTC today>`, so an early-morning transaction
 * dropped out of "today" until 03:00 local. This drives the real IPC →
 * @liratek/core → SQLite stack and proves a boundary commission is included in
 * today's profit.
 *
 * The backdated instant is built from the machine clock so its LOCAL day is
 * always today (inclusion holds on every run — the fixed behavior). It also
 * discriminates from the old UTC query except when run in the 00:00–03:00 Beirut
 * window (where the UTC day coincides); the rigorous local-vs-UTC proof lives in
 * the core unit test ClosingRepository.localBusinessDay.test.ts.
 *
 * Rule 15 (shared accumulating DB): asserts the DELTA in totalProfitUSD around a
 * single insert with a distinctive commission — never an absolute total.
 */

import { test, expect } from "./fixtures";

// Delta-based (before/after bracket each attempt's own single insert), so unlike
// marker-matching specs a retry does NOT double-count — inherit the suite's
// retries to absorb transient Electron-launch flakiness.

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
    closing: {
      getDailyStatsSnapshot: () => Promise<{ totalProfitUSD: number }>;
    };
  };
};

test.describe("LIRA-103 — daily stats use the local business day", () => {
  test("a 00:30-local commission counts in TODAY's profit (stored as the prior UTC day)", async ({
    appPage,
  }) => {
    // At offset <= 0 (UTC runners included) a local instant can never fall on an
    // EARLIER UTC day, so the local-vs-UTC gap this spec exercises does not
    // exist. The TZ-independent proof is the core unit test
    // ClosingRepository.localBusinessDay.test.ts.
    const offsetHours = -new Date().getTimezoneOffset() / 60;
    test.skip(
      offsetHours <= 0,
      `runner UTC offset ${offsetHours} gives no local/UTC day gap — see ClosingRepository.localBusinessDay.test.ts`,
    );
    const r = await appPage.evaluate(async () => {
      const w = window as unknown as Api;

      // Naive datetime is read by SQLite as UTC. Build the instant from a LOCAL
      // target — today at 00:30 local — whose UTC rendering falls on the
      // PREVIOUS UTC day whenever the runner is east of UTC. `DATE(col,
      // 'localtime')` then maps it back to today.
      //
      // The old form hardcoded "yesterday(UTC) 22:00", which is today 01:00
      // only at Beirut's +3. On a UTC runner that instant IS yesterday locally,
      // so it could never be in today's local day and the delta was always 0 —
      // this spec failed in CI while passing on a Beirut laptop. The guard
      // below skips where no gap can exist.
      const now = new Date();
      const localTarget = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        0,
        30,
        0,
      );
      const boundary = localTarget.toISOString().slice(0, 19).replace("T", " ");

      const before = (await w.api.closing.getDailyStatsSnapshot())
        .totalProfitUSD;

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

      const after = (await w.api.closing.getDailyStatsSnapshot())
        .totalProfitUSD;

      // The OMT flow computes its own commission; read it back and confirm the
      // backdate was honored (created_at on the prior UTC day).
      const row = seed.id ? await w.api.omt.getById(seed.id) : null;

      return {
        error: seed.error ?? null,
        ok: seed.success !== false,
        boundary,
        commission: row?.commission ?? null,
        createdAt: row?.created_at ?? null,
        delta: after - before,
      };
    });

    expect(r.error).toBeNull();
    expect(r.ok).toBe(true);
    // Backdate honored — the row's UTC day is the day before its local day.
    expect(r.createdAt).toContain(r.boundary.slice(0, 10));
    // A positive commission the flow computed…
    expect(r.commission).toBeGreaterThan(0);
    // …included in TODAY's profit despite its UTC day being yesterday
    // (local-day bucketing).
    expect(r.delta).toBeCloseTo(r.commission as number, 2);
  });
});
