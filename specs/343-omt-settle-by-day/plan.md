# Implementation Plan: OMT settlement by day

**Branch**: `343-omt-settle-by-day` (work on `main`, ticket LIRA-343) | **Date**: 2026-10-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/343-omt-settle-by-day/spec.md`

## Summary

- **What users get**: Settle Account for the OMT account opens on a month calendar. Each day shows whether it is settled, partly paid or unpaid, and what is left per currency. The user picks days (the default is every open day before today), can untick single transfers inside a day, and pays. Only the picked days are settled.
- **Credits**:
  - Account credits (earlier extra, settlement commission credits, old Pay / Receive) sit on no day. The user sets how much of them to use ("Use OMT credit [x] of [total]", pre-filled with what is needed, 0 when OMT rejects it). A "Remove credit" action is a follow-up ticket.
  - Day credits (receives, OMT App cash-outs) are used only when their day is picked.
- **How**: no schema change and no stored days.
  - The queue builder gets a "range" mode, so a month's rows (settled or not) come from the same definition as the open queue.
  - Every row carries a server-computed `shop_day`.
  - One generic pure util turns rows into days.
  - The sheet sends the existing `selections` payload plus `include_account_credits`.
  - The allocator gains an `account_credits` input.
- **Old history**: "Settle old history up to D" is a no-money settlement through the same path.
- **Undo and void, no exception** (owner): any settlement can be undone and any paid transfer voided. Later settlements never change; what they relied on becomes an account row ("you owe OMT $X" / OMT credit). The LIRA-322 newest-first and covered-void refusals are removed for OMT accounts (research R12).
- **Generic by design** (owner 2026-10-26): `settleDays` (core) and `SettleCalendar` / day-details (frontend) know nothing about OMT, so other suppliers, partners and client debts can reuse them later (see "Rollout").
- Details: [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md). Mock: https://claude.ai/artifact/VWkboFyYcNH7ZcFzSLxdf4.

## Technical Context

**Language/Version**: TypeScript (strict), Node 22 / Electron 31, React 19

**Primary Dependencies**:
- `@liratek/core`: SupplierRepository, FinancialServiceRepository (exported `NOT_REFUNDED_SQL`), TransactionRepository (void message), `utils/accountSettleAllocation.ts`, `reportingTimeFragments.ts` (`localDayExpr`)
- `@liratek/ui` (ApiAdapter types)
- Express backend, Electron IPC, TanStack Query

**Storage**: SQLite. **No migration** (latest stays v224). Reads only from `financial_services`, `supplier_ledger`, `supplier_settlement_coverage`, `transactions`.

**Testing**: core jest (in-memory DB via `testHelpers/omtAccountDb.ts`), frontend jest (RTL), backend jest (routes), web e2e (Playwright). Desktop e2e may be edited but is not run on the owner's Mac. Ask before running suites; affected files only.

**Target Platform**: desktop app and the multi-tenant web app

**Project Type**: monorepo, desktop + web off one core

**Performance Goals**: the month read for one account (a few hundred rows; estimate) returns in under 300 ms on the test shop, with one batched coverage read

**Constraints**:
- per currency always;
- one part-paid row per currency;
- create + undo = 0 per ledger per currency;
- `settleDays` / `buildDaySelections` / allocator browser-safe (rule 29);
- the shop day is computed by the server only (rule 27);
- no change to the legacy whole-row payload

**Scale/Scope**:
- 3 new pure utils (`settleDays`, `buildDaySelections`, credit classification) + 1 allocator extension;
- 1 repository builder refactor + 2 reads;
- 1 schema key + 2 read schemas;
- 2 IPC channels + 2 REST routes + adapter / preload / types;
- 1 void message;
- the sheet rewrite to a calendar (generic `SettleCalendar` + `SettleDayDetails`);
- ~8 new test files, 1 web e2e;
- release notes + What's new card.

## Constitution Check

*GATE: checked before Phase 0 and again after Phase 1.*

| Principle | How this plan meets it | Status |
| --- | --- | --- |
| I. One core, two transports | New reads go through `SupplierService` on both IPC and REST. The sheet uses `useApi()` only. One payload builder (`buildDaySelections`) for all modes (normal, old history) (rule 22). The shop day comes from `localDayExpr` (client offset on web, `'localtime'` on desktop), never from the server clock (rule 27). The new utils take `shop_day` strings and import no `requestDay.ts` (rule 29; guard test). | Pass |
| II. Layer boundaries | SQL only in `SupplierRepository` (range builder, day detail). The service maps month → UTC window and forwards. Grouping and allocation are pure utils. Handlers and routes hold no logic. | Pass |
| III. Contracts once | `include_account_credits` is added to the shared schema; preload / adapter types derive from `z.input` (rule 21). Rule 23 three-way diff before wiring, and the repository reads the key in the same change. The credit classification and "account row" source are each defined once (rule 14). Read envelopes are as existing. | Pass |
| IV. Money integrity | Walk the FEATURE_GUIDE §13 checklist:<br>• **Legs**: IN legs only toward coverage; change through the shared loop (rule 16).<br>• **Reversal owner**: account-credit coverage uses source `NETTING`, reversed by the settlement undo. The new balancing account row written by an undo / void belongs to that undo / void transaction (research R12; rule 20). Seeded invariant test: balance = Σ open remaining after any create / undo / void sequence.<br>• **`is_auto`**: no new auto rows (rule 26).<br>• **Tests**: create + undo = 0 per currency, failing-first (rule 17).<br>• **Client propagation**: no client field (rule 11 n/a). | Pass |
| V. Data and security | `?` only; `tenant_id` on every new query; the reads keep the existing gate of `account-unsettled`; settle stays `admin` on both transports; actor from session / JWT. | Pass |
| VI. Testing | Owner tables as failing-first allocator tests. Invariant test range = queue. Web e2e by identity and deltas. Schema-derived payload names (rule 24). | Pass |
| VII. Code quality | Strict TS, module loggers, `api` through a ref in the new hooks, stable `useApi` mocks (rule 25). | Pass |

**Post-design re-check: pass.** No Complexity Tracking entries.

## Project Structure

### Documentation (this feature)

```text
specs/343-omt-settle-by-day/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R11
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── calendar-reads.md
│   └── settle-account-days.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks (not yet)
```

### Source Code (repository root)

```text
packages/core/src/
├── utils/
│   ├── settleDays.ts                    # NEW generic rows → days (browser-safe)
│   ├── settleDaySelections.ts           # NEW buildDaySelections (one payload builder)
│   ├── accountCreditKind.ts             # NEW DAY / ACCOUNT classification (+ SQL twin name)
│   ├── accountSettleAllocation.ts       # EXTEND account_credits
│   └── __tests__/ (settleDays, settleDaySelections, accountSettleAllocation.accountCredits)
├── repositories/
│   ├── SupplierRepository.ts            # range builder, shop_day, getAccountDayDetail, include_account_credits
│   ├── FinancialServiceRepository.ts    # export NOT_REFUNDED_SQL
│   ├── TransactionRepository.ts         # undo / void with no exception (R12)
│   └── __tests__/ (lira343MonthRows, lira343SettleDays)
├── services/SupplierService.ts          # getAccountMonthRows, getAccountDayDetail
├── validators/supplier.ts               # include_account_credits, month/day read schemas
└── browser.ts / index.ts                # export new utils + types

electron-app/handlers/supplierHandlers.ts   # suppliers:account-month-rows, suppliers:account-day-detail
electron-app/preload.ts                     # bindings (types from core)
backend/src/api/suppliers.ts                # GET account-month-rows, account-day-detail
packages/ui/src/api/types.ts                # ApiAdapter + row fields
frontend/src/api/backendApi.ts, ElectronApiAdapter.ts
frontend/src/shared/components/settleCalendar/   # NEW generic SettleCalendar, SettleDayDetails, SettleSelectionBar
frontend/src/features/suppliers/components/AccountSettleSheet.tsx   # uses the calendar
frontend/src/features/suppliers/hooks/useSuppliers.ts               # month / day queries
frontend/tests/e2e-web/lira-web-0xx-omt-settle-by-day.spec.ts       # NEW
docs/release-notes/UNRELEASED.md + frontend/public/whats-new/<next>/omt-settle-calendar.png
docs/FEATURE_GUIDE.md §8.2                  # add "settle by day" + account credits
```

**Structure Decision**: the existing monorepo layout. The generic parts sit in `packages/core/src/utils/` and `frontend/src/shared/components/settleCalendar/`, so later screens import them without depending on suppliers code.

## Phases (outline for /speckit-tasks)

1. **Core math (pure)**: credit classification, the allocator `account_credits` (owner tables failing-first), `settleDays`, `buildDaySelections`.
2. **Core data**: export `NOT_REFUNDED_SQL`; queue builder range mode + `shop_day` + new row fields; the invariant test; `include_account_credits` + `credit_used` in scope + stale check; day-detail read + R7 tag; undo / void with no exception (R12) with the seeded invariant test.
3. **Transports**: schemas, service methods, IPC, preload, REST, adapter types (rule 23 diff).
4. **UI**: generic calendar parts (the look decided in the mock: circles, % ring, "$" / "L" badges, band, "!" badge, legend, month line, selection bar with OMT credit line, older-month link); sheet wiring; "Settle old history up to…" action; day details with untick.
5. **Proof and delivery**: web e2e + screenshot, speed check, release notes + What's new card, FEATURE_GUIDE §8.2, gates.

## Rollout after this ticket (owner 2026-10-26: "all settlements")

Each step is its own ticket with a short spec, reusing `settleDays` + `SettleCalendar`:

1. **Other suppliers**: first give them per-row "paid so far" (the LIRA-322 coverage table), then the calendar.
2. **Partners**: partner ledgers settle differently; a spec decides their day and credit rules.
3. **Client debts (Debts page)**: repayments already go oldest first (`debtRepaymentAllocation.ts`); a spec decides the customer-account and IN/OUT rules.

## Complexity Tracking

None.
