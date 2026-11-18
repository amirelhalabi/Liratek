# Implementation Plan: Profits — one total across Summary, By Module, By Date, By User

**Branch**: `395-profits-one-total` (built on `main`, owner commits) | **Date**: 2026-11-18 | **Spec**: [spec.md](./spec.md)

## Summary

Summary `totals.gross_profit_*` is the reference. By Date already equals it. Two views
drift:

1. **By User** never adds counterparty discounts (`COUNTERPARTY_DISCOUNT` rows).
2. **By Module** keeps off-currency kept change in additive `kept_change_usd/_lbp`
   fields on module rows instead of in any row's `profit_*`.

The fix adds one branch to `getByUser`. In By Module, it moves the off-currency kept
change into the existing **Kept Change** row's `profit_*`, with a drill-down that lists
each transaction. A real-schema test asserts the four-way equality, and was seen failing
first.

## Gap trace (FR-002 mapping): where By Module's −28.30 USD / −125,500 LBP lives

Traced from the code (`ProfitService.getSummary` / `getByModule`, repository queries).

| Summary term, all inside `gross_profit_*` | By Module row today | Inside the row's `profit_*`? |
| --- | --- | --- |
| `sales.profit_*`: margin plus SALE kept change, stamped on the SALE row | SALE | yes. `sale_kept_change_*` is an informational residual already inside `profit_*`, so it is **not** part of the gap (the spec's mention of it is a red herring) |
| `debt_repayments` (`getDebtRepaymentProfit`) | KEPT_CHANGE | yes |
| `refundKept` (`getRefundKeptChangeProfit`, LIRA-272) | KEPT_CHANGE | yes |
| `recharges.kept_change_*` (off-currency stamp on RECHARGE rows) | `RECHARGE_<carrier>.kept_change_*` | **no**, additive field |
| `finSvc.kept_change_*` + `mobileSvc.kept_change_*` (off-currency stamp on FINANCIAL_SERVICE rows, mobile providers included) | `FINANCIAL_SERVICE_<provider>.kept_change_*` | **no** |
| `loto.kept_change_usd` (the USD stamp on a LOTO row) | `LOTO.kept_change_usd` | **no** |
| `exchange.kept_change_usd` (payout keep-change, `exchangeKeptProfitUsd`) | `EXCHANGE.kept_change_usd` | **no** |

Summary `kept_change` = recharges + mobile + loto + finSvc + exchange kept change + `refundKept`.
By Module's KEPT_CHANGE `profit_*` = debt repayments + `refundKept`.

**So the gap is Σ module rows' `kept_change_*` = Summary `kept_change` − `refundKept`.**

On Cornertech, `refundKept` is likely 0. The basis: By Module's KEPT_CHANGE (29.56 / 26,500)
equals the Summary's `debt_repayments` exactly, so the gap equals the whole `kept_change`
section (28.297 / 125,500). This holds by construction and is checked by the new test. The
Cornertech figure itself is confirmed by the LIRA-397 audit script.

The Profits page's By Module TOTAL row (`Profits.tsx` ~2920) already adds `kept_change_*`
back in. The on-screen TOTAL therefore already matched the Overview. Only Σ `profit_*`, which
the API, the spec and the audit script use, was short.

## Design

### By Module (FR-002, US2)

- `getByModule` adds the module rows' off-currency kept change into the **KEPT_CHANGE** row's
  `profit_usd/_lbp`. These are the same `FinByProviderRow` / `RechargeByCarrierRow` /
  `LotoTotalsRow` / `ExchangeTotalsRow` figures it already fetched, so no new totals SQL is
  needed (rules 13 and 14).
- The `kept_change_usd/_lbp` fields are **no longer set** on `FINANCIAL_SERVICE_*`,
  `RECHARGE_*`, `LOTO` and `EXCHANGE` rows. Otherwise the page's TOTAL would add the money
  twice (once via KEPT_CHANGE, once via the old per-row fields). The UI's per-row
  "off-currency kept change" note simply stops rendering. The money is listed under Kept
  Change instead, and each module's drill-down still notes "kept change +X" on the
  transaction.
- The KEPT_CHANGE drill-down (`buildKeptChangeModuleDetail`) gets ONE extra call to a new
  helper, `moduleKeptChangeDetailRows`. The helper reads the existing per-module detail
  queries, which already expose per-row `kept_change_*` (`getRechargeDetail`,
  `getFinancialServiceDetail`, `getLotoDetail`; `getExchangeDetail` gains a `kept_change_usd`
  column using `exchangeKeptProfitUsd`). It weights each row exactly as that module's own
  builder does: `debt_pending ? 0 : partner_coverage_ratio`, and for FS also
  third-currency / `recognized === 0` → 0. Only the providers and carriers whose totals
  row carries kept change are queried.
- The count stays the debt/refund event count. Module kept change adds money, not a new
  event count. This is logged as a decision, since list length versus Count already differs
  for reversals.

### By User (FR-001)

- One more `UNION ALL` branch in `getByUser`, modelled on the LIRA-319 extra-charge branch:
  - population: `t.status = 'ACTIVE' AND counterpartyDiscountSource(t) AND dateRange(t.created_at)`,
    the same as `getCounterpartyDiscountTotals` and By Date's `daily_discounts`;
  - grouped by the row's own `user_id`, so a reversal (a new ACTIVE discount row) lands on the
    reversing user on the reversal's day, the same way By Date handles it;
  - each discount row counts as one `recognized_transaction_count` event;
  - params are appended at the end, in SQL order;
  - `+tenant_id`.
- The `getByUser` doc comment ("counterparty discounts DELIBERATELY NOT added") is
  corrected. `getByClient` is unchanged, since it is not a reconciliation target.

### Test (FR-003, rule 17)

`packages/core/src/services/__tests__/ProfitService.allViewsOneTotal.test.ts`:

- Real schema: `create_db.sql` + `runMigrations` + `initFixedTenantContext`.
- Seeds every line type the spec lists. Real write paths are used where they exist; any line
  seeded by SQL that mirrors its write path's stamp is named in the test header.
- Asserts Σ By Module `profit_*` = Σ By Date `profit_*` = Σ By User `profit_*` = Summary
  `gross_profit_*`, within 0.01 USD / 1 LBP. The By Module sum deliberately does NOT add
  `kept_change_*`.
- Also asserts that the KEPT_CHANGE drill-down's `counted_total` equals its row, and covers an
  empty range.
- Run on the unfixed code first. Two failures were expected (by-user, by-module).

## Technical Context

**Language/Version**: TypeScript strict, Node (jest via ts-jest)
**Primary Dependencies**: better-sqlite3, `@liratek/core`
**Storage**: SQLite (real schema in tests)
**Testing**: jest, run on explicit paths from `packages/core`
**Target Platform**: desktop (IPC) and web (REST). Both call `ProfitService`, so there are no transport changes.
**Project Type**: monorepo; the change is core-only
**Performance Goals**: By Module adds no query. The drill-down adds per-provider/carrier detail reads only when there is kept change. By User adds one grouped scan with `+tenant_id`.
**Constraints**: shared files (`ProfitRepository.ts`, `ProfitService.ts`) are being edited in parallel by 393, 394 and 396, so edits must be surgical, with no prettier `--write`.
**Scale/Scope**: 2 core files plus 1 new test, and updates to tests whose premise changed

## Constitution Check

- Rule 13 (no SQL in services): the service only assembles. Every SQL change is in the repository. PASS
- Rule 14 (one predicate): reuses `counterpartyDiscountSource`, `exchangeKeptProfitUsd` and the existing detail queries. No pasted predicate. PASS
- Rule 17 (failing-first): the test is written and run before the fix. PASS
- Rule 19 (dual transport): core-only, same service for both transports. PASS
- Rule 20 (reversal symmetry): no new rows are written. A discount reversal is already a negated row that the new branch sums. PASS
- Rule 27 (where code runs): no clock or locale reads added. PASS
- Rule 30 (release note): proposed in the report. The orchestrator owns `UNRELEASED.md`.

## Project Structure

```text
packages/core/src/repositories/ProfitRepository.ts   # getByUser branch; getExchangeDetail kept_change_usd
packages/core/src/services/ProfitService.ts          # getByModule KEPT_CHANGE fold; buildKeptChangeModuleDetail + helper
packages/core/src/services/__tests__/ProfitService.allViewsOneTotal.test.ts   # new
specs/395-profits-one-total/{plan,tasks}.md
```

**Structure Decision**: core only. The frontend needs no change, because its TOTAL row
sums `kept_change_*`, which is now absent (0), and `profit_*`.

## Complexity Tracking

None.
