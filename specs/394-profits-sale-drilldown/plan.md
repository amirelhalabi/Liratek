# Implementation Plan: Profits — Sale drill-down stops listing refunded sales as owing, and words paid/owed with the extra

**Branch**: `main` (edit in place, owner commits) | **Date**: 2026-11-18 | **Spec**: [spec.md](./spec.md)

## Summary

Display-only fix to the Profits page's SALE "Show transactions" drill-down.
(1) `ProfitRepository.getRefundedSalesDetail` keeps a `status = 'refunded'` sale
only when its SALE+REFUND residual profit (`salePlusRefundProfitSubquery`, USD or
LBP) is nonzero — the only thing that arm exists to surface; fully refunded
sales with nothing left (paid or on account) disappear. Kept rows carry a
`refunded_arm` flag, a "Refunded: <items>" detail and a "Refunded — " reason that
never states an owed figure. (2) Live sales word their reason from ONE new pair
of fragments, `salePaidUsdEquiv` (gross of the extra) and `saleOwedUsdEquiv`
(`final_amount_usd + net extra`), so "$18 + $2 extra, unpaid" reads
"paid $0.00 of $20.00". Recognition weights are untouched.

## Technical Context

**Language/Version**: TypeScript 5 (strict), Node 20
**Primary Dependencies**: better-sqlite3, `@liratek/core`
**Storage**: SQLite (`sales`, `sale_items`, `transactions`, `debt_ledger`)
**Testing**: jest (core), real schema = `electron-app/create_db.sql` + `runMigrations`
**Target Platform**: desktop (IPC) and web (REST) — both call `ProfitService.getModuleDetail`; no transport change
**Project Type**: monorepo, core-only change
**Performance Goals**: no new full scans; the owed fragment reuses `saleNetExtraUsdEquiv` (`+sxt.tenant_id`, guarded by `ProfitRepository.correlatedTenantIndex.guard.test.ts`)
**Constraints**: four agents edit `ProfitRepository.ts` / `ProfitService.ts` in parallel — surgical edits, no prettier `--write`
**Scale/Scope**: 2 source files, 1 new test file

## Constitution Check

| Principle | Status |
|---|---|
| I. One core, two transports | PASS — core-only; both transports already call `getModuleDetail` |
| II. Layer boundaries (rule 13) | PASS — SQL stays in `ProfitRepository`; the service only words text |
| III. Defined once (rule 14) | PASS — one paid/owed pair next to `saleTotalPaidUsdEquiv`; reuses `saleNetExtraUsdEquiv`. Known pre-existing duplicate in `DebtRepository._loadAllocationItems` (inline `salePaidSql`/`saleOwedSql`) is flagged as a follow-up, not edited (not this ticket's file; money path) |
| IV. Money integrity | N/A for writes — display-only; no transaction/payment/ledger writes. FEATURE_GUIDE §13 reviewed: items 1-15 do not apply (no new flow) |
| V. Data and security | PASS — no new binds outside existing `?` placeholders; `tenant_id` on every new subquery |
| Rule 17 | Guard tests written and run red before the fix |

## Project Structure

```text
specs/394-profits-sale-drilldown/  plan.md research.md data-model.md quickstart.md tasks.md
packages/core/src/repositories/ProfitRepository.ts   (fragments ~879, SaleDetailRow ~312, getSalesDetail arms ~6420-6625)
packages/core/src/services/ProfitService.ts          (buildSaleModuleDetail ~2106)
packages/core/src/services/__tests__/ProfitService.saleDrilldownRefundedAndExtra.test.ts  (new)
```

**Structure Decision**: core-only; no frontend/handler/route change (the row shape
`ProfitModuleDetailRow` sent to the UI is unchanged).

## Complexity Tracking

None.
