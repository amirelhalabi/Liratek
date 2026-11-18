# Tasks: Profits — anonymous baskets count as Walk-in (LIRA-393)

**Input**: plan.md, research.md, data-model.md, quickstart.md (no contracts — internal reporting change)

## Phase 1 — Failing-first tests (rule 17)

- [x] T001 [US1] Write `packages/core/src/services/__tests__/ProfitService.anonymousBasketWalkIn.test.ts` By Client cases with literal names (no import of the new module): two name-only baskets `Client1`/`Client2` + a real client "Client2" with id → one Walk-in row, one real Client2 row, Σ unchanged; edge names `Client 7`, `client7`, `Client7b`, `Client` keep their own rows.
- [x] T002 [US2] Same file: drill-down counterpart for a `Client3` basket — MTC recharge + Katsh SEND → "Walk-in".
- [x] T003 Run T001–T002 against unfixed code; record the RED output.

## Phase 2 — Shared definition (FR-001)

- [x] T004 Create `packages/core/src/constants/anonymousSessionName.ts` (prefix, `nextAnonymousSessionName`, `isAnonymousSessionName`, `isAnonymousSessionNameSql`); export from `index.ts` and `browser.ts`.
- [x] T005 [P] `packages/core/src/constants/__tests__/anonymousSessionName.test.ts`: table-driven JS-regex vs SQL-GLOB agreement on the edge-case list + generator cases.

## Phase 3 — US1 By Client fold (FR-002)

- [x] T006 `ProfitRepository.getByClient`: outer `GROUP BY` and outer display name fold name-only auto-names into "Walk-in" (no new `?`).

## Phase 4 — US2 drill-down counterpart (FR-003)

- [x] T007 Add `counterpartLabel(name, phone, clientId?)` in `anonymousSessionName.ts`; replace every inline `… || "Walk-in"` counterpart in `ProfitService.ts`.

## Phase 5 — Generator (FR-001a, FR-005 frontend)

- [x] T008 Frontend test block in `CustomerSessionButton.test.tsx`: Walk-In click with today `Client1`,`Client3` → `startSession({customer_name:"Client2"})`, name accepted by `isAnonymousSessionName`; a renamed name not matched. Run RED.
- [x] T009 `CustomerSessionButton.tsx` uses `nextAnonymousSessionName`.

## Phase 6 — Verify

- [x] T010 Run quickstart suites + `browserEntryIsNodeFree` guard; core/backend/frontend typecheck (timed); `prettier --check` on the shared files.
- [x] T011 Log unattended decisions in spec.md; propose release note + sprint block in the report.
