# Tasks: Profits — one total across Summary, By Module, By Date, By User

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)
**Tests**: required by FR-003 (rule 17, failing-first).

## Phase 1: Setup

- [X] T001 Read docs/FEATURE_GUIDE.md §10 Profits and §13 checklist before touching money-reading queries (no write path changes; record in report)

## Phase 2: Foundational (failing-first test — blocks all fixes)

- [X] T002 Write packages/core/src/services/__tests__/ProfitService.allViewsOneTotal.test.ts: real schema (create_db.sql + runMigrations + initFixedTenantContext), seed every profit line (sale w/ kept change, debt repayment w/ kept change, counterparty discount, session discount, waived, extra charge, PM fee, top-up/buyback, wrong number, warranty, supplier commission, OMT settled commission, loto, exchange, plus off-currency kept change on a recharge / FS / loto / exchange) through real write paths where practical; assert Σ By Module profit_* (NOT + kept_change_*) = Σ By Date profit_* = Σ By User profit_* = Summary gross_profit_* (±0.01 USD / ±1 LBP); KEPT_CHANGE drill-down counted_total = row; empty range = 0
- [X] T003 Run T002 on the unfixed code (`cd packages/core && npx jest src/services/__tests__/ProfitService.allViewsOneTotal.test.ts`) and record the exact failures in the report (expected: by-user, by-module)

## Phase 3: User Story 1 — every tab shows the same gross profit (P1)

**Independent test**: T002 green.

- [X] T004 [US1] Add a counterparty-discount UNION ALL branch to `getByUser` in packages/core/src/repositories/ProfitRepository.ts (counterpartyDiscountSource, status ACTIVE, dateRange(created_at), grouped by the row's own user_id, `+tenant_id`, params appended in SQL order); correct the doc comment that says discounts are excluded
- [X] T005 [US1] In `getByModule` (packages/core/src/services/ProfitService.ts) fold the FINANCIAL_SERVICE_* / RECHARGE_* / LOTO / EXCHANGE rows' off-currency kept change into the KEPT_CHANGE row's profit_* and stop emitting `kept_change_*` on those rows
- [X] T006 [US1] If T003 shows a third failure (e.g. session discounts missing from By User), fix it with the same branch pattern and log the decision in spec.md

## Phase 4: User Story 2 — By Module shows where the money lives (P2)

**Independent test**: KEPT_CHANGE drill-down reconciles (T002 + ProfitRepository.moduleDetailReconciliation.test.ts).

- [X] T007 [US2] Add `kept_change_usd` (exchangeKeptProfitUsd("et")) to `getExchangeDetail` + `ExchangeDetailRow` in packages/core/src/repositories/ProfitRepository.ts
- [X] T008 [US2] Add helper `moduleKeptChangeDetailRows` in packages/core/src/services/ProfitService.ts (reads getRechargeDetail / getFinancialServiceDetail / getLotoDetail / getExchangeDetail for carriers/providers with kept change, weights exactly like each module builder) and call it once from `buildKeptChangeModuleDetail`

## Phase 5: Polish

- [X] T009 Update tests whose premise changed (module rows no longer carry kept_change_*): ProfitAudit.loto, ProfitRepository.auditBatchLO, ProfitRepository.exchangeKeptChangeLine, ProfitRepository.refundKeptChangeModules — report as "premise changed, not failing-first"
- [X] T010 Run affected suites by explicit path: allViewsOneTotal, moduleDetailReconciliation, profitRecognition.guard, correlatedTenantIndex.guard, ProfitService.auditBatchLO, ProfitRepository.auditBatchLO, byUserByClient.round2, ProfitAudit.{recharge,exchange,financial_services,loto}, exchangeKeptChangeLine, refundKeptChangeModules
- [X] T011 `yarn workspace @liratek/core typecheck` and `yarn workspace @liratek/backend typecheck` (measure elapsed); `npx prettier --check` on the two shared files and the new test
- [X] T012 Document the mapping in docs/FEATURE_GUIDE.md §10 Profits; log unattended decisions in spec.md

## Dependencies

T002→T003→(T004, T005)→T007→T008→T009→T010→T011→T012. T004 and T005 touch different files ([P] in principle) but both must follow T003.

## Strategy

MVP = US1 (T004+T005) makes the totals agree; US2 (T007/T008) makes the moved money inspectable.
