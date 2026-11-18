# Implementation Plan: Profits — anonymous baskets count as Walk-in

**Branch**: `393-profits-walkin-baskets` (built on `main` in place) | **Date**: 2026-11-18 | **Spec**: [spec.md](./spec.md)

## Summary

The Sessions page names an unnamed basket `Client<N>`. Profits › By Client groups name-only rows by that label, so one row per basket number appears as if it were a customer. Fix in reporting only:

1. One leaf module `packages/core/src/constants/anonymousSessionName.ts` owns the pattern: prefix, `nextAnonymousSessionName(existing)`, `isAnonymousSessionName(name)` and the SQL twin `isAnonymousSessionNameSql(expr)` (GLOB, case-sensitive, no bind params).
2. `ProfitRepository.getByClient` folds name-only `Client<N>` groups into "Walk-in" at the OUTERMOST `GROUP BY` only. Inner arms (sale/FS/kept-change/settlement/pending/orphan/extra-charge) keep matching on the raw stored name, so no money is lost; the outer merge just sums those groups into the Walk-in row.
3. `ProfitService` drill-down builders read the counterpart through one helper `counterpartLabel(name, phone, clientId?)`.
4. `CustomerSessionButton.tsx` builds the name with `nextAnonymousSessionName`.

## Technical Context

**Language/Version**: TypeScript 5 (strict) · **Primary Dependencies**: better-sqlite3, React 19 · **Storage**: SQLite (no migration; FR-004) · **Testing**: jest (core real-schema harness via `create_db.sql` + `runMigrations`; frontend RTL) · **Target Platform**: desktop (Electron) + web (Fly backend) — both run the same core query, so dual transport is automatic · **Project Type**: monorepo · **Constraints**: no new `?` placeholders in `getByClient` (bind-arity); browser entry stays Node-free (rule 29); other agents edit `ProfitRepository.ts`/`ProfitService.ts` concurrently — surgical edits only.

## Constitution Check

| Rule | Status |
|------|--------|
| 13 services no SQL | PASS — SQL fragment lives in the leaf module, used only by the repository; service uses the JS predicate |
| 14 one definition | PASS — pattern defined once (JS regex + SQL GLOB in the same module, kept in agreement by a table-driven test running both) |
| 17 failing-first | PASS — core tests written with literal `'Client2'`/`'Walk-in'` and run RED before the fix |
| 19/27 dual transport | PASS — pure core change; no request-path clock/locale use |
| 29 browser leaf | PASS — new module has no imports; guard test run |
| 30 release note | Proposed text in report (orchestrator writes UNRELEASED.md) |
| 31 copied values | N/A — no stored copy added; data not rewritten |

## Project Structure

```text
packages/core/src/constants/anonymousSessionName.ts            (new)
packages/core/src/constants/__tests__/anonymousSessionName.test.ts (new: JS ↔ SQL agreement)
packages/core/src/index.ts, browser.ts                           (export)
packages/core/src/repositories/ProfitRepository.ts               (getByClient outer GROUP BY only)
packages/core/src/services/ProfitService.ts                      (counterpart lines only)
packages/core/src/services/__tests__/ProfitService.anonymousBasketWalkIn.test.ts (new)
frontend/src/features/sessions/components/CustomerSessionButton.tsx
frontend/src/features/sessions/components/__tests__/CustomerSessionButton.test.tsx (new describe block)
```

## Complexity Tracking

None.
