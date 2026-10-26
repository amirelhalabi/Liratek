# Data model: OMT settlement by day (LIRA-343)

**No schema change.** No migration (the last migration stays v224). Days are never stored (owner 2026-10-26). Everything below is either an existing table or a value worked out on read.

## Stored (existing, unchanged)

| Table | Role here |
| --- | --- |
| `financial_services` | OMT counter transfers and bills. Each row is one currency, `supplier_owed` (signed: + the shop owes, − OMT owes, e.g. RECEIVE), and `created_at` (UTC business time, may be back-dated). |
| `supplier_ledger` | iPick / OMT App charges, OMT App cash-outs (`PAYMENT`, `source_ref_table = 'recharges'`), receives, overpay rows, the commission credit and manual Pay / Receive. Amounts are signed. `created_at` is UTC; these rows cannot be back-dated. |
| `supplier_settlement_coverage` (v217) | "Paid so far": one row per settlement × row × currency, with `amount`, `source` (`PAYMENT` / `NETTING` / `WAIVE`), `transaction_id` (the settlement) and `is_reversed`. |
| `transactions` | Unified rows. `id` grows in insert order (used for the R7 tag). |

## Derived values

### Account row (queue row, extended)

Existing `AccountUnsettledRow` (`SupplierRepository.ts` ~:799) plus three new fields:

| Field | Meaning |
| --- | --- |
| `shop_day` | `YYYY-MM-DD`: the shop's calendar day of `created_at`, computed by the repository with `localDayExpr` (research R2). |
| `source_ref_table` | For LEDGER rows: the source link, or null. Used by the credit classification. |
| `row_scope` | `'DAY'` or `'ACCOUNT'`, by provenance, not sign (research R4). Comes from ONE exported predicate. Account rows of either sign never sit on a day. |

The same row shape is returned in **range** mode (research R3). There it also includes closed rows: legacy closed rows have remaining 0, and the covered amount is their amount.

### Day (never stored)

Computed by one pure function, `buildSettleDays(rows, { today, month, coveredTypes })`, in `packages/core/src/utils/settleDays.ts` (generic: any settlement screen whose rows carry `shop_day`, signed `remaining_*`, `amount_*` and covered amounts; owner 2026-10-26 "generic is a great idea"). It is browser-safe: it takes `shop_day` strings and imports no `requestDay.ts` (rule 29). Account credits are ignored here.

| Field | Rule |
| --- | --- |
| `day` | The `shop_day` key. |
| `state` | `NONE` if there are no rows, `SETTLED` if there are rows but none open, `UNPAID` if rows are open and nothing on the day is covered, `PARTIAL` if rows are open and something is covered. "Something covered" means any coverage on the day's rows, or any closed row on the day. |
| `left_usd`, `left_lbp` | Signed sum of remaining over the day's open rows (day credits net in). |
| `owed_usd`, `owed_lbp` | Sum of positive amounts over all of the day's rows (debts only). |
| `paid_pct_usd`, `paid_pct_lbp` | `(owed − max(left,0)) / owed`, or null when that currency has no debt that day. |
| `currency_state_usd`, `currency_state_lbp` | `OWED` / `PART` / `PAID` from the %; drives the "$" and "L" badges. |
| `selectable` | `state` ∈ {UNPAID, PARTIAL} and `day` ≤ today. |
| `account_marks` | Open account rows written by an undo / void on this day (shop day of that undo / void transaction), each `{ origin: 'UNDO' | 'VOID', ref, currency, amount }`. Drives the ↺ badge and its hover text; ignored by `state`. |
| `waiting_count` | Open rows not covered by the chosen statement types (research R9); shown in the day's details. |

The month total ("left this month") is the sum of `left_*` over the month's days.

### Account credit (never on a day)

`account_credit_usd`, `account_credit_lbp` are the signed sums of open rows with `row_scope = 'ACCOUNT'` (either sign). They are shown as one "OMT credit" line and always added to the settlement scope (`include_account_credits`).

### Selection (sheet state only)

| Field | Meaning |
| --- | --- |
| `pickedDays: Set<shop_day>` | Default: every selectable day before today, across months, from the open queue run through `buildSettleDays` (so account rows, often dated today, never make a day look open). |
| `untickedRows: Set<"KIND:id">` | Transfers unticked in a picked day's details (FR-016a). A day with any unticked row shows as "partly picked". |
| `selections` (payload) | Open rows whose `shop_day` ∈ `pickedDays`, minus `untickedRows`, minus rows waiting for their statement type. Built by ONE function (rule 22). |
| `expected_owed` | Signed remaining over `selections` plus all account credits, per currency. The server recomputes the same value (stale check). |
| `creditUsed` | Per currency, set by the user: pre-filled min(what the picked days owe, account credit), editable 0…that limit. Sent as `credit_used`. |
| Pre-fill | Payment = what the picked days owe − `creditUsed`, per currency; follows `creditUsed`; a payment typed later does not change `creditUsed`. |

### "Added after settlement" tag (never stored)

An open FINANCIAL_SERVICE row is tagged when its unified `transactions.id` is greater than the `transaction_id` of an active coverage row on another row of the same `shop_day` (research R7).

## State changes

| Event | Rows written | Day effect |
| --- | --- | --- |
| Settle picked days | 1 settlement; legs; coverage rows (`PAYMENT`, and `NETTING` for day credits and account credits used); overpay credit if extra | Covered days → SETTLED or PARTIAL |
| Undo settlement | Coverage `is_reversed = 1`, money reversed (existing) | Days return to their earlier state |
| Back-dated transfer | The transfer only | Its day → PARTIAL (tagged) |
| Undo a settlement others relied on | Its reversal as today + one balancing account row for what later settlements used (R12) | Its days reopen; later days unchanged; account shows "you owe OMT $X" |
| Void a covered row | The void as today + the settlement's coverage on it converted to an account credit (R12) | Day unchanged; account shows OMT credit |
| Settle old history up to D | 1 zero-money settlement; `NETTING` coverage between account credits and debts with `shop_day` ≤ D | Old days → SETTLED where really covered |

## Validation rules

- Money in one currency never covers rows of the other (unchanged).
- At most one part-paid row per currency (allocator invariant, R5).
- Create + undo nets to 0 on every ledger, per currency (FR-020).
- Range-mode totals equal queue totals per day and currency (invariant test, R3).
