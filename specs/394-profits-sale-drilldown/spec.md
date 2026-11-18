# Feature Specification: Profits — Sale drill-down stops listing refunded sales as owing, and words paid/owed with the extra

**Feature Branch**: `394-profits-sale-drilldown`

**Created**: 2026-11-18

**Status**: Draft (owner decision 2026-11-18: build)

**Input**: Owner audit of the Cornertech Profits page (2026-11-16).

## Established facts (verified on Cornertech, 2026-09-01 → 2026-11-16)

- `ProfitRepository.getSalesDetail` (~line 6440) has a `status = 'completed'` arm and a `status = 'refunded'` arm (~6560-6610). The refunded arm lists EVERY refunded sale that has an active SALE/REFUND transaction row.
  - 11 fully refunded sales (e.g. sale #542, #470, #469, #468) appear as counted rows with amount 0, cost 0, profit 0, `detail: null` — pure noise.
  - 4 refunded sales that were on account appear in "not counted yet" with the reason **"Customer still owes — paid $265.00 of $1135.00."** (sale #557, Samsung S26 Ultra, status `refunded`; also #325, #499, #436). Nobody owes anything on a refunded sale.
- `ProfitService.buildSaleModuleDetail` (~2112-2130) words the reason from `paid_total_usd` = `saleTotalPaidUsdEquiv(s)` = `paid_usd + paid_lbp/rate − extra` and `final_amount_usd` (which EXCLUDES the extra). Sale #565 (final 18, extra 2, on account 20, paid 0) therefore reads **"Customer still owes — paid $-2.00 of $18.00."** The customer owes $20 and has paid $0.
- Recognition itself (`saleRecognitionWeight`, `saleFullyPaid`, LIRA-390's `extraChargeRecognized`) is NOT wrong for these rows and is NOT changed here (money decision; see open question).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Refunded sales never claim the customer still owes (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a sale on account that was fully refunded (all lines refunded, residual profit 0), **When** the Sale drill-down is built, **Then** the sale is not listed at all (neither counted nor not-counted).
2. **Given** a refunded sale that still carries residual profit (a partially refunded sale whose remaining lines still count, or a kept-change residual — the case the refunded arm exists for, see `seedRefundedSaleWithResidualProfit` in `ProfitRepository.moduleDetailReconciliation.test.ts`), **When** listed, **Then** its `detail` is the remaining lines (never `null`), and its reason, when not fully counted, starts with "Refunded — " and never says the customer still owes more than the remaining open balance.
3. **Given** the Cornertech examples (#542 fully refunded & paid; #557 refunded & unpaid), **When** rebuilt on seeded equivalents, **Then** #542-like is absent and #557-like is absent (nothing remains to count).

### User Story 2 — Paid / owed wording includes the extra and is never negative (Priority: P1)

**Acceptance Scenarios**:

1. **Given** sale final $18 + extra $2 all on account, paid $0, **When** the drill-down reason is built, **Then** it reads "Customer still owes — paid $0.00 of $20.00."
2. **Given** the same sale after a $10 repayment, **Then** "paid $10.00 of $20.00."; counted percentage unchanged from today's weight (no recognition change in this ticket).
3. **Given** a sale paid in LBP only, **Then** paid is the USD-equivalent at the sale's snapshot rate (keeps PROF-DD-FIX M4 behaviour).

### Edge Cases

- Sale with extra in LBP (`extra_lbp`) → owed uses the net extra converted at the snapshot rate (`saleNetExtraUsdEquiv`, LIRA-390).
- Refunded extra (`REFUND` row with negated `extra_*`) → owed uses the net extra (already what `saleNetExtraUsdEquiv` returns).
- A refunded sale with residual profit AND still-open debt: reason "Refunded — customer still owes paid $X of $Y." where Y = remaining owed after the refund (what Debts shows), never the original total.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The refunded arm MUST exclude sales with no remaining counted line AND zero residual profit AND zero kept change (whatever "residual" the arm was written for — read its doc comment; the test fixture `seedRefundedSaleWithResidualProfit` defines the case that must stay).
- **FR-002**: Paid and owed shown in any Profits reason MUST come from ONE pair of fragments (`salePaidUsdEquiv` gross of the extra; `saleOwedUsdEquiv` = `final_amount_usd + saleNetExtraUsdEquiv`) defined once in `ProfitRepository.ts` (rule 14). `saleTotalPaidUsdEquiv` (paid − extra) may remain for recognition, but MUST NOT be used for display.
- **FR-003**: Reason wording for a refunded-arm row MUST be distinguishable from a live sale ("Refunded — …").
- **FR-004**: Failing-first tests (rule 17) on the real schema (`create_db.sql` + `runMigrations`, as in `ProfitService.rechargeDetailLabel.test.ts`), exercising the REAL write paths (`SalesRepository`/`SalesService` sale + `TransactionRepository` refund + `DebtRepository` repayment), not hand-inserted rows where a real path exists: fully-refunded absent; refunded-unpaid absent; "$0.00 of $20.00"; "$10.00 of $20.00"; reconciliation test in `ProfitRepository.moduleDetailReconciliation.test.ts` still green.

## Success Criteria *(mandatory)*

- **SC-001**: On the Cornertech range, the Sale drill-down has no row with `detail: null`, no row with a negative paid figure, and no refunded sale with a "Customer still owes" reason.
- **SC-002**: Σ counted = SALE module row, unchanged.

## Assumptions / Decisions taken (2026-11-18)

- Display-only ticket. Recognition weights unchanged.

## Open questions for the owner (do not block)

- Recognition order on a sale with an extra: today's weight treats the paid money as covering the EXTRA first (`paid − extra` vs `final`), while LIRA-390's repayment allocation and the "sales absorb the account debt first" rule treat money as covering the SALE first. For a $18 + $2 sale paid $10 the sale counts 44% today vs 56% under sales-first. Which order should profit follow?

## File ownership (parallel build)

- Yours: `getSalesDetail` (both arms) and `getRefundedSalesDetail` if separate, the paid/owed fragments next to `saleTotalPaidUsdEquiv` (~line 879), `buildSaleModuleDetail` reason lines in `ProfitService.ts`, your test files.
- Not yours: counterpart helper (393), by-module/by-user totals (395), other modules' `detail:` text and KEPT_CHANGE/TOPUP listing (396). Re-read a shared file immediately before each edit; surgical edits; no prettier `--write` on `ProfitRepository.ts` / `ProfitService.ts` (`--check` and report).

## Decisions taken unattended (2026-11-18)

- **D1 — which refunded sales stay listed (FR-001).** A `status = 'refunded'` sale is listed only when its SALE+REFUND residual (`salePlusRefundProfitSubquery`, USD or LBP) is nonzero (|x| > 1e-6). That sub-query already nets the refund's kept change out (counted on the refund's own day), so "zero kept change" is covered. A zero residual adds nothing to the module row, so Σ counted = module row stays exact. Filtered in TypeScript inside `getRefundedSalesDetail` (no second copy of the sub-query, binds unchanged, and the recognition guard's exclusion key for this query is unchanged).
- **D2 — "detail is the remaining lines" (US1.2).** A sale only turns `refunded` once EVERY line is refunded (`refundBySaleId` and `refundSaleItem` alike), so a listed refunded row has no remaining line. Its detail is "Refunded: <name xqty, …>" from the original lines ("Refunded sale" when no line is found). Never `null`.
- **D3 — refunded-row reason never shows an owed figure (US1.2, edge case 3).** On a refunded sale `final_amount_usd` is still the pre-refund total, and the Debts allocation does not list refunded sales (`s.status = 'completed'`), so there is no "remaining owed" figure Debts shows. Reason: "Refunded — not counted: the sale was not paid in full." (partner case: "Refunded — Partner has …"). A fully counted refunded row keeps `reason = null` (reconciliation suite pins this), so the "Refunded" marker lives in `detail`.
- **D4 — fragments (FR-002).** `salePaidUsdEquiv` / `saleOwedUsdEquiv` added next to `saleTotalPaidUsdEquiv` in `ProfitRepository.ts`; `saleTotalPaidUsdEquiv` left untouched (recognition only, no longer selected for display). `SaleDetailRow.paid_total_usd` replaced by `paid_usd_equiv` / `owed_usd_equiv` / `refunded_arm`.
- **D5 — follow-up, not done.** `DebtRepository._loadAllocationItems` carries the same paid/owed SQL inline (`salePaidSql` / `saleOwedSql`). Pointing it at the new pair is a rule-14 follow-up on a money path outside this ticket's files.
- **D6 — residual test.** No real writer leaves a residual on a whole refund today, so US1.2's two tests run the real sale + real `refundBySaleId`, then add +$5 to the REFUND row's stamp (the same shape `seedRefundedSaleWithResidualProfit` pins).
