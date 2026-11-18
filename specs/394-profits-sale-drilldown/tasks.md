---
description: "Task list for LIRA-394"
---

# Tasks: Profits — Sale drill-down stops listing refunded sales as owing, and words paid/owed with the extra

**Input**: plan.md, spec.md, research.md, data-model.md, quickstart.md in `specs/394-profits-sale-drilldown/`
**Tests**: REQUIRED (FR-004, rule 17 failing-first).
**Test file**: `packages/core/src/services/__tests__/ProfitService.saleDrilldownRefundedAndExtra.test.ts` (TEST below)

## Phase 1: Setup

- [X] T001 Create the real-schema harness in TEST: `create_db.sql` + `initDatabase` + `runMigrations` + `initFixedTenantContext(1)` + `__LIRATEK_TEST_DB__` + singleton resets (as `ProfitRepository.extraChargeAccountHold.test.ts`), a named client, product helper, `posSale`, `repay` (`DebtRepository.addRepayment`), `saleDetail()` = `ProfitService.getModuleDetail('SALE', wideRange)`

## Phase 2: Foundational (failing-first — run before any source edit)

- [X] T002 [US1] Write US1 guards in TEST: whole-sale refund via `TransactionRepository.refundBySaleId` of (a) cash-paid sale, (b) on-account sale → sale absent from `counted` and `not_counted`; (c) line-by-line refund via `SalesRepository.refundSaleItem` of an on-account sale → absent
- [X] T003 [US2] Write US2 guards in TEST: $18 + $2 extra, all CUSTOMER_ACCOUNT → reason "Customer still owes — paid $0.00 of $20.00."; after `repay(10)` → "Customer still owes — paid $10.00 of $20.00." and `counted_pct` 0 (weight unchanged); LBP-only paid sale → paid equals USD-equivalent at snapshot rate
- [X] T004 Run TEST against unfixed code; record the exact failures for the report

## Phase 3: User Story 1 — refunded sales never claim the customer still owes (P1)

**Independent test**: T002 green; reconciliation suite's refunded-with-residual row still counted 100 % (+5), reason `null`.

- [X] T005 [US1] In `packages/core/src/repositories/ProfitRepository.ts` `SaleDetailRow`: add `refunded_arm: 0 | 1`; select `0 AS refunded_arm` in `getCompletedSalesDetailGross` and `getCompletedSalesDetailNet`
- [X] T006 [US1] In `getRefundedSalesDetail`: select `1 AS refunded_arm`, `items_summary` = original lines `name xqty` (GROUP_CONCAT, tenant-scoped); keep only rows whose `profit_usd`/`profit_lbp` residual is nonzero (|x| > 1e-6), filtering the selected columns (no re-pasted subquery, binds unchanged); update the method doc comment
- [X] T007 [US1] In `packages/core/src/services/ProfitService.ts` `buildSaleModuleDetail`: refunded-arm rows → `detail` "Refunded: <items>" (fallback "Refunded sale"), reason prefixed "Refunded — " and never an owed figure ("Refunded — not counted: the sale was not paid in full." / "Refunded — Partner has …")

## Phase 4: User Story 2 — paid/owed include the extra, never negative (P1)

**Independent test**: T003 green; reconciliation M4 test still "paid $45.00 of $90.00."

- [X] T008 [US2] In `ProfitRepository.ts` next to `saleTotalPaidUsdEquiv`: add exported `salePaidUsdEquiv(alias)` (gross) and `saleOwedUsdEquiv(alias)` (`final_amount_usd + saleExtraUsdEquiv`) with doc comments; leave `saleTotalPaidUsdEquiv` untouched
- [X] T009 [US2] Replace `paid_total_usd` in `SaleDetailRow` and all three selects with `paid_usd_equiv` / `owed_usd_equiv` from T008
- [X] T010 [US2] `buildSaleModuleDetail` live-sale reason uses `paid_usd_equiv` / `owed_usd_equiv`

## Phase 5: Polish

- [X] T011 Run TEST + `ProfitRepository.moduleDetailReconciliation.test.ts` + `ProfitRepository.extraChargeAccountHold.test.ts` + `ProfitRepository.correlatedTenantIndex.guard.test.ts` + `constants/__tests__/profitRecognition.guard.test.ts`
- [X] T012 `yarn workspace @liratek/core typecheck`, `yarn workspace @liratek/backend typecheck` (timed); `prettier --check` on the two shared files; `prettier --write` only on TEST
- [X] T013 Log decisions under "## Decisions taken unattended (2026-11-18)" in `spec.md`

## Dependencies

T001 → T002/T003 → T004 → (T005 → T006 → T007) and (T008 → T009 → T010; T009 after T005 touches the same selects) → T011 → T012 → T013.
Parallel: T002 and T003 (same file, independent describes). US1 and US2 touch the same methods, so implement sequentially.

## Implementation strategy

MVP = US1 (removes the false "still owes" rows). US2 follows in the same change.
