# Research — LIRA-394

## R1 What "residual" the refunded arm exists for
- Decision: keep a refunded sale only when `salePlusRefundProfitSubquery` (USD or LBP) is nonzero (|x| > 1e-6).
- Rationale: that subquery is exactly the per-sale figure `getSalesProfit` counts for `status = 'refunded'`; it already nets refund kept change out (`stampNetOfRefundKeptChange`, counted on the refund day elsewhere), so "zero kept change" is covered. A zero-residual row contributes 0 to the module row, so dropping it keeps SC-002 (Σ counted = module row) exact. Epsilon 1e-6 keeps the reconciliation suite's `toBeCloseTo(…, 6)` sum exact.
- Alternatives: keep the EXISTS gate and filter in the service (rejected — the arm's doc already says it exists to avoid all-zero rows; the repository is where it filters); epsilon 0.005 (rejected — could drop a real sliver the module total still counts).

## R2 Paid / owed fragments
- Decision: `salePaidUsdEquiv(a)` = `a.paid_usd + paid_lbp / snapshot rate` (gross, extra included); `saleOwedUsdEquiv(a)` = `a.final_amount_usd + saleExtraUsdEquiv(a)` (net extra, LBP at snapshot rate). Defined next to `saleTotalPaidUsdEquiv` in `ProfitRepository.ts`; `saleTotalPaidUsdEquiv` left textually unchanged (recognition).
- Rationale: matches the customer's view and `DebtRepository._loadAllocationItems`'s own pair (same SQL).
- Alternative: move both into the leaf `saleExtraFragment.ts` and point DebtRepository at them (rejected for this ticket: DebtRepository is a money path outside this ticket's file ownership — flagged as follow-up).

## R3 Refunded-arm wording
- Decision: never print an owed figure on a refunded row. `final_amount_usd` on a refunded sale is still the pre-refund total, and the Debts allocation excludes refunded sales (`s.status = 'completed'`), so no "remaining owed" figure exists that Debts shows. Reasons: partner → "Refunded — Partner has …"; otherwise "Refunded — not counted: the sale was not paid in full."
- Detail: "Refunded: <name xqty, …>" from the original quantities; "Refunded sale" when no line names are found. Never `null`.

## R4 Test harness
- Decision: real schema (`create_db.sql` + `initDatabase` + `runMigrations`), real writers: `SalesRepository.processSale`, `TransactionRepository.refundBySaleId`, `SalesRepository.refundSaleItem`, `DebtRepository.addRepayment`; assert through `ProfitService.getModuleDetail('SALE', …)`.
