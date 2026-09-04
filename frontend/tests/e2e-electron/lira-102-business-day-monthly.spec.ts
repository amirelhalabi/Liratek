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
 *
 * ⚠ RE-DERIVED FOR LIRA-159 (rule 17 — the OLD assertion below is the exact
 * bug LIRA-159 fixes, so it MUST now fail; this is the sibling treatment
 * `lira-103-business-day-today.spec.ts` already got for LIRA-158/D14, commit
 * `8a868fe3`). `getMonthlyPL`'s commission arms now compose
 * `getRealizedCommissionTotals` (LEGACY) + `getSupplierCommissionTotals`
 * (AT_SETTLEMENT) instead of a raw `SUM(financial_services.commission)`. An
 * OMT SEND is born `commission_model = 1` (AT_SETTLEMENT,
 * `FinancialServiceRepository.ts` ~:1496 `isOmtWhishTransfer`): its
 * creation-time `commission` (still computed and stored, read back below) is
 * DEFERRED until the batch is SETTLED and recognised in the SETTLEMENT's own
 * month — never the transaction's own month (owner decisions D7/D10, cash
 * basis). This spec never settles the row it creates, so the OLD assertion
 * — "the estimate lands in the LOCAL transaction month" — is now WRONG by
 * construction; it is replaced with "an unsettled row contributes 0 to BOTH
 * months," commented inline with LIRA-159 + D7/D10 so a future reader does
 * not "fix" it back (CLAUDE.md rule 20's own precedent: a deliberate
 * behavior change, not a regression).
 *
 * The settlement-day recognition this change actually introduces is proven
 * on its own terms by `lira-159-monthly-pl-settled-commission.spec.ts`
 * (`SupplierRepository.settleTransactions()` stamps its `created_at` via
 * SQLite's own `datetime('now')` with no backdating hook, so — exactly like
 * lira-103's own doc comment on the identical constraint for the daily-stats
 * sibling — there is no way to place a SETTLEMENT at this spec's 00:30-local
 * boundary instant here).
 *
 * ⚠ THIS FILE'S ZERO-DELTA COMMISSION ASSERTIONS ARE HALF A PAIR, NOT A
 * COMPLETE PROOF ON THEIR OWN. `r.julDelta`/`r.junDelta` both asserting
 * `toBeCloseTo(0, 2)` passes identically whether the commission arm is
 * CORRECTLY deferring to the settlement month, or whether commission
 * reporting is simply broken and always returns 0 — this file cannot tell
 * those two cases apart. The POSITIVE proof that a settled, operator-ENTERED
 * commission actually reaches `getMonthlyPL` lives exclusively in
 * `lira-159-monthly-pl-settled-commission.spec.ts`:
 *   - test 2, "settling recognises the ENTERED commission (USD), not the
 *     auto-calculated estimate, in the settlement month" — proves the USD
 *     arm is alive and reads the ENTERED figure, not the estimate;
 *   - test 3, "an LBP-entered settlement commission moves
 *     serviceCommissionsLBP by the exact entered figure" — same proof for
 *     the LBP arm.
 * These two files are therefore a PAIR, and the dependency is load-bearing:
 * if `lira-159-monthly-pl-settled-commission.spec.ts` (or its tests 2/3
 * specifically) is ever deleted, skipped, or weakened, THIS file keeps
 * passing over a commission arm that could be completely dead and nobody
 * would learn that from a green run here. Anyone removing that positive
 * coverage must move an equivalent positive assertion here (or into another
 * file) rather than just deleting it — do not "fix" this file's zero-delta
 * assertions with an `expect(...).not.toBe(0)`-style guard instead; an
 * unsettled row genuinely SHOULD contribute 0 here, so that would be a
 * false-positive detector, not a real one.
 *
 * This file's ORIGINAL purpose — proving `getMonthlyPL` buckets by the LOCAL
 * month, not UTC — is NOT silently lost: it is relocated onto the `expenses`
 * arm below, which LIRA-159 never touched (`dateRange("expense_date")`,
 * unchanged) and which — unlike `financial_services.created_at`/
 * `transaction_time` — is written from a REQUIRED, non-defaulted Zod field
 * (`AddExpenseSchema.expense_date: z.string().min(8)`, `ExpenseRepository
 * .createExpense`'s INSERT binds `data.expense_date` verbatim, no COALESCE)
 * so the backdate cannot silently no-op the way an optional field can. The
 * rigorous, TZ-independent proof of the underlying LOCAL-vs-UTC month
 * mechanism remains a core unit test (`ClosingRepository.localBusinessDay
 * .test.ts` covers the day-level primitive `monthBounds`/`dateRange` share).
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
    expenses: {
      add: (d: {
        description: string;
        category: string;
        paid_by_method?: string;
        amount_usd: number;
        amount_lbp: number;
        expense_date: string;
      }) => Promise<{ success?: boolean; id?: number; error?: string }>;
    };
    financial: {
      getMonthlyPL: (
        month: string,
      ) => Promise<{ serviceCommissionsUSD: number; expensesUSD: number }>;
    };
  };
};

// LIRA-159 — distinctive, file-unique amount for the relocated
// local-vs-UTC-month proof (the `expenses` arm). Rule 15: the delta pattern
// below never depends on this value being globally unique across the shared
// DB (before/after brackets THIS spec's own single insert), but a
// deliberately unusual figure keeps it easy to eyeball in a failure diff.
const E2E_EXPENSE_AMOUNT_USD = 37.53;

test.describe("LIRA-102 — monthly P&L uses the local business month", () => {
  test("a 00:30-local commission on the 1st counts in the LOCAL month, not the UTC month", async ({
    appPage,
  }) => {
    test.skip(
      !HAS_MONTH_GAP,
      `runner offset gives no local/UTC month gap (local ${LOCAL_MONTH} === utc ${UTC_MONTH}) — see ClosingRepository.localBusinessDay.test.ts`,
    );
    const r = await appPage.evaluate(
      async ({ boundary, localMonth, utcMonth, expenseAmount }) => {
        const w = window as unknown as Api;

        const julBefore = await w.api.financial.getMonthlyPL(localMonth);
        const junBefore = await w.api.financial.getMonthlyPL(utcMonth);

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

        // LIRA-159 — the file's ORIGINAL local-vs-UTC-month proof, relocated
        // onto the `expenses` arm (see the file's own doc comment for why):
        // `expense_date` is a REQUIRED field written verbatim, unlike the OMT
        // row's now-deferred commission.
        const expenseSeed = await w.api.expenses.add({
          description: "LIRA-159 e2e month-boundary expense",
          category: "E2E_TEST",
          paid_by_method: "CASH",
          amount_usd: expenseAmount,
          amount_lbp: 0,
          expense_date: boundary,
        });

        const julAfter = await w.api.financial.getMonthlyPL(localMonth);
        const junAfter = await w.api.financial.getMonthlyPL(utcMonth);

        // Read the OMT row back: the flow computes its own commission, and we
        // need to confirm transaction_time was honored (not defaulted to now).
        const row = seed.id ? await w.api.omt.getById(seed.id) : null;

        return {
          error: seed.error ?? null,
          ok: seed.success !== false,
          commission: row?.commission ?? null,
          createdAt: row?.created_at ?? null,
          julDelta: julAfter.serviceCommissionsUSD - julBefore.serviceCommissionsUSD,
          junDelta: junAfter.serviceCommissionsUSD - junBefore.serviceCommissionsUSD,
          expenseError: expenseSeed.error ?? null,
          expenseOk: expenseSeed.success !== false,
          julExpenseDelta: julAfter.expensesUSD - julBefore.expensesUSD,
          junExpenseDelta: junAfter.expensesUSD - junBefore.expensesUSD,
        };
      },
      {
        boundary: BOUNDARY_UTC,
        localMonth: LOCAL_MONTH,
        utcMonth: UTC_MONTH,
        expenseAmount: E2E_EXPENSE_AMOUNT_USD,
      },
    );

    expect(r.error).toBeNull();
    expect(r.ok).toBe(true);
    expect(r.expenseError).toBeNull();
    expect(r.expenseOk).toBe(true);

    // transaction_time was honored — the row really sits on the derived UTC
    // instant (not "now"), so the month boundary is genuinely exercised.
    expect(r.createdAt).toContain(BOUNDARY_UTC_DATE);

    // LIRA-159 (D7/D10, cash-basis settlement recognition) — an unsettled
    // AT_SETTLEMENT (commission_model = 1) row's creation-time estimate is
    // DEFERRED until settlement and recognised in the SETTLEMENT's own
    // month, never the transaction's own month. This row is never settled
    // here, so it must contribute ZERO to BOTH months' serviceCommissionsUSD.
    // OLD (pre-LIRA-159) assertions this replaces — now WRONG by
    // construction, since they asserted the estimate landed in the
    // transaction's own LOCAL month, exactly the behavior D7/D10 removed:
    //   expect(r.julDelta).toBeCloseTo(r.commission as number, 2);
    //   expect(r.junDelta).toBeCloseTo(0, 2);
    // The flow still computes a positive estimate (kept as a sanity check
    // that the row was created correctly)…
    expect(r.commission).toBeGreaterThan(0);
    // …but it reaches NEITHER month's recognised commission.
    expect(r.julDelta).toBeCloseTo(0, 2);
    expect(r.junDelta).toBeCloseTo(0, 2);

    // This file's ORIGINAL purpose — LOCAL month, not UTC month — lives on
    // via the `expenses` arm (untouched by LIRA-159): the SAME boundary
    // instant, as this expense's `expense_date`, lands in the LOCAL month …
    expect(r.julExpenseDelta).toBeCloseTo(E2E_EXPENSE_AMOUNT_USD, 2);
    // … and NOT in the UTC month.
    expect(r.junExpenseDelta).toBeCloseTo(0, 2);
  });
});
