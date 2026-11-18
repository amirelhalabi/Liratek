---
description: "Tasks for LIRA-396 — Profits drill-downs: Only Days cost, module wording, no empty rows"
---

# Tasks: Profits drill-downs — Katsh "Only Days" cost, module wording, and no empty rows

**Input**: spec.md, plan.md, research.md, data-model.md, quickstart.md

**Tests**: requested (FR-003, rule 17). Every guard test is written first and run on the unfixed code, and the real failure is recorded under "Failing-first log".

**Shared files**: `ProfitRepository.ts` and `ProfitService.ts` are being edited in parallel by LIRA-393/394/395. Re-read each one immediately before every edit, keep edits surgical, and do not run prettier `--write` on them.

## Phase 1: Setup

- [x] T001 Trace the Only Days write path and record the verdict in specs/396-profits-labels-cost/research.md §1 and plan.md (verdict: display-only, no stored-cost change, no migration)

## Phase 2: Foundational

- [x] T002 Create the real-schema harness (create_db.sql + runMigrations + real repositories) in packages/core/src/services/__tests__/ProfitService.lira396DrilldownLabelsCost.test.ts

## Phase 3: User Story 1 — Only Days row: price − cost = profit (P1)

**Independent test**: book a Katsh Only Days sale through `FinancialServiceRepository.createTransaction` (gross cost, `itemCategory: "mtc"`, `returnedCreditsUsd`), then read `getModuleDetail("FINANCIAL_SERVICE_Katsh")`.

- [x] T003 [US1] Guard test: the detail row has amount − cost = profit, and a normal catalog row keeps cost = fs.cost, in packages/core/src/services/__tests__/ProfitService.lira396DrilldownLabelsCost.test.ts. Run it and record the failure.
- [x] T004 [US1] Guard test: `FinancialServiceRepository.getAllByProvider("Katsh")` still shows amount = the GROSS cost for the same row (the supplier view is untouched), in the same file.
- [x] T005 [US1] Rule 20 regression guard: create + `refundTransaction` of the Only Days sale nets to 0 per currency on the Katsh drawer, the MTC drawer (CREDIT_RETURN), carrier_line_movements (when a primary line exists) and transactions profit, in the same file. Marked "not proven failing-first; no write path changed".
- [x] T006 [US1] Add the exported fragment `ONLY_DAYS_TXN_IDS_SQL` (one scan of payments where method = CREDIT_RETURN_LEG_METHOD, tenant-scoped) and the drill-down cost expression in packages/core/src/repositories/ProfitRepository.ts. In getFinancialServiceDetail's transfer arm, LEFT JOIN it once and set cost_* = revenue − stamped profit for those rows.
- [x] T007 [P] [US1] Replace the "CREDIT_RETURN" literal in processTelecomCreditReturn with CREDIT_RETURN_LEG_METHOD in packages/core/src/repositories/FinancialServiceRepository.ts (rule 14; the documented follow-up).

## Phase 4: User Story 2 — module wording in Detail (P2)

**Independent test**: real writers or real-schema rows whose detail would be the enum or blank. Assert detail = transactions.summary or the documented fallback.

- [x] T008 [US2] Guard tests: an FS transfer's detail = its transaction summary, with the enum fallback when the summary is NULL; an allocation row's detail = "<summary> — commission at settlement"; loto with no number → summary; maintenance with blank device → summary, else "Repair job #id"; custom with blank description → summary, else "Custom service #id". In the same file. Run them and record the failures.
- [x] T009 [US2] getFinancialServiceDetail (both arms; the allocation arm reads the transfer's summary through a `+tenant_id` correlated lookup on transactions via idx_transactions_source), getLotoDetail (add `summary`), getMaintenanceDetail (device_name chain) and getCustomServiceDetail (description chain) in packages/core/src/repositories/ProfitRepository.ts.
- [x] T010 [US2] `detail:` lines in buildFinancialServiceModuleDetail (allocation suffix) and buildLotoModuleDetail (summary fallback) in packages/core/src/services/ProfitService.ts. LotoDetailRow type gets `summary`.

## Phase 5: User Story 3 — no empty rows (P2)

**Independent test**: a $0 kept-change repayment (real DebtRepository repayment with no change) and a $0 client top-up (real RechargeRepository.topUpFromClient), plus one real row each, then check Σ counted = the module row.

- [x] T011 [US3] Guard tests: the KEPT_CHANGE $0 row is absent; the TOPUP_BUYBACK $0 row is absent; a client top-up with profit lists the client's name; Σ counted equals getByModule's row. In the same file. Run them and record the failures.
- [x] T012 [US3] getTopupBuybackDetail counterpart = COALESCE(recharges, transactions) in packages/core/src/repositories/ProfitRepository.ts
- [x] T013 [US3] Skip zero-profit rows in buildKeptChangeModuleDetail and buildTopupBuybackModuleDetail in packages/core/src/services/ProfitService.ts
- [x] T014 [US3] Update the two now-outdated expectations in packages/core/src/repositories/__tests__/ProfitRepository.moduleDetailReconciliation.test.ts (KEPT_CHANGE not_counted length; the allocation detail wording)

## Phase 6: Polish

- [x] T015 Run the affected suites by explicit path (the new test, moduleDetailReconciliation, profitRecognition.guard, FinancialServiceRepository.telecomOnlyDays, correlatedTenantIndex.guard), then `yarn workspace @liratek/core typecheck` and `yarn workspace @liratek/backend typecheck` (measure elapsed time), and `prettier --check` on the shared files.
- [x] T016 Fill in the failing-first log below and propose the UNRELEASED.md / current_sprint.md text in the report (owner-only files, not edited).

## Dependencies

T002 → T003–T005 → T006/T007; T002 → T008 → T009 → T010; T002 → T011 → T012/T013 → T014; all → T015 → T016. US1, US2 and US3 are otherwise independent.

## Implementation strategy

US1 first (the owner-visible number), then US2 and US3. Each is a separate SQL or service edit, so the parallel agents' conflicts stay small.

## Failing-first log

All recorded from `npx jest src/services/__tests__/ProfitService.lira396DrilldownLabelsCost.test.ts` on the UNFIXED code (2026-11-18), before any source edit:

| Test | Real failure on unfixed code |
|---|---|
| US1 net cost (qty 2) | `amount − cost` Expected 89986, Received -930014 (cost column = gross 1,530,014) |
| US2 FS summary | Expected "Katsh: mtc: 7.58 (Prepaid) [Only Days] — 300000 LBP", Received "SEND" |
| US2 loto | Expected "Loto ticket sale: #1 CASH", Received "Loto ticket" |
| US2 maintenance | Expected "Repair: screen cracked", Received "" |
| US2 custom service | Expected "Phone unlock", Received "" |
| US3 KEPT_CHANGE | Expected length 0, Received 1 ($0 row, "No kept change on this repayment (rounds to $0).") |
| US3 TOPUP_BUYBACK | Expected length 1, Received 2 ($0 row listed; counterpart "Walk-in" on the client's paid top-up) |

These passed already on the unfixed code (guards, not failing-first): normal catalog line keeps cost; Suppliers history shows the gross cost; create + refund nets to 0 (rule 20 regression guard — no write path changed); legacy NULL-summary FS row → "SEND".

One test-side correction before the fix: the rule 20 guard first summed `carrier_line_movements.credits_delta` over all rows (got 6). A reversal flips `is_reversed` in place rather than writing a negative row, so the assertion now reads the line's `credits` and the non-reversed movements. This was a mistake in the test, not a code defect.
