# LIRA-196 — "today" means the server's day, not the shop's

**Priority: MEDIUM** · **Status: TODO, not started** · **Type: money reporting / dual-transport (CLAUDE.md rule 27)**
**Written 2026-09-21**, split out of the `lira-web-027` investigation so the narrow fix could ship on its own.

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
