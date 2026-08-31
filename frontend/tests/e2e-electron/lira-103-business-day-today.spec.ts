/**
 * E2E: LIRA-103 — "Today's" daily stats use the LOCAL (Beirut) day, not UTC.
 *
 * `ClosingRepository.getDailyStatsSnapshot()` sums today's figures with
 * `DATE(col, 'localtime') = DATE('now', 'localtime')`. A profit-bearing row
 * booked at 01:00 Beirut is stored as the PREVIOUS UTC day (22:00). Pre-fix
 * the query used bare UTC `DATE(created_at) = <UTC today>`, so an
 * early-morning transaction dropped out of "today" until 03:00 local. This
 * drives the real IPC → @liratek/core → SQLite stack and proves a boundary
 * transaction is included in today's profit.
 *
 * The backdated instant is built from the machine clock so its LOCAL day is
 * always today (inclusion holds on every run — the fixed behavior). It also
 * discriminates from the old UTC query except when run in the 00:00–03:00
 * Beirut window (where the UTC day coincides); the rigorous local-vs-UTC
 * proof lives in the core unit test ClosingRepository.localBusinessDay.test.ts.
 *
 * Rule 15 (shared accumulating DB): asserts the DELTA in totalProfitUSD around
 * a single insert with a distinctive margin — never an absolute total.
 *
 * ⚠ REWORKED FOR LIRA-158 (COMMISSION_AT_SETTLEMENT_PLAN.md follow-up, D14).
 * This spec used to seed an OMT SEND (`financial_services`, commission = the
 * auto-calc estimate) and assert the Closing snapshot moved by that row's own
 * `commission` on the transaction's own day. LIRA-158 deliberately changed
 * that: an OMT SEND is now born `commission_model = 1`, and D14 moved its
 * commission recognition to the SETTLEMENT's own day/user, not the
 * transaction's — `FinancialServiceRepository`'s creation-time profit stamp
 * is zeroed for the commission term (kept only for kept-change), so the old
 * assertion now correctly reads a 0 delta on the transaction day. That is
 * NOT a regression — see CLAUDE.md rule 15/17 and the plan's §2 (D14) for the
 * decision of record.
 *
 * Settling the row instead (to catch the NEW settlement-day recognition) does
 * not preserve THIS spec's own local-day proof: `SupplierRepository
 * .settleTransactions()` stamps the settlement's `created_at` via SQLite's
 * `datetime('now')` with no backdating hook, so there is no way to place the
 * settlement itself at the 00:30-local boundary instant this spec needs to
 * discriminate local-day bucketing from UTC-day bucketing. That settlement-day
 * recognition (plus D17's cashless-defers-on-uncovered-debt refinement) is
 * covered on its own terms by `lira-158-deferred-settlement-commission.spec.ts`
 * and the core `SupplierRepository`/`ProfitRepository` unit tests instead.
 *
 * So this spec keeps its ONE real job — proving `getDailyStatsSnapshot()`
 * buckets by the LOCAL day — on a profit source LIRA-158 never touched: a
 * `recharges` sale. `ClosingRepository`'s `rechargeProfit` query
 * (`SUM(price - cost)` over `recharges`, gated only by `todayLocal
 * ("created_at")`) still recognises on the recharge's OWN `created_at` day,
 * exactly like the OMT commission did before LIRA-158 — a byte-for-byte
 * equivalent substitution of the backdated instrument, not a weakening of
 * what's being proven. `recharge:process`'s `transaction_time` still accepts
 * a backdated instant (validated by the core `createRechargeSchema`, which —
 * unlike the OMT/WHISH desktop schema's local, unvalidated copy — requires a
 * STRICT ISO-8601 datetime, so the boundary instant below is built with
 * `toISOString()`, not the OMT spec's old space-separated form).
 */

import { test, expect } from "./fixtures";

// Delta-based (before/after bracket each attempt's own single insert), so unlike
// marker-matching specs a retry does NOT double-count — inherit the suite's
// retries to absorb transient Electron-launch flakiness.

type Api = {
  api: {
    recharge: {
      process: (
        d: Record<string, unknown>,
      ) => Promise<{ success?: boolean; id?: number; error?: string }>;
    };
    transactions: {
      getBySource: (
        sourceTable: string,
        sourceId: number,
      ) => Promise<{ profit_usd: number; created_at: string } | null>;
    };
    closing: {
      getDailyStatsSnapshot: () => Promise<{ totalProfitUSD: number }>;
    };
  };
};

test.describe("LIRA-103 — daily stats use the local business day", () => {
  test("a 00:30-local recharge margin counts in TODAY's profit (stored as the prior UTC day)", async ({
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
      // Unlike the old OMT-based version of this spec, `recharge:process`'s
      // `transaction_time` is validated by the STRICT core `createRechargeSchema`
      // (`z.string().datetime()`), so this must stay a real ISO-8601 string
      // (`toISOString()`) — the old space-separated "YYYY-MM-DD HH:MM:SS" form
      // (valid only against the OMT/WHISH desktop schema's own unvalidated
      // local copy) would fail validation here.
      const now = new Date();
      const localTarget = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        0,
        30,
        0,
      );
      const boundary = localTarget.toISOString();

      const before = (await w.api.closing.getDailyStatsSnapshot())
        .totalProfitUSD;

      // type: "VOUCHER" (not "CREDIT_TRANSFER") so no SMS cost is deducted from
      // the margin — `price - cost` lands on the transaction's profit stamp
      // and on ClosingRepository's `rechargeProfit` query byte-for-byte alike.
      const seed = await w.api.recharge.process({
        provider: "MTC",
        type: "VOUCHER",
        amount: 100,
        cost: 100,
        price: 105,
        currency: "USD",
        paid_by_method: "CASH",
        transaction_time: boundary,
      });

      const after = (await w.api.closing.getDailyStatsSnapshot())
        .totalProfitUSD;

      // The recharge flow computes its own profit stamp; read it back off the
      // wrapping unified transaction (source_table = 'recharges') to confirm
      // the backdate was honored (created_at on the prior UTC day) and to
      // assert against the FLOW's own figure, not a locally recomputed one.
      const row = seed.id
        ? await w.api.transactions.getBySource("recharges", seed.id)
        : null;

      return {
        error: seed.error ?? null,
        ok: seed.success !== false,
        boundary,
        profit: row?.profit_usd ?? null,
        createdAt: row?.created_at ?? null,
        delta: after - before,
      };
    });

    expect(r.error).toBeNull();
    expect(r.ok).toBe(true);
    // Backdate honored — the row's UTC day is the day before its local day.
    expect(r.createdAt).toContain(r.boundary.slice(0, 10));
    // A positive margin the flow computed…
    expect(r.profit).toBeGreaterThan(0);
    // …included in TODAY's profit despite its UTC day being yesterday
    // (local-day bucketing).
    expect(r.delta).toBeCloseTo(r.profit as number, 2);
  });
});
