---
description: "Task list for LIRA-351 — Loto on Settle Account (day calendar)"
---

# Tasks: Loto on Settle Account (day calendar)

**Input**: `specs/351-loto-settle-calendar/` — plan.md, spec.md, research.md, data-model.md, contracts/settle-and-refusals.md, quickstart.md

**Tests**: REQUIRED by the project (CLAUDE.md rule 17): every guard test is written first and seen failing on the unfixed code; affected tests only, and only with the owner's OK to run them.

**Paths**: monorepo — `packages/core/src`, `electron-app`, `backend/src`, `frontend/src`, `frontend/tests/e2e-web`.

## Phase 1: Setup

- [ ] T001 Read `docs/FEATURE_GUIDE.md` §13 and note, per item (legs, IN/OUT, ledger, profit, void path, session branch), what the Loto settle path reuses from Settle Account, in `specs/351-loto-settle-calendar/research.md` (append "§13 walk")
- [ ] T002 Confirm the last migration entry in `packages/core/src/db/migrations/index.ts` (v225 at planning time) and reserve the next number for the backfill

---

## Phase 2: Foundational (blocks all stories)

**Purpose**: the history must be closed before the calendar is switched on for Loto, or every old sale would show as open.

- [ ] T003 [US3] Write the failing-first test `packages/core/src/db/migrations/__tests__/v226.lotoCheckpointBackfill.test.ts`: tickets + prizes in a settled checkpoint get `settlement_id` stamped; tickets in an unsettled checkpoint and never-checkpointed tickets stay NULL; refunded rows untouched; old Pay / Receive rows untouched; checkpoint-waive `DISCOUNT` rows stamped; Loto ledger balance identical before/after (to the last LBP); `down()` clears exactly the stamped set
- [ ] T004 [US3] Implement migration v226 in `packages/core/src/db/migrations/index.ts` per `data-model.md` "Backfill" (data-only; stamp = the checkpoint settlement's `SETTLEMENT` ledger row id when resolvable via `loto_checkpoints.settlement_id` → `loto_settlements` → its transaction → ledger row, else the row's own id); tenant-scoped; `down()` re-derives and clears the same set
- [ ] T005 [US3] Note the data-only migration version in `electron-app/create_db.sql` if the file tracks the schema version (no schema change)

**Checkpoint**: backfill proven; balance unchanged.

---

## Phase 3: User Story 1 — Pay Loto for the days owed (P1) 🎯 MVP

**Goal**: Suppliers → Loto → Settle Account works with the day calendar.

**Independent Test**: two open Loto days; settle the older one; it closes, the newer stays open, balance drops by exactly that day.

- [ ] T006 [P] [US1] Failing-first: extend `packages/core/src/utils/__tests__/settlesByDay.test.ts` — `settlesByDay({provider:"LOTO"})` is true, `billsStayOnTickList` false, `calendarTakesCommission` false for LOTO
- [ ] T007 [US1] Implement the three gates in `packages/core/src/utils/settlesByDay.ts` (LOTO true; tick list and commission false for LOTO)
- [ ] T008 [P] [US1] Failing-first core test `packages/core/src/repositories/__tests__/SupplierRepository.lotoSettleByDay.test.ts`: queue lists Loto ticket rows per shop day at sale − commission; settle the older of two days by cash (PAY) → covered, drawer General LBP −amount, balance −amount; oldest-first part-pay; overpay → Loto credit; a non-zero `commission` on a Loto settlement is refused
- [ ] T009 [US1] In `packages/core/src/repositories/SupplierRepository.ts` (amount-first settle) refuse a non-zero commission for the Loto supplier with a plain message; confirm `_accountRows` excludes nothing for Loto via the gates (no Loto special case beyond the gates)
- [ ] T010 [P] [US1] Failing-first frontend test `frontend/src/features/suppliers/pages/Suppliers/__tests__/Suppliers.lotoSettleAccount.test.tsx`: Loto selected → Settle Account button, no Pay / Receive tab, no Settle tick-list tab
- [ ] T011 [US1] In `frontend/src/features/suppliers/pages/Suppliers/index.tsx` hide the "Settle" tab for a supplier whose bills do not stay on a tick list and that is not an account member (Loto), keeping it for Katsh / Whish; the Settle Account button follows `settlesByDay`

**Checkpoint**: MVP — Loto can be settled by day on both transports.

---

## Phase 4: User Story 2 — Prizes net within their day (P1)

**Independent Test**: 3 × 120,000 tickets (343,980 owed) + a 500,000 prize on Monday → Loto owes the shop 156,020; settling COLLECT closes it.

- [ ] T012 [US2] Failing-first: add to `SupplierRepository.lotoSettleByDay.test.ts` the netting case (Monday shows −156,020, i.e. Loto owes the shop) and the COLLECT settle that closes it with General LBP +156,020
- [ ] T013 [US2] Fix anything T012 exposes in `SupplierRepository._accountRows` / allocation so `CASH_PRIZE` rows net per day (expected: no change needed — R1)

---

## Phase 5: User Story 3 — The past is already settled (P1)

(Implemented in Phase 2; this phase verifies the calendar end-to-end.)

- [ ] T014 [US3] Failing-first: in `SupplierRepository.lotoSettleByDay.test.ts`, seed a settled checkpoint (via `LotoCheckpointRepository.settleCheckpoint` on the pre-feature path), run the v226 migration, assert its tickets/prizes are not in the open queue and the open-queue sum per currency equals the Loto ledger balance; an unsettled checkpoint's rows are open on their own days; an old Pay / Receive row shows as an ACCOUNT credit

---

## Phase 6: User Story 4 — One place to settle Loto (P2)

**Independent Test**: no checkpoint settle action on the Loto page; old paths refused on both transports.

- [ ] T015 [P] [US4] Failing-first core tests: `packages/core/src/services/__tests__/LotoService.settleRetired.test.ts` (settle checkpoint, settle batch, mark settled → `{success:false}` with the message from `contracts/settle-and-refusals.md`) and `packages/core/src/services/__tests__/SupplierService.lotoCashflowRefused.test.ts` (cashflow for the Loto supplier refused; paper Add Credit / Debt still accepted)
- [ ] T016 [US4] Implement the refusals in `packages/core/src/services/LotoService.ts` (or `LotoCheckpointRepository.ts` entry points) and `packages/core/src/services/SupplierService.ts` (`recordSupplierCashflow` for provider LOTO)
- [ ] T017 [P] [US4] Failing-first transport tests: `electron-app/handlers/__tests__/lotoHandlers.settleRetired.test.ts` and `backend/src/api/__tests__/lotoSettleRetired.api.test.ts` (IPC-identical envelope, HTTP 200)
- [ ] T018 [US4] Make `electron-app/handlers/lotoHandlers.ts` and `backend/src/api/loto.ts` return the service's refusal unchanged (no extra logic); update `backend/src/api/__tests__/lotoSettleForwarding.api.test.ts` expectations (rule 24: assert the refusal, not the old forwarding)
- [ ] T019 [P] [US4] Failing-first frontend test `frontend/src/features/loto/components/__tests__/SettlementVerification.settleRetired.test.tsx`: checkpoint totals still shown, no settle / settle-batch action; rewrite `SettlementVerification.batchSettle.test.tsx` and `SettlementVerification.lira310Waive.test.tsx` into guards that the settle actions are absent (rule 24)
- [ ] T020 [US4] Remove the settle actions from `frontend/src/features/loto/components/SettlementVerification.tsx` (keep totals / checkpoint list); delete dead `frontend/src/features/loto/components/SettlementDrawerIntegration.tsx`; drop now-unused adapter calls only if nothing else uses them (leave transport functions; they now return the refusal)

---

## Phase 7: Voids (house rule, US1/US3)

- [ ] T021 [P] [US1] Failing-first core test `packages/core/src/repositories/__tests__/TransactionRepository.lotoCalendarVoid.test.ts`: a ticket on a calendar-settled day can be voided and its covered share becomes Loto credit (↺); a ticket in a pre-feature settled checkpoint is still refused; voiding the Loto settlement reopens its day and reverses the drawer leg and any waive; create + void nets to 0 per currency on drawer, ledger and profit
- [ ] T022 [US1] Fix anything T021 exposes in `packages/core/src/repositories/TransactionRepository.ts` (expected: `_assertLotoTicketVoidable` unchanged; credit via the existing LIRA-343 path)

---

## Phase 8: User Story 5 — Waive (P3)

- [ ] T023 [US5] Failing-first: in `SupplierRepository.lotoSettleByDay.test.ts`, pay 340,000 + waive 3,980 on a 343,980 day → closes; a waive above 450,000 LBP refused (`SHORTFALL_MAX`)
- [ ] T024 [US5] Fix anything T023 exposes (expected: none — existing waive)

---

## Phase 9: Polish & cross-cutting

- [ ] T025 Web e2e `frontend/tests/e2e-web/lira-web-0xx-loto-settle-calendar.spec.ts` (next free number): sell 3 tickets, pay a 500,000 prize, Suppliers → Loto → Settle Account, settle the day COLLECT, assert drawer delta and the day settled; save a landscape screenshot for What's new
- [ ] T026 [P] `docs/FEATURE_GUIDE.md`: Loto settles on the calendar; checkpoint settling and Pay / Receive retired for Loto; backfill note
- [ ] T027 [P] Release notes in `docs/release-notes/UNRELEASED.md` (Suppliers / Loto lines) + "What's new" card with the T025 screenshot under `frontend/public/whats-new/<next version>/`; run `node scripts/build-release-notes.cjs --check`
- [ ] T028 Rebuild + sync core (`packages/core` build, copy dist to `node_modules/@liratek/core/dist`); `yarn typecheck`; lint changed files; affected tests (owner OK first)
- [ ] T029 Update `current_sprint.md` LIRA-351 (status, what users will notice, tests proven failing-first)
- [ ] T030 After the owner pushes: quickstart manual check on the test tenant, then Cornertech (balance before = after; calendar sum + credit = balance; report any per-shop difference)

---

## Dependencies & order

- Phase 2 (backfill) → before T007 flips the gate in production code (land both in the same commit at least).
- US1 (T006–T011) is the MVP; US2, US3 verification, US5 reuse it.
- US4 (retire old paths) is independent of US2/US5 but must ship in the same release as US1 (otherwise two ways to pay Loto).
- Voids (T021–T022) after US1.
- Polish last.

## Parallel opportunities

- T006, T008, T010 (different files) in parallel; T015, T017, T019 in parallel.
- T026 / T027 in parallel with each other.

## Implementation strategy

MVP = Phases 2–3 (backfill + gates + Suppliers page) behind one commit; then US4 retirement in the same release; then voids, waive check, e2e and docs. Ship only after the owner OKs the affected test run and the push.
