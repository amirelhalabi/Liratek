# LIRA-345 — Settle by day for suppliers outside the OMT account

Rollout step 2 of the LIRA-343 calendar (`specs/343-omt-settle-by-day/`). Short spec: the decisions, the scope and what is out. The day model, the allocator, coverage, undo / void (R12) and the payload are LIRA-343's, unchanged.

## Owner decisions (2026-10-26, final)

| # | Decision |
| --- | --- |
| S1 | The calendar is for **Katsh top-ups**, **product suppliers** (`is_system = 0`, no provider) and **Whish when active**. **Loto stays on its checkpoints** (out). **Katsh bill commission stays on today's "Settle" tick list.** |
| S2 | **Strict per currency**: no conversion; a $ payment never pays an LBP debt. Old history is closed by the existing "Settle old history up to D" (a no-money settlement that uses account credit). |
| S3 | **Pay / Receive is hidden** for calendar suppliers, as for OMT account members since LIRA-322. |
| S4 | **Whish commission uses the account model**: pay in full; the commission becomes a Whish credit used at the next settlement (`_bookAmountFirstCommission`). |

## Design: an "account of one"

The LIRA-343 queue (`SupplierRepository._accountRows`), allocator, coverage and undo / void relief are already generic over a supplier id through `accountMemberOf` (`id = ? OR account_supplier_id = ?`). A supplier with no children is an account of one member. So:

- **No migration, no new channel.** `suppliers:account-unsettled` / `account-month-rows` / `account-day-detail` / `settle-account` and their REST twins already take any supplier id.
- **One rule** `settlesByDay(supplier)` in `packages/core/src/utils/settlesByDay.ts` (browser-safe leaf, rule 29), used by:
  - the Suppliers page (Settle Account button, Pay / Receive hidden, tick list bills only);
  - the server gate: the amount-first `settleAccount` refuses any other supplier, Loto included (`SupplierService.settleAccount` → `SupplierRepository.settlesByDay`);
  - the Transactions labels: they come from coverage, not the oldest-first pool estimate (`FinancialService.getAllByProvider`).
- Companion rules in the same file: `billsStayOnTickList` (Katsh, Whish: the calendar leaves their BILL rows out, both modes) and `calendarTakesCommission` (OMT account, Whish: the sheet shows the commission field).

### Day rows and account rows (LIRA-343 R4, unchanged rule, one fix)

- **Day rows**: TOP_UP, STOCK_INTAKE, RECORDED_DEBT ledger debts; Whish SEND / RECEIVE `financial_services`.
- **Account rows**: manual Pay / Receive (`PAYMENT` / `SUPPLIER_PAYS_US`, no source), settlement overpay and commission credits, undo / void relief rows, and now **every supplier `DISCOUNT`** (fix: a Pay-with-discount's DISCOUNT is linked to the Pay with `source_ref_table = 'supplier_ledger'` and was classed as a day row). One rule, two twins kept in step: `rowScopeOf` / `accountRowScopeSql`.

### Fixes that come with it

- The detach count (`_countOpenUnsettledRows`) uses the same open-row SQL as the queue (`openAccountLedgerRowSql`), so legacy SETTLEMENT rows and settlement commission credits never block detaching a member.
- The "Settle" tick list (`settleTransactions`) refuses a transfer the calendar already part-paid (it would pay the covered part twice).
- Voiding a Pay whose DISCOUNT a calendar settlement used is no longer refused: like the Pay's own row (R12), what the settlement used goes back on the account (`_planSettlementCoverageRelief` counts the discount as removed). A discount closed by a whole-row legacy settlement (no coverage) is still refused.
- Voiding a supplier top-up (Katsh, and iPick / OMT App inside the OMT account) that a settlement paid now puts what was paid back on the account. Before, the void soft-voided the link-mode TOP_UP row but left its coverage active, so the ledger balance and the open queue disagreed. The void and the relief planner share one selector (`LINKED_TOP_UP_LEDGER_WHERE`).
- On the sheet for a supplier outside the OMT account, "See in Transactions" and LIRA-344's "Remove credit" (booked as "OMT credit not accepted") are not offered.
- The amount-first refusals name the supplier ("Katsh's balance changed…", "You pay Katsh in USD…", "of Katsh credit"); the sheet recognises a stale refusal with `isSettleStaleMessage`, whatever the name. OMT wording is unchanged.

### Sheet

`AccountSettleSheet` takes `{ account_supplier_id, account_name }` plus `showStatementTypes` (OMT account only) and `showCommission` (`calendarTakesCommission`). Direction buttons and the ↺ undo / void text name the supplier.

## Out of scope

- Loto (checkpoints), partners (LIRA-346), client debts (LIRA-347).
- Other company suppliers outside the OMT account (Whish App, OMT App or iPick when not linked): they keep Pay / Receive.
- `supplier_purchases.paid_usd` (the product suppliers' old FIFO coverage) stays as it is. The calendar does not read it, and it stops moving once Pay / Receive is hidden.
- No server refusal on Pay / Receive (`recordSupplierCashflow`) for calendar suppliers: S3 hides the tab only. A payment recorded another way lands on the account as credit.

## Open questions

- **Whish bills.** The seeded Whish supplier has `is_system = 0`, so the page treats it as a product supplier (Purchases tab, no "Settle" tick list). Its bills are left off the calendar (`billsStayOnTickList`) and have no tick list on the page, as before this change. Decide where Whish bill commission is settled.
- **Cutover labels.** Katsh and Whish transfers that read "Paid" because of an old Pay / Receive payment now read as owed until a settlement (or "Settle old history up to…") uses that payment.
- **What's new card**: needs a real screenshot of the calendar on Katsh or a product supplier (rule 30).
