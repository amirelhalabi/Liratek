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
  test("a 01:00-Beirut commission counts in TODAY's profit (stored as the prior UTC day)", async ({
    appPage,
  }) => {
    const r = await appPage.evaluate(async () => {
      const w = window as unknown as Api;

      // Naive datetime is read by SQLite as UTC. Build "yesterday(UTC) 22:00",
      // which `DATE(col,'localtime')` maps to today 01:00 Beirut → LOCAL day =
      // today, UTC day = yesterday. `new Date(y, m, d-1)` handles month/year
      // rollover.
      const now = new Date();
      const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      const pad = (n: number) => String(n).padStart(2, "0");
      const boundary = `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())} 22:00:00`;

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
