# Implementation Plan: Profits drill-downs — Katsh "Only Days" cost, module wording, and no empty rows

**Branch**: `396-profits-labels-cost` (built on `main`, no branch) | **Date**: 2026-11-18 | **Spec**: [spec.md](./spec.md)

## Summary

Three read-side fixes to the Profits page's By Module drill-downs. No write path, no ledger and no stored money column changes.

1. **Only Days cost (US1)**: the drill-down's cost column for a Katsh/iPick row that returned telecom credits shows the **net** cost (`price − profit`), so price − cost = profit holds on the row. This is display only. The stored `financial_services.cost` stays gross (see research.md §1, "Verdict"). There is **no migration**: the read covers old and new rows alike.
2. **Wording (US2)**: the Detail column reuses the module's own transaction summary (`transactions.summary`) for financial services, blank-device maintenance, blank-description custom services and loto tickets with no number. The last resort is "Repair job #id" / "Custom service #id", and for financial services the enum.
3. **No empty rows (US3)**: KEPT_CHANGE and TOPUP_BUYBACK drop rows whose profit is 0 in both currencies. The counted totals are unchanged because those rows were never counted. A listed client top-up names its client, read from `transactions.client_name` when the `recharges` row has none.

## Technical Context

**Language/Version**: TypeScript 5 (strict), Node 20.

**Primary Dependencies**: better-sqlite3 (core), jest.

**Storage**: SQLite. The change is read-only, with no schema change and no migration.

**Testing**: jest, real-schema harness (`create_db.sql` + `runMigrations`), real write paths.

**Target Platform**: both transports. Core only; REST and IPC already call the same `ProfitService.getModuleDetail`.

**Project Type**: monorepo (core package).

**Performance Goals**: the drill-down must not add a per-row scan. `payments` has no `transaction_id` index, so the Only Days marker is ONE pre-aggregated derived table, joined once, not a correlated `EXISTS`.

**Constraints**: four parallel agents edit `ProfitRepository.ts` and `ProfitService.ts`. Edits are surgical, with no prettier `--write`.

**Scale/Scope**: Cornertech has about 400 Katsh rows, 345 KEPT_CHANGE rows and 51 TOPUP_BUYBACK rows per window.

## Constitution Check

| Gate | Status |
|---|---|
| I. One core, two transports | Pass. Core read path only, shared by both transports. |
| II. Layer boundaries (rule 13) | Pass. All new SQL is in `ProfitRepository`. The service only filters rows and picks labels. |
| III. Defined once (rule 14) | Pass. One fragment, `ONLY_DAYS_TXN_IDS_SQL` plus `fsDrilldownCost`, is used by the drill-down. The Detail wording reuses `transactions.summary`, so there is no new template in `ProfitService`. |
| IV. Money integrity (rules 16/20/26) | Pass, nothing to reverse: no write path or ledger is touched. The rule 20 create + refund regression guard is still added for an Only Days line (FR-003 edge case). |
| V. Failing-first (rule 17) | Each guard test is run on the unfixed code first and the failure is recorded in tasks.md. |
| FR-001 (migration) | **Deviation, logged in spec.md "Decisions taken unattended"**: no stored-cost change and no backfill. See research.md §1. |

## Project Structure

```text
specs/396-profits-labels-cost/
├── spec.md
├── plan.md        (this file)
├── research.md    (Only Days trace + verdict, wording sources, zero rows)
├── data-model.md  (read-model columns touched)
├── quickstart.md  (how to verify)
└── tasks.md
```

No `contracts/` directory. The drill-down's shape (`ModuleTransactionDetail`) is unchanged: only the values of `detail`, `cost_*` and `counterpart` change, and some rows are dropped.

Source touched:

```text
packages/core/src/repositories/ProfitRepository.ts   getFinancialServiceDetail (both arms), getLotoDetail,
                                                     getMaintenanceDetail, getCustomServiceDetail,
                                                     getTopupBuybackDetail (counterpart source); new fragment
packages/core/src/services/ProfitService.ts          detail: lines (FS/loto), zero-row skip (KEPT_CHANGE, TOPUP_BUYBACK)
packages/core/src/repositories/FinancialServiceRepository.ts  use CREDIT_RETURN_LEG_METHOD instead of the literal (rule 14)
packages/core/src/services/__tests__/ProfitService.lira396DrilldownLabelsCost.test.ts   new (real schema, real writers)
packages/core/src/repositories/__tests__/ProfitRepository.moduleDetailReconciliation.test.ts  2 expectations updated (spec change)
```

## Only Days trace (summary; full version in research.md §1)

- `KatshForm` → `buildCatalogSalePayload`: `cost = Σ catalogCost × qty` (GROSS), `price = Only Days price`, and `telecomCreditReturns[]` with one entry per unit.
- `FinancialServiceRepository.createTransaction` resolves the returned credits ONCE (`resolveTelecomCreditReturns`) and values them at R (`telecom_credit_cost_rate_lbp`): `commission = price − cost + credits × R`. This commission is the profit stamp (`t.profit_lbp`). `cost` is stored gross on purpose (the comment at about lines 2346–2349: "`cost`, the drawer leg and the supplier payable are all untouched by this: only the margin moves").
- The stored gross `cost` is read by:
  - the Katsh/iPick drawer leg (`-cost`);
  - `SUPPLIER_OWED_EXPR` and `grossOwedDelta`;
  - `getSaleCostSettleColumns` (`cost AS amount`, which feeds `getAllByProvider` for the Suppliers Transactions tab and Recharge History, the `getFifoPrefixByProvider` FIFO walk, and settle-by-day coverage `|amount|`);
  - the `cost > 0` branch selectors in `_providerHistoryUnion`, `useCostPriceFlow` and the edit-path summary rebuild.
  Storing net cost would understate what Katsh was paid on every supplier view. If the credits ever reached the package cost, the row would flip branches (`cost = 0` → `ELSE ABS(amount)`).
- **Double-count check (the spec's STOP condition): not hit.** The credits are income exactly once, inside this row's commission. The `CREDIT_RETURN` leg is in `INTERNAL_LEG_METHODS` (excluded from the profit views), and the `ONLY_DAYS_RETURN` carrier-line movement is informational. When those credits are later resold, the recharge is costed at `alfa_credit_cost_lbp` (RechargeRepository), so the asset is consumed at a cost and is not booked as free income.
- **Verdict**: net cost is correct as the Profits figure, but it must not be stored. The cost column of the Profits drill-down shows `revenue − stamped profit` for rows with a `CREDIT_RETURN` leg. That gives FS #2220 2,500,000 − 744,970 = 1,755,030, which matches the owner check, and applies to existing rows with no backfill.

## Not in this ticket

- By Module's FS `cost` total (`SUM(fs.cost × ratio)`, around ProfitRepository lines 5547/6276) still sums the gross cost. Those lines belong to LIRA-395 (by-module totals). The fragment is exported so 395 or a follow-up can switch them. This is reported to the orchestrator, not edited here.
- Loto ticket number capture: a separate ticket (spec open question).
