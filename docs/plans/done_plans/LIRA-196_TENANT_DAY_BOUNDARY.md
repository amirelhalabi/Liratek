# LIRA-196 — "today" means the server's day, not the shop's

**Priority: MEDIUM** · **Status: DONE (re-audited and closed 2026-10-02)** · **Type: money reporting / dual-transport (CLAUDE.md rule 27)**
**Written 2026-09-21**, split out of the `lira-web-027` investigation so the narrow fix could ship on its own.

## Closing note (2026-10-02)

Re-audited per rule 27's detection recipe (grep `packages/core/src` request paths for `'now'`,
`'localtime'`, `date('now'`/`datetime('now'`, `new Date()`, `Date.now()`, bare `localDay()`
defaults, `toLocaleString`, and any `DATE(col, 'localtime')` outside `reportingTimeFragments.ts`).

**The "Suggested order" §1 owner decision below turned out to be moot.** LIRA-237
(`8cf9361d`, after this ticket was written) converted the bulk of the ~43 queries across all 9
originally-scoped repositories (`ClosingRepository`, `CustomerSessionRepository`,
`CustomServiceRepository`, `ExchangeRepository`, `FinancialServiceRepository`,
`ProductRepository`, `ProfitRepository`, `SalesRepository`) plus `CarrierLineRepository` and
`VoucherRepository` using the **per-request client offset** (`X-Client-Tz-Offset` →
`clientTzOffsetMinutes()` → `reportingTimeFragments.ts`'s `isToday`/`isThisMonth`/`localDayExpr`/
`dateRange`, or `utils/requestDay.ts`'s `clientDay()`) — not a stored tenant timezone column. That
sidesteps the owner decision entirely: the browser already tells the server its own offset on every
request. `AuditRepository` was separately fixed by LIRA-243 (switched to plain `CURRENT_TIMESTAMP`).

**One instance LIRA-237 missed, found by this re-audit and fixed:**
`ExpenseRepository.getTodayExpenses()` — `WHERE DATE(expense_date) = DATE('now')`, with **no**
`'localtime'` modifier at all (worse than the original bug class: wrong on desktop too, not just
web). Fixed by reusing `isToday("expense_date")` from `reportingTimeFragments.ts` (rule 14) instead
of a fifth hand-rolled predicate. Guarded by
`packages/core/src/repositories/__tests__/ExpenseRepository.webTodayTzOffset.test.ts`
(failing-first, rule 17 — recorded red: 3/3 failed on the old predicate, including the
`matchesToday`-conditional desktop-fallback test, because the old code had no `'localtime'` shift to
fall back to).

`TransactionRepository`'s `julianday('now') - julianday(due_date)` debt-aging buckets were checked
and are **not** a rule-27 bug: both operands are absolute instants (UTC), so the subtraction is
timezone-independent — there is no calendar-day truncation to disagree about.

Verification: `npx tsc --noEmit` in `packages/core` (10s, 0 errors); `yarn workspace @liratek/core
test` from repo root — **454 suites / 4420 tests, all green**; `node scripts/check-tenant-scoping.mjs`
and `node scripts/check-bind-arity.mjs` both clean (0 violations). Two pre-existing tests
(`ExpenseRepository.refundedRead.test.ts`, `PostRefactorVerification.test.ts`) had fixtures that
inserted `expense_date` as a bare UTC date (`DATE('now')` / a `toISOString().split("T")[0]` string,
losing all time-of-day information) — unrepresentative of real rows, which always carry a full
instant. Those fixtures were corrected to a full timestamp; they now pass against the fixed code for
the right reason instead of passing by coincidence against the old one.

**Verdict: no rule-27 day-boundary bug remains in `packages/core/src` reachable from a request
path.** Closing.

## What was already fixed, and why that is not this

Six predicates compared a UTC `created_at` against a localtime `'now'`, so the "today" analytics
returned **0** for three hours after local midnight. Fixed 2026-09-21 (five in
`FinancialServiceRepository.getAnalytics`, one in `CustomServiceRepository:803`), guarded by
`packages/core/src/utils/__tests__/localtimeDateComparison.guard.test.ts`.

That restored the convention the other ~37 date queries already follow:

```sql
WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime')
```

**This ticket is about that convention itself.**

## The problem

`'localtime'` is the **server's** timezone, not the shop's. Same code, two answers:

| | `'localtime'` resolves to | A sale at 01:00 Beirut counts as |
| --- | --- | --- |
| **Desktop** — the shop's own machine, Beirut | UTC+3 | today ✅ |
| **Web** — Fly container, Frankfurt, no `TZ` set | UTC | **yesterday** ❌ |

So on the web app a Beirut shop's day silently rolls over at **03:00 local**. Everything booked
between midnight and 3am lands on the previous day in every report that uses this pattern — and
because both sides of the comparison shift together, it is never zero and never throws. It just
quietly attributes money to the wrong day. That is harder to notice than the bug already fixed.

This is exactly the class CLAUDE.md rule 27 documents, and the fourth-plus instance of it.

## Evidence

Measured against the web e2e DB at 00:44 local / 21:44 UTC on 2026-09-21:

```
created_at stored:        2026-09-20 21:42:51   (UTC)
DATE('now')             = 2026-09-20            (UTC   — what Fly sees)
DATE('now','localtime') = 2026-09-21            (Beirut — what the shop means)
```

The two servers genuinely disagree about what day it is. Neither is "wrong"; the code just never
says whose day it means.

## Scope

~43 date comparisons across 10 repositories: `AuditRepository`, `ClosingRepository`,
`CustomerSessionRepository`, `CustomServiceRepository`, `ExchangeRepository`,
`FinancialServiceRepository`, `ProductRepository`, `ProfitRepository`, `SalesRepository`
(+ `utils/localDate.ts`). Migrations are historical SQL and out of scope.

## The fix

Rule 27's prescribed shape, and the plumbing already exists — `utils/requestDay.ts` (`clientDay()`),
`utils/localDate.ts` (`localDay()`), used this way by `690dc2b0` and `1ad3f8d9`:

**The client supplies its own day, the schema constrains it, and the server's is only a fallback**
(`data.client_day ?? localDay()`). Desktop is unchanged because its server already is the shop.

**Do NOT set `TZ` on the Fly machine.** Rule 27 is explicit: it buries this symptom while leaving
every other tenant in a different zone wrong, trading a visible bug for an invisible one. It also
stops working the moment there is a second tenant outside UTC+3.

### Suggested order

1. Decide where the tenant's timezone lives — a `tenants` column is the obvious home, and it is the
   real prerequisite for a second tenant anywhere. **This is an owner decision, not a code one.**
2. Convert the read paths that drive money reporting first: `ProfitRepository`, `ClosingRepository`,
   `FinancialServiceRepository`. Those are the ones an operator reconciles against.
3. Extend the existing guard test to fail on a bare `'localtime'` in a request-path query once a
   tenant-day helper exists to replace it.

## Acceptance

A transaction booked at 01:00 Beirut appears under that Beirut day in every report, on **both**
transports, with the Fly server still running in UTC. Prove it failing-first (rule 17) by pinning
the clock inside the 00:00–03:00 window — the bug is invisible at every other hour, which is
exactly why it survived this long.

## Why MEDIUM and not HIGH

No money is lost or mis-posted — the ledger is correct and every total reconciles. This is an
attribution error in reporting, bounded to a three-hour nightly window, and today there is one
tenant whose shop and desktop server share a timezone. It becomes **HIGH the day a tenant runs in a
different zone from the server**, because then it is wrong around the clock rather than for three
hours.
