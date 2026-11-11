---
description: "Task list — LIRA-389 Summary view on Audit & Transactions"
---

# Tasks: Summary view on Audit & Transactions

**Input**: `specs/389-transactions-summary/` (plan.md, spec.md, research.md, data-model.md, contracts/)

**Tests**: requested by the spec (SC-001..SC-004) and rule 17 — guard tests are written first and seen failing.

## Phase 1: Setup

- [X] T001 Read the three guards that enumerate channels/routes before wiring anything: `electron-app/offline/__tests__/handlerBindingParity.test.ts`, `backend/src/api/__tests__/auditRoleGate.api.test.ts`, `packages/core/src/offline/channelPolicy.ts` (read list) — note what a new read channel needs

## Phase 2: Foundational (blocking)

- [X] T002 Create `packages/core/src/utils/transactionListFilter.ts` (browser leaf, imports only `constants/*` and `utils/transactionVisibility`, `utils/cashFlow`, `utils/transactionText`): `TransactionListOption`, `buildTransactionListFilters(options, { search, day_from, day_to })` (moved from `useTransactionRows.fetchPage`), `isTransactionListRowVisible(row, options)` + `isSupplierPaymentVisible` / `isExpenseVisible` / `isWarrantyCostVisible` (moved from `frontend/src/features/audit/auditConstants.ts`), `SUMMARY_MODULE_OF: Record<TransactionType, SummaryModuleKey>` + `summaryModuleOf(type)`, `serviceTypeTitle(row)` (research R6)
- [X] T003 Export T002 from `packages/core/src/browser.ts` and `packages/core/src/index.ts`
- [X] T004 Rewire `frontend/src/features/audit/hooks/useTransactionRows.ts` to `buildTransactionListFilters` + `isTransactionListRowVisible`; `auditConstants.ts` re-exports the three visibility helpers and `FilterOption = TransactionListOption & { label: string }`; run `useTransactionRows.test.ts`, `defaultVisibilityParity.test.ts`, `supplierPaymentVisibility.test.ts` unchanged (behaviour-preserving move)
- [X] T005 Create `packages/core/src/validators/transactionSummary.ts`: `transactionListOptionSchema`, `transactionSummarySchema` ("group_by": "type" | "service" | "product" | "category", required; "include_refunded" boolean default false; "options" ≤ 50; "search" ≤ 200; "day_from"/"day_to" `YYYY-MM-DD`), `transactionSaleDrillFiltersSchema` ("sale_product_id" positive int; "sale_category" string | null), exported input/result types; export from `validators/index.ts`, `browser.ts`, `index.ts`
- [X] T006 Export `PRODUCT_DISPLAY_CATEGORY_SQL` (= `COALESCE(pc.name, p.category)`) from `packages/core/src/repositories/ProductRepository.ts` and use it there (rule 14)

## Phase 3: User Story 1 — products sold in a period (P1) 🎯 MVP

**Goal**: Summary by Product / Category with Count, Units, Volume, TOTAL; refunds netted.

**Independent test**: core table-driven test (SC-001).

- [X] T007 [US1] Skeleton `packages/core/src/services/TransactionSummaryService.ts` (returns `{ rows: [], total: zeros }`) + `packages/core/src/repositories/TransactionSummaryRepository.ts` (empty reads) + singletons/exports, so the test compiles
- [X] T008 [US1] Write `packages/core/src/services/__tests__/TransactionSummaryService.test.ts` on the real schema (`testHelpers/debtItemDb.ts`): fixture = multi-line sale (Lenovo ×2 + Lenovo ×1 + cable), whole-refunded sale, item-refunded sale (1 of 3), OMT send ($100 + $1 fee → $101) and receive, session basket (sale + OMT send, pooled cst rows), recharge, manual expense + auto expense (`is_auto`), deleted product, renamed product, uncategorised product; table-driven expectations per dimension (rows, counts, units, volumes, TOTAL) + R3 formula vs `getRecent` + `isTransactionListRowVisible` for option sets All types, [Expense] (reveals the auto expense), [Cash only (till)], and the mixed [Sale + Cash only]; + per-row drill count (R3a) for a product row; run it and record the red lines
- [X] T009 [US1] Implement `TransactionSummaryRepository.getSaleLines(saleIds)` (chunk 400; literal `tenant_id = ?` in each statement; products/categories joined by tenant) and `getLinkedReversals(originalIds, saleIds, voucherSourceIds)` (ACTIVE rows: `reverses_id IN`, sale item-refund REFUND/REFUND_UNDO with `reverses_id IS NULL`, VOUCHER_CANCEL by source)
- [X] T010 [US1] Implement `TransactionSummaryService.summarize(input)`: `getRecent(100000, buildTransactionListFilters(...))` → predicate → reversal / refunded classification (R3) → netting (R4) → product/category rows (R5, search narrowing) → TOTAL (distinct sales) → `truncated`
- [X] T011 [US1] Test green; run `browserEntryIsNodeFree.guard.test.ts`

## Phase 4: User Story 2 — OMT count and volume (P1)

**Goal**: Type (module) and Service type dimensions.

- [X] T012 [US2] Extend the T008 table with Type and Service type expectations (OMT Send / OMT Recv separate; basket sale + send under their own module; no refund row of its own); red first
- [X] T013 [US2] Implement type/service grouping in `TransactionSummaryService.ts` with `summaryModuleOf` / `serviceTypeTitle`

## Phase 5: User Story 3 — summary matches the list; transports; UI (P1)

**Goal**: both transports, the page, drill-down.

- [X] T014 [US3] `getRecent` drill keys `sale_product_id` / `sale_category` in `packages/core/src/repositories/TransactionRepository.ts` (`TransactionFilters`), with a failing-first core test `packages/core/src/repositories/__tests__/TransactionRepository.saleDrill.test.ts`
- [X] T015 [US3] IPC: `transactions:summary` in `electron-app/handlers/transactionHandlers.ts` (`requireRole(["admin","staff"])`, `validatePayload(TransactionSummarySchema)`, `{ success, data }`), drill keys validated in `transactions:get-recent`; `electron-app/schemas/index.ts` re-exports (zod cast); `electron-app/preload.ts` binding `transactions.summary(payload)`; `frontend/src/types/electron.d.ts`; `channelPolicy.ts` read entry; handler test `electron-app/handlers/__tests__/transactionHandlers.summary.test.ts` (red first)
- [X] T016 [US3] REST: `GET /api/transactions/summary` (`requireAuth`, payload JSON param, core schema, HTTP 200 envelope) + `/recent` drill keys in `backend/src/api/transactions.ts`; test `backend/src/api/__tests__/transactionsSummary.api.test.ts` (red first)
- [X] T017 [US3] Adapter: `getTransactionSummary` in `frontend/src/api/backendApi.ts` (`ipcOrHttp`), `ElectronApiAdapter.ts`, `packages/ui/src/api/types.ts` (types from `@liratek/core`, rule 21); `sale_category` JSON-encoded in `getRecentTransactions`
- [X] T018 [US3] `DataTable` `bodyOverride` slot in `packages/ui/src/components/ui/DataTable.tsx`
- [X] T019 [US3] Page test `frontend/src/features/audit/pages/__tests__/TransactionsViewer.summary.test.tsx` (toggle, group-by default rule, include-refunded payload, TOTAL row, no profit/cost/margin/commission header in any grouping, row click → list with drill chip and the drill passed to the rows hook; drill count rule R3a); red first
- [X] T020 [US3] `frontend/src/features/audit/hooks/useTransactionSummary.ts` (api via ref, payload built once from the SAME options as the list) and `frontend/src/features/audit/components/TransactionSummaryView.tsx` (table + TOTAL; "—" for zero volume; "(deleted)", "(no category)"; truncated note)
- [X] T021 [US3] `TransactionsViewer.tsx`: List | Summary toggle, Group by select, include-refunded toggle (header actions), default grouping (Sales → Product; one module → Service type; else Type), drill state + chip; `useTransactionRows` `drill` param (client-side module/service via core keys; product/category via filters)
- [X] T022 [US3] en + ar strings in `packages/ui/src/i18n/locales/{en,ar}/audit.json` (`summary.*`, module names)

## Phase 6: User Story 4 — export (P2)

- [X] T023 [US4] `transactionsExportTemplate.ts`: optional `summary` option → "Summary by <grouping>" sheet (label, Count, Units, Volume USD, Volume LBP, TOTAL row); test in `frontend/src/features/audit/export/transactionsExportTemplate.test.ts` (red first)

## Phase 7: Polish & cross-cutting

- [X] T024 Web e2e `frontend/tests/e2e-web/lira-web-100-transactions-summary.spec.ts`: seed through REST (products, POS sales incl. a refund, OMT send/receive), Summary by Product and by Service type vs list counts (identity + deltas, rule 15), row click count, export the "Summary by Product" sheet; screenshot `frontend/public/whats-new/1.35.0/transactions-summary.png`; run `node scripts/run-e2e.mjs web view=off --min=1 lira-web-100 lira-web-018 lira-web-037`
- [X] T025 SC-004: time one 12-month summary on the seeded web DB; only if > 3 s apply the R2 fallback (skip leg attachment when no Cash-only option) and re-measure
- [ ] T026 Gates: core build + sync, `yarn typecheck`, `yarn lint`, `yarn check:i18n`, `yarn check:transport-parity`, `yarn check:tenant-scoping`, `yarn check:bind-arity`, full core suite `--maxWorkers=2`, affected frontend/backend suites, whole electron-app suite, `handlerBindingParity.test.ts`, `auditRoleGate.api.test.ts`; restore any rewritten `frontend/public/whats-new/**/*.png` not ours
- [ ] T027 Report proposed release-note bullet + What's new card + FEATURE_GUIDE paragraph (files not edited)

## Dependencies

T002–T006 → all stories. US1 (T007–T011) → US2 (T012–T013, same service) → US3 (T014–T022) → US4 (T023) → T024–T027.

## Parallel opportunities

T005 ∥ T006; T015 ∥ T016 ∥ T018; T022 ∥ T020.

## Implementation strategy

MVP = Phase 2 + US1 (core summary by product, test-proven). Then the type/service dimensions, then transports + page, then export, then e2e and gates.
