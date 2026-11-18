# Feature Specification: Profits — one total across Summary, By Module, By Date, By User

**Feature Branch**: `395-profits-one-total`

**Created**: 2026-11-18

**Status**: Draft (owner decision 2026-11-18: build)

**Input**: Owner audit of the Cornertech Profits page (2026-11-16): the same period shows three different profit totals depending on the tab.

## Established facts (verified on Cornertech, 2026-09-01 → 2026-11-16, admin, all figures from the REST API)

| View | Gross profit USD | Gross profit LBP | Δ vs Summary |
| --- | ---: | ---: | --- |
| Summary `totals.gross_profit_*` | 2,467.27 | 78,701,487.56 | — |
| Σ By Date rows | 2,467.27 | 78,701,487.56 | 0 |
| Σ By Module rows (`profit_usd/_lbp`) | 2,438.98 | 78,575,988 | −28.30 / −125,500 |
| Σ By User rows | 2,478.42 | 79,176,987.56 | +11.15 / +475,500 |

- The By User gap equals exactly the COUNTERPARTY_DISCOUNT module row (−11.15 / −475,500). `counterpartyDiscountSource("t")` is used by the summary (~4736), by-module (~7134) and by-date (~7649) queries, and NOT by `getByUser` (starts ~8673). By User therefore ignores counterparty discounts.
- The By Module gap (−28.30 / −125,500) equals the Summary's `kept_change` section (`usd: 28.297, lbp: 125,500`) — this is kept change on sales / other non-repayment sources. By Module's KEPT_CHANGE row holds only the Summary's `debt_repayments` kept change (29.56 / 26,500). The By Module SALE row carries separate `sale_kept_change_usd/_lbp` columns (8.83 / 243,800) that are NOT in its `profit_*` and do not match the summary section either — the agent must trace which summary line(s) make up the 28.30 / 125,500 (Summary sections: `kept_change`, `topups_buybacks`, `hold_money`, `warranty`, `supplier_commission`, …) and where By Module drops them.
- By Client is capped/limited (20 rows returned) and sums only named clients; NOT a reconciliation target here.
- Drill-downs already reconcile to their By Module row exactly (all 23 modules, verified).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Every tab shows the same gross profit for the same range (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a seeded dataset containing at least one of EVERY profit-affecting line the Summary knows (a sale with kept change, a debt repayment with kept change, a counterparty discount, a session discount, a waived shortfall, an extra charge, a payment-method fee, a top-up/buyback fee, a wrong-number recovery, a warranty cost, a supplier commission, a settled OMT commission, a loto ticket, an exchange), **When** Summary, By Module, By Date and By User are computed for the range, **Then** Σ By Module `profit_*` = Σ By Date `profit_*` = Σ By User `profit_*` = Summary `totals.gross_profit_*` (± 0.01 USD / ± 1 LBP).
2. **Given** the Cornertech figures above, **When** the fix is deployed, **Then** the three totals agree (verified by the tenant audit script, LIRA-397).

### User Story 2 — By Module shows WHERE the missing profit lives (Priority: P2)

The money that By Module dropped must appear as part of an existing row (KEPT_CHANGE, or the row whose summary section it belongs to), never as a hidden adjustment on the TOTAL line, and its drill-down must still reconcile to the row.

### Edge Cases

- A range with no transactions: all four totals 0.
- Refund of a counterparty-discounted transfer: By User reflects the reversal on the refund's day for the refunding user, the same way By Date does.
- Expenses / net profit: out of scope; only gross profit is reconciled here (Summary `net_profit_*` already equals Σ By Date net).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `getByUser` MUST subtract counterparty discounts using the SAME `counterpartyDiscountSource` fragment the other views use (rule 14), attributed to the user who booked the discounted transaction.
- **FR-002**: By Module MUST include the sale-side / non-repayment kept change (the Summary's `kept_change` section) in a row with a drill-down that reconciles to it (extend the KEPT_CHANGE row and `buildKeptChangeModuleDetail`, or whichever row the Summary section maps to — the agent decides after tracing, and documents the mapping in `docs/FEATURE_GUIDE.md`'s Profits section if one exists, else in the spec).
- **FR-003**: A core reconciliation test `ProfitService.allViewsOneTotal.test.ts` (real schema, real write paths for each line type where one exists) MUST assert the four-way equality and MUST be seen failing first on today's code (two failures expected: by-user and by-module).
- **FR-004**: `profitRecognition.guard.test.ts` (GATE_FRAGMENTS / EXCLUDED_UNITS) stays green; register any new unit instead of excluding it.

## Success Criteria *(mandatory)*

- **SC-001**: The four totals agree on the seeded dataset and on Cornertech (audit script PASS on check "views agree").

## Assumptions / Decisions taken (2026-11-18)

- Summary `totals.gross_profit_*` is the reference definition of gross profit; other views conform to it, not the reverse.
- By Client stays out of the equality (it is a top-N list).

## Open questions for the owner (do not block)

- None.

## File ownership (parallel build)

- Yours: `getByUser`, the by-module aggregation (`getByModule` in `ProfitService.ts` and the repository queries it calls for KEPT_CHANGE / whichever row you extend), `buildKeptChangeModuleDetail` ONLY for adding the new source (396 is separately removing zero rows from that same builder — coordinate by keeping your change to the SQL source union and the row mapping, and re-read before each edit), your test file.
- Not yours: counterpart helper (393), sale drill-down (394), FS/loto/maintenance/custom labels (396). Re-read shared files immediately before each edit; surgical edits; no prettier `--write` on `ProfitRepository.ts` / `ProfitService.ts` (`--check` and report).

## Decisions taken unattended (2026-11-18)

- **Gap mapping (FR-002).** By Module's −28.30 / −125,500 is the modules' off-currency kept change (FINANCIAL_SERVICE_* incl. mobile providers, RECHARGE_*, LOTO, EXCHANGE), which sat in additive `kept_change_*` fields outside every `profit_*`. It equals Summary `kept_change` − refund kept change; on Cornertech, refund kept change is presumably 0 (KEPT_CHANGE row = debt_repayments). The SALE row's `sale_kept_change_*` is NOT part of the gap: it is already inside SALE's `profit_*`. See plan.md.
- **Where the money goes.** It moves into the existing **Kept Change** row's `profit_*` (the Summary section it belongs to), not into each module's own profit, because each module's drill-down deliberately excludes kept change. The `kept_change_*` side figures are no longer set on module rows, so the page's TOTAL (which added them) does not count the money twice. The per-row "off-currency kept change" note on a module row therefore no longer shows; each module's own drill-down still notes "kept change +X" per transaction.
- **Kept Change count.** It stays the debt/refund event count. A module's kept change belongs to that module's transaction, which that row already counts.
- **Kept Change drill-down.** It reads the existing per-module detail queries (recharge, transfer, loto, exchange; exchange gained a `kept_change_usd` column), weighted like each module's totals (debt pending → 0, partner coverage, FS unrecognised or third currency → 0). The weight expressions were NOT factored out of the module builders that 396 is editing; they are repeated once in the new helper. Follow-up: share one weight helper.
- **By Cashier counterparty discounts (FR-001).** Credited to the discount row's own `user_id` and day, the same rows By Date sums. Each discount row counts as one transaction in the Avg Profit/Txn denominator (`recognized_transaction_count`), matching the By Module Discounts count. By Client is unchanged (out of scope).
- **By Cashier caption.** It said "Excludes counterparty discounts", which is now false. It was updated in `packages/ui` en/ar `profits.json`.
- **Session discounts in By Cashier.** The test seeded one. No third failure appeared, so nothing changed there.
