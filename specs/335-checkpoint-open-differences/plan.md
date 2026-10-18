# Implementation Plan: Checkpoint open differences

**Branch**: `335-checkpoint-open-differences` (work on `main`; ticket LIRA-335) | **Date**: 2026-10-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/335-checkpoint-open-differences/spec.md`

## Summary

Each checkpoint now records its posted correction per drawer and currency as an **open difference** (new table). When any money flow saves a transaction whose time (Set custom time, or an offline event time) is before a checkpoint of a drawer it moved, one shared core step, `resolveBackTimedDrawerMovement`, posts an offsetting `CHECKPOINT_RESOLUTION` leg on that same transaction, capped at what is still open in that direction. The drawer is not raised twice, and a resolution row links the transaction to the difference.

A void mirrors the offset leg, which undoes the resolution. A refund skips it, because the counted cash was real.

Admins can **Close** what is left. A Short books a books-only "Drawer shortage" expense on the checkpoint's day; an Over records nothing. **Reopen** voids it.

Screens:
- the timeline gets status pills and an "Open differences only" filter;
- the details window gets the resolution list and Close/Reopen;
- `TransactionTimeOverride` gets a time-driven hint.

Desktop and web share every layer.

## Technical Context

**Language/Version**: TypeScript 5 (strict), Node 22

**Primary Dependencies**: React 19, Zod, better-sqlite3 / SQLCipher, Express (backend), Electron 31, react-i18next

**Storage**: SQLite. Migration v222 adds 2 tables (data-model.md). Reuses `payments`, `drawer_balances`, `expenses` and `transactions`.

**Testing**: jest (core, electron-app handlers, backend, frontend). **Affected files only, explicit paths** (owner decision 2026-10-18). Web e2e spec written and typechecked, not run.

**Target Platform**: Electron desktop and the web app (Vercel + Fly)

**Project Type**: monorepo desktop + web app

**Performance Goals**: the resolution step costs one indexed lookup per drawer and currency touched, and only when the transaction is back-timed. The timeline loads differences for the listed checkpoints in one query, with no N+1.

**Constraints**: offline replay must stay correct (effective time = `transactions.created_at`). Nothing new is reachable from `browser.ts` except the pure helper and types (rule 29). Dates are client-supplied where they matter (rule 27): the hint's `at` comes from the form, and `expense_date` comes from the stored checkpoint `closing_date`.

**Scale/Scope**:
- 1 migration and 2 new core modules plus 1 helper;
- about 12 flow repositories get one call each;
- void/refund changes in TransactionRepository and SalesRepository;
- 3 new endpoints plus 1 extended read;
- 4 frontend surfaces;
- en/ar strings.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | How this plan complies | Status |
|---|---|---|
| I. One core, two transports | Engine, close/reopen and reads live in core. IPC and REST call the same `ClosingService`. Adapter uses `ipcOrHttp`. The hint's time comes from the client. The engine is server-only and is not imported by `browser.ts`; `utils/checkpointDifference.ts` is a pure leaf. | ✅ |
| II. Layer boundaries | SQL only in `CheckpointDifferenceRepository` / `checkpointResolution.ts`. `ClosingService` orchestrates. Handlers and routes only validate, authorize and call. | ✅ |
| III. Contracts once | Schemas in `validators/closing.ts`. Adapter types are `z.input` of them. Active-resolution predicate is one named fragment. Status is derived by one pure function used by core and UI. The extended timeline read has no schema today (raw filters); adding `open_only` is parsed as a boolean on both transports. Three-way key diff (rule 23) is done in the task. | ✅ |
| IV. Money integrity | FEATURE_GUIDE §13 is walked in the tasks. Offsets are built from the transaction's net drawer-affecting legs (IN and OUT netted once, never iterating return legs in a branch). Every new row has a reversal owner (data-model.md). Create + void nets to 0 per drawer and currency, proven per flow. The auto expense is `is_auto` via `source_ref` (rule 26). | ✅ |
| V. Data and security | `?` placeholders. `tenant_id` on both tables and in every query; tables added to `check-tenant-scoping.mjs`. Close/reopen are admin only on both transports. id/created_at/updated_at on both tables. Migration in both files. | ✅ |
| VI. Testing | Guard tests are written first and seen failing, per lane. Payload names come from the schema. **Exception, owner-approved:** the web e2e is written but not run (owner chose "affected jest only"). The deviation is recorded here and in the sprint ticket. | ⚠️ justified |
| VII. Code quality | Strict, no `any` (the timeline's `checkpoints?: any[]` adapter type is replaced by `CheckpointRecord`). Module loggers. `api` read through a ref in the hint (rule 25), with a stable mock in tests. | ✅ |

Post-design re-check: no new violations. Session checkout coverage is decided in a task, with an explicit exclusion path (research R7).

## Project Structure

### Documentation (this feature)

```text
specs/335-checkpoint-open-differences/
├── spec.md
├── plan.md            # this file
├── research.md        # R1–R11 decisions
├── data-model.md      # tables, derived values, state machine, reversal owners
├── quickstart.md      # affected-test commands + manual check
├── contracts/api.md   # fixed names for parallel lanes
├── checklists/requirements.md
└── tasks.md           # /speckit-tasks
```

### Source Code (repository root)

```text
packages/core/src/
├── db/migrations/index.ts                         # v222
├── constants/checkpointAdjustment.ts              # + CHECKPOINT_RESOLUTION_METHOD
├── constants/resetTables.ts                       # + 2 tables
├── utils/checkpointDifference.ts                  # NEW pure helper (browser-safe)
├── repositories/CheckpointDifferenceRepository.ts # NEW
├── repositories/checkpointResolution.ts           # NEW engine (server-only)
├── repositories/drawerShortageExpense.ts          # NEW writer (changeRoundingExpense pattern)
├── repositories/ClosingRepository.ts              # differences on create, FR-023, timeline read, since-last-count
├── repositories/TransactionRepository.ts          # INTERNAL_LEG_METHODS, _reversePayments mode, void → sync
├── repositories/SalesRepository.ts                # item refund skips offsets; processSale calls engine
├── repositories/{FinancialService,Recharge,Expense,Debt,Exchange,Maintenance,CustomService,LotoTicket,HoldMoney}Repository.ts  # one engine call each
├── services/ClosingService.ts                     # new service methods
├── validators/closing.ts                          # 3 schemas
├── offline/channelPolicy.ts                       # 3 channels
├── browser.ts / index.ts                          # exports
└── repositories/testHelpers/paymentSnapshotAssert.ts
electron-app/{create_db.sql, handlers/dbHandlers.ts, schemas/index.ts, preload.ts}
backend/src/api/closing.ts
scripts/check-tenant-scoping.mjs
frontend/src/
├── api/{backendApi.ts, ElectronApiAdapter.ts}, types/electron.d.ts
├── features/closing/pages/CheckpointTimeline/index.tsx (+ components split out)
├── features/closing/components/CloseDifferenceDialog.tsx   # NEW
├── shared/components/TransactionTimeOverride.tsx           # hint
├── features/expenses/pages/Expenses/{components/HistoryModal.tsx, expenseCategoryLabel.ts}
└── features/audit/transactionDisplay.ts                    # leg label
packages/ui/src/{api/types.ts, i18n/locales/{en,ar}/{closing,expenses}.json}
frontend/tests/e2e-web/lira-web-075-checkpoint-open-differences.spec.ts   # written, not run
docs/{FEATURE_GUIDE.md, POSTING_MAP.md, release-notes/UNRELEASED.md}, current_sprint.md
```

**Structure Decision**: the existing monorepo layout. Lanes (tasks.md) split along file ownership so parallel agents never edit the same file.

## Parallel lanes

| Lane | Owns | Depends on |
|---|---|---|
| A — Core data | migration + create_db.sql, `CheckpointDifferenceRepository`, `utils/checkpointDifference.ts`, `drawerShortageExpense.ts`, ClosingRepository (create/timeline/since/FR-023), ClosingService, validators, constants, resetTables, tenant-scoping script, browser/index exports | contracts only |
| B — Engine + flows | `checkpointResolution.ts`, the flow repositories' one-line calls, TransactionRepository (internal legs, reverse mode, void → sync, manual-void guard), SalesRepository item refund, ExpenseRepository guards, paymentSnapshotAssert, wiring guard test | Lane A tables/repo (code against contracts; integrate after A lands) |
| C — Transports | dbHandlers, electron schemas, preload, electron.d.ts, backend closing routes, channelPolicy, backendApi, ElectronApiAdapter, ui `ApiAdapter` types | contracts only |
| D — Frontend | timeline, details, CloseDifferenceDialog, TransactionTimeOverride hint, HistoryModal, expenseCategoryLabel, transactionDisplay label, en/ar strings | contracts only (mock adapter in tests) |
| E — Docs + e2e | FEATURE_GUIDE, POSTING_MAP, release notes, sprint ticket, web e2e spec (not run) | contracts only |

The integration pass (orchestrator) runs after all lanes: typecheck, lint, static gates, the affected suites in quickstart.md, and fixes at the seams.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| One call per flow, not one chokepoint | No shared posting point exists (research R1) | A per-leg hook cannot net IN and change legs; a commit hook does not exist. A source-scan guard enforces the calls. |
| Web e2e not run | Owner chose "affected jest only" | n/a: owner decision; the spec is written and typechecked for a later run |
