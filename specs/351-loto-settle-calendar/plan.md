# Implementation Plan: Loto on Settle Account (day calendar)

**Branch**: `351-loto-settle-calendar` (work on `main`) | **Date**: 2026-10-29 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/351-loto-settle-calendar/spec.md`

## Summary

Turn Loto into a day-calendar supplier. The calendar, allocator, coverage, credits, custom time and waive already exist (LIRA-343/345); Loto's ticket and prize ledger rows are already DAY rows on their shop day, so prizes net per day for free. The work is: (1) a data-only migration that stamps the rows already paid through settled checkpoints so the calendar starts clean without changing the balance; (2) three shared gates (`settlesByDay`, `billsStayOnTickList`, `calendarTakesCommission`) set for Loto; (3) retire the two untied payment paths (Loto page checkpoint settling, Pay / Receive cashflow) on both transports; (4) UI follows; (5) tests, release notes, What's new card.

## Technical Context

**Language/Version**: TypeScript (strict) — `packages/core`, `electron-app`, `backend`, `frontend`
**Primary Dependencies**: existing settle stack (`SupplierRepository._accountRows` / `settleAccount`, `supplier_settlement_coverage`, `buildDaySelections`, `AccountSettleSheet`)
**Storage**: SQLite (better-sqlite3 / SQLCipher); migration v226 (data-only backfill)
**Testing**: jest (core, electron handlers, backend, frontend), web Playwright e2e; desktop e2e not runnable on the owner's Mac
**Target Platform**: Electron desktop (IPC) and web (REST on Fly) — both required
**Project Type**: monorepo desktop + web POS
**Performance Goals**: backfill completes within a normal app start on a shop with years of Loto history (single UPDATE per row class)
**Constraints**: balance must not change (SC-001); no Node built-ins in browser-reachable core modules (rule 29)
**Scale/Scope**: one supplier type; ~6 core files, ~4 transport files, 3 frontend screens

## Constitution Check

| Principle | Status |
|---|---|
| I. One core, two transports | ✅ Logic in core; IPC + REST refusals mirror each other; UI via `useApi()` |
| II. Layer boundaries | ✅ Backfill SQL in the migration; refusals in services; no SQL in services |
| III. Contracts defined once | ✅ Gates stay single functions in `utils/settlesByDay.ts`; no new schemas |
| IV. Money integrity | ✅ No new money rows from the backfill; settlement uses the existing posting/reversal owners; create + void nets to 0 tested; FEATURE_GUIDE §13 walked in tasks |
| V. Data and security | ✅ Admin-only settle unchanged; tenant-scoped migration |
| VI. Testing | ✅ Failing-first guards for each behaviour; affected tests only, with the owner's OK |
| VII. Code quality | ✅ Dead `SettlementDrawerIntegration.tsx` removed |

Gate: PASS. Re-checked after design: PASS (no new tables; one data migration).

## Project Structure

### Documentation (this feature)

```text
specs/351-loto-settle-calendar/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/settle-and-refusals.md
└── checklists/requirements.md
```

### Source Code (touched)

```text
packages/core/src/
├── db/migrations/index.ts                 # v226 backfill (+ down)
├── utils/settlesByDay.ts                  # LOTO gates
├── repositories/SupplierRepository.ts     # commission refusal for Loto settle; _accountRows uses gates
├── repositories/LotoCheckpointRepository.ts / services/LotoService.ts  # settle paths refuse
├── services/SupplierService.ts            # cashflow refusal for LOTO
└── repositories/TransactionRepository.ts  # (verify) ticket/prize void with calendar coverage → credit
electron-app/handlers/lotoHandlers.ts      # refusal envelopes
backend/src/api/loto.ts                    # refusal envelopes
frontend/src/features/suppliers/pages/Suppliers/index.tsx   # no Settle tab for Loto
frontend/src/features/loto/components/SettlementVerification.tsx (+ Loto page)  # settle actions removed
frontend/src/features/loto/components/SettlementDrawerIntegration.tsx  # delete (dead)
frontend/tests/e2e-web/lira-web-0xx-loto-settle-calendar.spec.ts
docs/FEATURE_GUIDE.md, docs/release-notes/UNRELEASED.md, frontend/public/whats-new/<version>/
```

**Structure Decision**: existing monorepo layout; no new modules.

## Phases

1. **Backfill (US3)** — migration v226 + test (stamped set, untouched set, balance equality, open-queue sum = balance). Must land before the gates flip.
2. **Gates + settle (US1, US2, US5)** — LOTO in `settlesByDay`; tick-list and commission gates; refuse non-zero commission for Loto; tests: netting example (343,980 − 500,000 → Loto owes 156,020), settle COLLECT/PAY, CASH → General, overpay → credit, waive cap, settlement void reopens.
3. **Retire old paths (US4, FR-013)** — refusals in core + IPC + REST; UI removal on both pages; delete dead component.
4. **Voids** — confirm calendar-covered ticket void → credit (house rule) and checkpoint-settled refusal unchanged; tests.
5. **Ship** — FEATURE_GUIDE entry, release notes, What's new card with a real screenshot (web e2e), sprint ticket, quickstart manual check on the test tenant then Cornertech.

## Complexity Tracking

None — no constitution violations.
