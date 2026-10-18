# Tasks: Checkpoint open differences (LIRA-335)

**Input**: `specs/335-checkpoint-open-differences/` — spec.md, plan.md, research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: REQUIRED. Rule 17 says each guard is written first and seen failing on the unfixed code before the fix; record the real failure line in the task's notes. Run **affected jest only, explicit paths** (owner decision). Never run a full suite, never run e2e, never launch Electron (no Electron on the Mac).

**Lanes**: each task names its lane. Lanes own disjoint files (plan.md "Parallel lanes"), so agents in different lanes never edit the same file. A task that must touch another lane's file is listed under **Integration**, which only the orchestrator runs.

**Shared rules for every lane**:
- Read `CLAUDE.md` rules 13–31 and `docs/FEATURE_GUIDE.md` §13 before money code.
- `?` placeholders and `tenant_id` in every query.
- Use the module logger.
- No `any`.
- Use `contracts/api.md` names exactly.
- Do not commit.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [x] T001 (orchestrator) Confirm migration head is v221 in `packages/core/src/db/migrations/index.ts` and that `frontend/tests/e2e-web/lira-web-075-*` is free. Record both in `specs/335-checkpoint-open-differences/tasks.md` notes.

---

## Phase 2: Foundational (blocking all stories)

### Lane A — schema, constants, pure helper

- [x] T002 [P] (Lane A) Write the failing test `packages/core/src/utils/__tests__/checkpointDifference.test.ts`.
  - Cover `describeCheckpointDifference` for: Over open, Short open, partly resolved, fully resolved, closed Short with remainder, closed Over, closed then fully resolved (→ RESOLVED), resolved exceeding abs (clamped, open 0), and the LBP epsilon (≤1 LBP counts as 0) vs USD (≤0.01).
  - Also cover `isOpenCheckpointDifference`.
  - Run it and record the failure (module missing).
- [x] T003 (Lane A) Implement `packages/core/src/utils/checkpointDifference.ts` per `contracts/api.md` and data-model "Derived values".
  - Pure leaf: no imports beyond constants.
  - Reuse the existing epsilon. Find where `RECONCILE_EPSILON` / `MATCH_EPSILON` live; if the epsilon is private to ClosingRepository, move it to `constants/checkpointAdjustment.ts` and import it from both (rule 14).
  - Export from `packages/core/src/browser.ts` and `packages/core/src/index.ts`.
  - T002 must pass.
- [x] T004 [P] (Lane A) Add `CHECKPOINT_RESOLUTION_METHOD = "CHECKPOINT_RESOLUTION"` to `packages/core/src/constants/checkpointAdjustment.ts`, with a doc comment covering: drawer-moving, internal leg, mirrored on void, skipped on refund. Re-export it next to `CHECKPOINT_ADJUSTMENT_METHOD` in `browser.ts` (`:126-130`) and `index.ts`.
- [x] T005 (Lane A) Migration v222 `checkpoint_differences` in `packages/core/src/db/migrations/index.ts`.
  - Create both tables exactly as in data-model.md:
    - `amount REAL NOT NULL` "posted delta, signed: > 0 Over, < 0 Short"
    - `closed_at TEXT NULL`, `closed_by INTEGER NULL REFERENCES users(id)`
    - `transaction_id INTEGER NOT NULL REFERENCES transactions(id)`
    - indexes UNIQUE `(tenant_id, closing_id, drawer_name, currency_code)`, `(tenant_id, drawer_name, currency_code)`, `(tenant_id, difference_id)`, `(tenant_id, transaction_id)`
  - `down()` drops the indexes, then the tables. Follow the v217 pattern (`:14798-14833`).
  - Mirror both tables in `electron-app/create_db.sql` near `daily_closing_amounts` (`:1834`), and append `(222, 'checkpoint_differences')` to the schema_migrations seed (`:3156-3175`).
- [x] T006 [P] (Lane A) Add both tables to `RESET_WIPE_TABLES` in `packages/core/src/constants/resetTables.ts`, children before parents, and to `TENANT_SCOPED_TABLES` in `scripts/check-tenant-scoping.mjs` (`:88`). Run `constants/__tests__/resetTables.guard.test.ts`.

### Lane A — repository and checkpoint write

- [x] T007 (Lane A) Write the failing test `packages/core/src/repositories/__tests__/CheckpointDifferenceRepository.test.ts`, using the in-memory DB helpers other repository tests use. Cover:
  - (a) `createCheckpoint` with Over $50 USD and matched LBP writes exactly one difference row: amount +50, drawer General, USD.
  - (b) a Short on two drawers in one all-drawers checkpoint writes one row per real drawer, never `AGGREGATED`.
  - (c) the FR-023 fix: `daily_closing_amounts.opening_amount` equals the server as-of balance used for the delta, even when the client sent a stale `expected_amount`.
  - (d) `listForClosings` returns `CheckpointDifferenceView` with status OPEN.
  - (e) `close` on a Short USD books exactly one expense: category "Drawer shortage", `books_only`, `source_ref_table 'checkpoint_differences'`, `source_ref_id` = difference id, `expense_date` = the checkpoint `closing_date`, amount = open. No payments row and no drawer change. Status CLOSED.
  - (f) `close` on Over books nothing.
  - (g) `reopen` voids the expense and returns status OPEN.
  - (h) `close` on a non-USD/LBP currency (EUR) records closed with no expense.
  - (i) `close` with open 0 and `reopen` when not closed are refused with an error.
  - (j) a checkpoint saved before v222 data (no rows) yields `differences: []`.
  - Record the failure.
- [x] T008 (Lane A) Implement `packages/core/src/repositories/drawerShortageExpense.ts`, following `changeRoundingExpense.ts`:
  - `DRAWER_SHORTAGE_EXPENSE_CATEGORY`, `CHECKPOINT_DIFFERENCE_SOURCE_TABLE`;
  - `bookDrawerShortageExpense({ differenceId, drawerName, currencyCode, amount, closingDate, closingId, userId })`, which uses `createExpense` with `books_only: true`, `paid_by_method: "CASH"`, and description `Drawer shortage (<drawer>, checkpoint #<closingId>)`;
  - export from `repositories/index.ts`.
- [x] T009 (Lane A) Implement `packages/core/src/repositories/CheckpointDifferenceRepository.ts` (extends BaseRepository, plus the singleton getter):
  - `recordForCheckpoint`, `listForClosings` (one query for all ids plus one for resolutions, no N+1), `getById`, `close`, `reopen`;
  - `syncShortageExpense(differenceId, userId)` as a method, which `checkpointResolution.ts` will call;
  - the `ACTIVE_RESOLUTION_SQL` fragment: a resolution counts while its transaction is not voided. Read the exact voided status value from `_voidTransactionInternal` in `TransactionRepository.ts` (around `:5982`). Export it.
  - Reopen voids the linked expense through `getTransactionRepository().voidLinkedExpenses(CHECKPOINT_DIFFERENCE_SOURCE_TABLE, id, userId, { internal: true })`. The `internal` option is added in T020 by Lane B; until then call it and leave a TODO in the integration notes.
  - Status always comes from `describeCheckpointDifference`.
  - Export from `repositories/index.ts`; type-only re-export of the view types from `browser.ts`.
- [x] T010 (Lane A) In `packages/core/src/repositories/ClosingRepository.ts` `createCheckpoint` (`:449-792`):
  - step 1 stores the server balance used for the delta as `opening_amount` (FR-023; line-derived carrier rows keep the live balance);
  - after step 7, call `getCheckpointDifferenceRepository().recordForCheckpoint(closingId, adjustments)` inside the same db transaction.
  - T007 (a–c) pass.
- [x] T011 (Lane A) `packages/core/src/services/ClosingService.ts` + `validators/closing.ts`:
  - the three schemas and types from contracts;
  - `CheckpointFilters.open_only`;
  - `getCheckpointTimeline` attaches `differences` (via `listForClosings`) and `open_count`, and applies `open_only` with `isOpenCheckpointDifference`;
  - `closeCheckpointDifference`, `reopenCheckpointDifference`, `getOpenDifferencesAfter` (delegates to the engine function from contracts; until Lane B lands, import it from `./repositories/checkpointResolution` and leave a stub that throws `not implemented` only if Lane B has not created the file).
  - Export the schemas and types from `browser.ts` and `index.ts`. T007 passes.

### Lane B — engine skeleton (can start in parallel with Lane A; codes against contracts)

- [x] T012 [P] (Lane B) Write the failing test `packages/core/src/repositories/__tests__/checkpointResolution.test.ts` for the worked example:
  1. drawer General 1,000 counted;
  2. checkpoint counted 1,050 → Over 50;
  3. a cash sale of $50 saved with `transaction_time` before the checkpoint → General balance still 1,050, one `CHECKPOINT_RESOLUTION` leg −50 on the sale, one resolution row, status RESOLVED;
  4. a second checkpoint at 1,050 → delta 0, no difference row.

  Also cover:
  - a $60 sale → resolves 50, balance 1,060;
  - an expense from General with an earlier time against an Over → nothing resolved;
  - a sale with an earlier time when the first checkpoint after it matched → nothing resolved, even if a later checkpoint has an open Over;
  - no custom time → nothing resolved;
  - a split sale USD+LBP against Over USD only → only USD resolved;
  - a CUSTOMER_ACCOUNT leg → nothing;
  - a closed Short later explained by a back-timed expense → expense shrinks (void + recreate) and becomes 0 (voided) when fully explained (FR-016);
  - `getOpenDifferencesAfter({at})` returns the right differences.

  Use `testHelpers/postingAssert.ts` where it fits. Record the failure.
- [x] T013 (Lane B) Implement `packages/core/src/repositories/checkpointResolution.ts` per contracts and research R1–R2:
  - effective time = `transactions.created_at`;
  - net per drawer and currency over the transaction's drawer-affecting legs, excluding `CHECKPOINT_RESOLUTION` (reuse the `drawerAffectingPayments` fragment: export it from ClosingRepository or move it to a shared module — coordinate in integration if moving);
  - first checkpoint after the time from `daily_closing_amounts` joined to `daily_closings` (`julianday(dc.created_at) > julianday(?)`, ordered, limit 1);
  - the difference in the same currency and direction, cap = abs − active resolved (closed differences included, FR-016);
  - offset via `insertPaymentRow` + `applyDrawerDelta` (method `CHECKPOINT_RESOLUTION`, note per data-model) and a resolution row;
  - then `syncShortageExpense` for closed Shorts.
  - Module logger. NOT imported from `browser.ts` (rule 29).
  - T012 passes once Lane A's tables exist.

---

## Phase 3: User Story 1 — a re-entered missed transaction resolves the difference (P1) 🎯 MVP

**Goal**: every back-timed transaction resolves the first later checkpoint's open difference without moving the drawer twice. Void undoes it; refund does not.

**Independent test**: quickstart.md core command; the worked example holds and every flow nets to 0 on create + void.

### Tests first

- [x] T014 [P] [US1] (Lane B) Write the failing source-scan guard `packages/core/src/__tests__/checkpointResolution.wiring.guard.test.ts`. Every `repositories/*Repository.ts` that passes `transaction_time` (or `transactionTime`) into `createTransaction` must also call `resolveBackTimedDrawerMovement`, unless it is in an exported `CHECKPOINT_RESOLUTION_EXCLUSIONS` list in `checkpointResolution.ts` with a reason string. The guard prints the offending files. Run it; expect about 12 offenders.
- [x] T015 [P] [US1] (Lane B) Write the failing test `packages/core/src/repositories/__tests__/checkpointResolution.flows.test.ts`. It is table-driven (rule 28d). For each flow — POS sale (`processSale`), expense, debt repayment, exchange, financial service send and receive, recharge (telecom / top-up), custom service, maintenance checkout, loto ticket, hold money (deposit/pickup) — it must:
  - make a checkpoint with a difference in the right direction for that flow;
  - save the flow's real payload with an earlier `transaction_time`;
  - assert the drawer is unchanged by the resolved part and a resolution exists;
  - void the transaction and assert every drawer, per currency, is back to its pre-save balance and the difference is OPEN again.
  - Build payloads through each module's schema where one exists (rule 24).
- [x] T016 [P] [US1] (Lane B) Write the failing test `packages/core/src/repositories/__tests__/checkpointResolution.reversal.test.ts`:
  - a full refund of a resolving sale keeps the resolution and moves the drawer by exactly the cash refunded;
  - a partial item refund moves the drawer by the item's cash only, with the offset untouched;
  - undo-refund restores;
  - a void after a Closed · Short was shrunk grows the shortage expense back (FR-016).

### Implementation

- [x] T017 [US1] (Lane B) In `packages/core/src/repositories/TransactionRepository.ts`:
  - add `CHECKPOINT_RESOLUTION_METHOD` to `INTERNAL_LEG_METHODS` (`:297`);
  - give `_reversePayments` (`:8820`) a mode parameter. Void mirrors all legs as today; refund (`:6545`) and the session-basket item refund (`:5529`) skip `CHECKPOINT_RESOLUTION` legs. Keep `_overridableNetByCurrency` untouched.
  - After a void, call `syncShortageExpense` for every difference touched by the voided transaction's resolutions.
- [x] T018 [US1] (Lane B) In `packages/core/src/repositories/SalesRepository.ts`:
  - `_applySaleItemMoneyBack` (`:3699`) / `_itemRefundLegRows` (`:2306`) exclude `CHECKPOINT_RESOLUTION` legs;
  - undo-refund (`:3411`) is consistent.
  - `processSale` calls `resolveBackTimedDrawerMovement` at the end of its db transaction (`:662` block), after all legs.
- [x] T019 [US1] (Lane B) Add one call to `resolveBackTimedDrawerMovement({ transactionId, userId })` at the end of each flow's db transaction, after its legs and the auto `SUPPLIER_PAYMENT` / expense siblings, in:
  - `FinancialServiceRepository.ts`
  - `RechargeRepository.ts` (each path that takes `transaction_time`: `:1489`, `:1920`, `:2361`)
  - `ExpenseRepository.ts` (`:630`, `:840`, `:897`)
  - `DebtRepository.ts` (`:677`, `:1031`)
  - `ExchangeRepository.ts` (`:763`)
  - `MaintenanceRepository.ts` (`:1017`)
  - `CustomServiceRepository.ts` (`:753`)
  - `LotoTicketRepository.ts` (`:616`)
  - `HoldMoneyRepository.ts` (`:323`, `:575`)

  Call it on the parent transaction only: auto sibling rows carry the same time, so the engine must run once per user-visible transaction and net the parent's legs. If a sibling holds drawer legs, pass the parent id and include the sibling's legs. Decide per flow and comment why. T014 and T015 pass.
- [x] T020 [US1] (Lane B) Session checkout (research R7). Inspect `SessionPaymentService.ts:733-849`, `SessionCheckoutService.ts:228`, `TransactionRepository.ts:3114`.
  - Either wire the engine so offset legs are reversed by the basket reversal, with a test added to T015;
  - or add `SessionCheckoutService`/`SessionPaymentRepository` to `CHECKPOINT_RESOLUTION_EXCLUSIONS` with the reason.

  Record the decision in research.md R7.
- [x] T021 [US1] (Lane B) Shortage expense protection (FR-013):
  - `ExpenseRepository.deleteExpense` (`:1007`) and `updateMetadata` (`:1028`, category change) refuse expenses with `source_ref_table = 'checkpoint_differences'` ("Reopen the checkpoint difference instead") unless called with `{ internal: true }`;
  - `voidLinkedExpenses` (`TransactionRepository.ts:8109`) and the generic void path accept `{ internal: true }` for that bypass. Add tests to T016.
- [x] T022 [P] [US1] (Lane B) Add `CHECKPOINT_RESOLUTION_METHOD` to `PROVIDER_BOOKKEEPING_METHODS` in `packages/core/src/repositories/testHelpers/paymentSnapshotAssert.ts` (`:50`). Check `ClosingRepository.getTransactionsOnDrawerSince` (`:1292-1341`): resolution legs net into `drawer_amount`, and a transaction whose drawer movement nets to 0 is not listed. This file is Lane A's; hand the edit to integration if Lane A is still active. Run `ClosingRepository.sinceLastCount.test.ts`.

**Checkpoint**: US1 core is complete and provable by T012, T014, T015, T016.

---

## Phase 4: User Story 2 — see which differences are open (P1)

**Goal**: timeline status pills, sublines, the "Open differences only" filter and the details resolution list.

**Independent test**: quickstart.md frontend command; the timeline renders every state; the filter narrows the list.

### Transports (Lane C)

- [x] T023 [P] [US2] (Lane C) Write the failing handler test `electron-app/handlers/__tests__/closingDifferenceHandlers.test.ts`:
  - `closing:close-difference` / `closing:reopen-difference` are admin-only, validate `difference_id`, inject `userId` from auth, and return the envelope;
  - `closing:get-open-differences-after` is allowed for admin and staff, and strips `resolutions` and `closed_by_name` for staff;
  - `closing:getCheckpointTimeline` passes `open_only`.

  Mock `ClosingService` the way existing handler tests do.
- [x] T024 [US2] (Lane C) Implement in `electron-app/handlers/dbHandlers.ts`, following the `closing:create-checkpoint` pattern (`:411-477`): `requireRole`, `validatePayload`, service call, `audit`. Re-export the schemas in `electron-app/schemas/index.ts` (`:1466` pattern, zod-major cast). Add bindings to `electron-app/preload.ts` (`closing.getOpenDifferencesAfter`, `closeDifference`, `reopenDifference`) and types to `frontend/src/types/electron.d.ts`, refreshing the stale timeline type (`:2446-2470`). T023 passes.
- [x] T025 [P] [US2] (Lane C) Classify the 3 new channels in `packages/core/src/offline/channelPolicy.ts`: `READ` for the read, `ONLINE_ONLY` for close and reopen, with a reason comment. Run `electron-app/offline/__tests__/channelPolicy.complete.test.ts` and `packages/core/src/offline/__tests__/channelPolicy.test.ts`.
- [x] T026 [US2] (Lane C) Add the REST routes to `backend/src/api/closing.ts`, static paths before `/:id`:
  - `GET /differences/open-after` (requireAuth; staff stripping as in T023);
  - `POST /differences/close` and `/differences/reopen` (`requireAuth, adminGate, validateRequest(schema)`, `userId` from the JWT, `auditRest`);
  - `open_only` parsed in `GET /checkpoint-timeline` (`:290-321`).

  Write the failing test `backend/src/api/__tests__/closing.differences.test.ts` first, following existing backend route tests.
- [x] T027 [US2] (Lane C) Adapter:
  - `frontend/src/api/backendApi.ts`: `getOpenDifferencesAfter`, `closeCheckpointDifference`, `reopenCheckpointDifference` via `ipcOrHttp`, with types derived from the core schemas (rule 21); `getCheckpointTimeline` passes `open_only` and returns a typed `CheckpointRecord[]` instead of `any[]`;
  - `frontend/src/api/ElectronApiAdapter.ts`;
  - `packages/ui/src/api/types.ts` `ApiAdapter` (`:1780-1789` area).

### UI (Lane D)

- [x] T028 [P] [US2] (Lane D) Write the failing test `frontend/src/features/closing/pages/CheckpointTimeline/__tests__/CheckpointTimeline.differences.test.tsx`, using a stable module-level `mockApi` as in `CheckpointTimeline.countDisplay.test.tsx:57-69` (rule 25). It asserts:
  - an OPEN row shows today's amber "Over $50.00" with no pill;
  - RESOLVED shows the struck amount, a "Resolved" pill and the subline with the sale;
  - PARTLY_RESOLVED shows "Partly resolved · $8.00 open";
  - CLOSED shows "Closed · Short" and the expense subline;
  - matched shows "Balanced";
  - the "Open differences only" toggle calls `getCheckpointTimeline` with `open_only: true` and shows `open_count`;
  - the details window lists resolutions and "Still open" and shows Close difference… / Reopen only for admin.
- [x] T029 [US2] (Lane D) Implement in `frontend/src/features/closing/pages/CheckpointTimeline/index.tsx`, matching the approved mockups (design page section "Screens"):
  - the toggle in the filter bar after `DateRangeFilter`;
  - status rendering in `renderLine` (`:525-588`), with Tailwind classes as in the mockup;
  - the details resolution block and footer (`:780-980`).

  Replace the page's local types with core `CheckpointRecord`/`CheckpointDifferenceView` where possible. Extract a `DifferenceStatusLine` component if `index.tsx` grows past readability. Use status from the core `describeCheckpointDifference`/view only; no client recomputation (rule 14).
- [x] T030 [P] [US2] (Lane D) Add the i18n keys from contracts/api.md to `packages/ui/src/i18n/locales/en/closing.json` and `ar/closing.json` (same keys and placeholders; Arabic written properly, not transliterated). Run `node scripts/check-i18n.mjs`.

**Checkpoint**: US1 + US2 make the MVP the owner asked for.

---

## Phase 5: User Story 3 — close a difference nobody can explain (P2)

**Goal**: Close / Reopen from the details window; the Drawer shortage expense appears on the Expenses page and cannot be voided manually.

**Independent test**: CloseDifferenceDialog + HistoryModal tests; core T007 (e–i).

- [x] T031 [P] [US3] (Lane D) Write the failing test `frontend/src/features/closing/components/__tests__/CloseDifferenceDialog.test.tsx`:
  - the Short body names the amount and the day and confirms with "Close as short";
  - Over confirms with "Close as over";
  - EUR shows the no-expense note;
  - confirm calls `closeCheckpointDifference({ difference_id })` (field name taken from the schema, rule 24);
  - an error is shown on `{success:false}`;
  - Reopen calls `reopenCheckpointDifference`.
- [x] T032 [US3] (Lane D) Implement `frontend/src/features/closing/components/CloseDifferenceDialog.tsx` (mockup "Close difference window", existing modal styles) and wire it from the details footer. After success, reload the timeline (`appEvents "closing:completed"` or a direct reload).
- [x] T033 [P] [US3] (Lane D) Write the failing test `frontend/src/features/expenses/pages/Expenses/components/__tests__/HistoryModal.drawerShortage.test.tsx`: a row with `source_ref_table 'checkpoint_differences'` shows the category "Drawer shortage" (translated) and no void or edit buttons; other rows are unchanged. Then implement in `HistoryModal.tsx` (`:270-305`) and `expenseCategoryLabel.ts` (`:11-31`), and add the `expenses.json` en/ar key. Confirm the `Expense` type exposes `source_ref_table`; if not, add it in the read path (coordinate with integration if it is a core file).

---

## Phase 6: User Story 4 — hint under Transaction time (P3)

**Goal**: when a custom time is set, every form shows the open differences that money saved at that time would resolve.

**Independent test**: TransactionTimeOverride hint test; existing form tests stay green.

- [x] T034 [P] [US4] (Lane D) Write the failing test `frontend/src/shared/components/__tests__/TransactionTimeOverride.hint.test.tsx` (stable `mockApi`):
  - with a value set, it calls `getOpenDifferencesAfter({ at })` once per value and renders `hint.resolvesOver` (Over) or `hint.resolvesShort` (Short) per difference;
  - no value → no call and no line;
  - the adapter method missing or rejecting → no line and no crash;
  - an empty list → no line.
- [x] T035 [US4] (Lane D) Implement in `frontend/src/shared/components/TransactionTimeOverride.tsx`:
  - `useApi()` read through a ref (rule 25);
  - the `at` value is the ISO the component already emits;
  - the line uses the mockup's emerald style;
  - no new props, so all 16 forms get it.

  Run the existing `TransactionTimeOverride.test.tsx` plus three form tests that render it (CheckoutModal, Expenses, FinancialForm — explicit paths) to prove they stay green.

---

## Phase 7: Polish and cross-cutting

- [x] T036 [P] (Lane D) Add the leg label in `frontend/src/features/audit/transactionDisplay.ts` `legMethodLabel` (`:207`): "Checkpoint resolution · <Drawer>" (en/ar via the audit namespace). Extend `legMethodLabel.test.ts`.
- [x] T037 [P] (Lane E) Docs:
  - `docs/FEATURE_GUIDE.md`: a checkpoint section covering open differences, back-timed resolution, void vs refund, the shortage expense and reversal owners;
  - `docs/POSTING_MAP.md`: the `CHECKPOINT_RESOLUTION` leg and the Drawer shortage expense rows;
  - `current_sprint.md` LIRA-335: a "What users will notice:" line;
  - `docs/release-notes/UNRELEASED.md`: one shop-owner line under the right area heading (Checkpoints/Closing, or create one), saying "from now on" (FR-022). No ticket ids or code terms.
- [x] T038 [P] (Lane E) Write the web e2e `frontend/tests/e2e-web/lira-web-075-checkpoint-open-differences.spec.ts`, mirroring quickstart "Manual check" steps 1–5:
  - match rows by identity and assert deltas (rule 15);
  - follow the conventions of `lira-web-074-payout-roundup.spec.ts`;
  - typecheck it. **Do not run it** (owner decision).
- [x] T039 (orchestrator, Integration) Merge the seams:
  - Lane A ↔ B shared `drawerAffectingPayments` export;
  - the `voidLinkedExpenses` `internal` option;
  - the since-last-count netting (T022);
  - the `Expense.source_ref_table` read (T033);
  - any TODO from the lanes.
- [x] T040 (orchestrator) Run the gates: `yarn typecheck`, `yarn lint`, `yarn check:i18n`, `yarn check:tenant-scoping`, `yarn check:bind-arity`, `yarn check:schema-equivalence`, `node scripts/build-release-notes.cjs --check`, plus every affected jest path in quickstart.md and every pre-existing test file touched by the lanes. Measure elapsed time (rule 28a). Fix and re-run.
- [x] T041 (orchestrator) Update `current_sprint.md` LIRA-335 with: the built summary, the tests seen failing first (and any not failing-first, labelled), what was not run (e2e, desktop app), the session checkout decision, and research R11 as a follow-up. Do not commit (await owner "commit").

---

## Dependencies & execution order

- Phase 1 → Phase 2.
- Within Phase 2, Lane A and Lane B run in parallel against contracts. Lane B's tests go green only after T005 + T009 exist.
- US1 (Phase 3) depends on Phase 2.
- US2 transports (Lane C) and UI (Lane D) depend only on contracts and run alongside Phases 2–3; their tests mock the adapter and service.
- US3 core is in Lane A (T007–T009); its UI (T031–T033) is Lane D.
- US4 depends only on the adapter contract.
- Polish T036–T038 can run any time; T039–T041 run last.

## Parallel lanes (one agent each, started together)

```
Lane A: T002 → T003, T004, T005 → T006, T007 → T008 → T009 → T010 → T011
Lane B: T012 → T013, T014, T015, T016 → T017 → T018 → T019 → T020 → T021 → T022
Lane C: T023 → T024 → T025 → T026 → T027
Lane D: T028 → T029 → T030, T031 → T032, T033, T034 → T035, T036
Lane E: T037, T038
Orchestrator: T001 first; T039 → T040 → T041 last
```

## Implementation strategy

- MVP = US1 + US2: the owner's workflow comes out right, and the status is visible. US3 (close) and US4 (hint) are built in the same pass, because the lanes are parallel.
- Nothing ships until T040 is green; the owner says "commit".
