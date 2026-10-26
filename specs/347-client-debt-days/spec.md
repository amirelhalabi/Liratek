# LIRA-347 — Settle a client's debts by day (Debts page)

Status: built 2026-10-26 (not committed). Rollout step 4 of the LIRA-343 settle-by-day calendar (OMT → other suppliers → partners → client debts).

## Owner decisions (2026-10-26, final)

- **D1 — pick days, then pay through today's repayment.** The cashier picks days on a calendar inside the Debts page's repayment window. The picked days' open items become the window's ticks (the LIRA-304/308 item picker) and the amount fills to what they owe. Paying goes through the existing `DebtRepository.addRepayment` with `targets`. A stale check refuses the payment plainly if the picked items no longer owe what was shown.
- **D2 — use the client's credit, like OMT.** "Use credit [x] of [total]" per currency, set by the cashier and pre-filled with min(what the picked days owe, the credit). The payment fills to the rest. Using credit pays the picked debts by that amount. A repayment wholly from credit is allowed.
- **D3 — debts with no item sit on no day.** Manual debt, imports, opening balance and the "Earlier balance (no items)" line show as an account line under the calendar.
- **D4 — fix first.** A refunded or voided charge that was not in a basket kept counting as open, so a later repayment could pay it instead of a real debt.

## Scenarios (acceptance)

| # | Given | When | Then |
| --- | --- | --- | --- |
| 1 | $50 'Service Debt' on 10 Oct, refunded; $50 sale on 12 Oct | the client repays $50 (every listed item ticked) | the 12 Oct sale is paid; the refunded charge is not listed and cannot be ticked |
| 2 | $50 sale on 20 Oct, $40 charge on 22 Oct | the cashier picks 22 Oct and pays $30 | only the 22 Oct charge is paid ($30 of $40) |
| 3 | $50 charge on 20 Oct, $20 credit | the cashier picks 20 Oct | Use credit = $20, payment = $30; confirm pays the charge in full; the balance drops by the $30 only |
| 4 | as 3, credit only ($20) | confirmed, then voided from Transactions | the charge goes back to $0 paid and the $20 credit is available again; every ledger nets to 0 per currency |
| 5 | a day picked, then someone pays part of it elsewhere | the cashier confirms | refused: "These debts changed since you picked the days — reload and pick again." Nothing written |
| 6 | "Use credit" above the available credit, or in the other currency | confirmed | refused: "There is not that much credit left on this account — reload and try again." Nothing written |
| 7 | a $30 manual debt | the calendar opens | "Earlier balance (no items): $30" under the calendar, on no day |

## Design

### Read: month rows (no new definition of "a debt item", rule 14)

`DebtRepository._loadAllocationItems` (the one source of the repayment's open items) gains:

- `shopDay` on every item: `localDayExpr(created_at)` (rule 27). Sales use `sales.created_at`; charges and basket rows use `debt_ledger.created_at`; basket members use their own transaction's time.
- A `range` mode (UTC window) for the calendar: the same queries, open or closed. A closed sale counts only if it went on the account: a 'Sale Debt' row, or a basket that left a 'Session Debt'. Without this rule every cash sale would paint a settled day. A charge or basket member counts unless it was wholly reversed. Range mode reads no routing.

`getClientDebtMonthRows(clientId, month)` returns one row per item for the shop's month (window = month ± 1 UTC day, kept by `shop_day`), shaped as the generic `SettleDayRow<"sale" | "charge" | "member">` plus label / type / basket. It also returns the two account lines.

### Account lines (one definition)

`splitAccountGap(balance, Σ open items, rate)` (`utils/debtSettleDays.ts`, pure). Per currency, `gap = balance − open items`: a positive gap is debt with no item (`earlier_*`), a negative gap is credit not applied to any item (`credit_*`). A credit in one currency nets against a no-item debt in the other at the sell rate first, which is the existing LIRA-308 earlier-balance rule. The earlier-balance figures are byte-for-byte what `_earlierBalanceItem` computed before. That method now calls this function.

### Generic parts, widened (not forked)

`SettleDayRow<K>`, `DaySelectionKey<K>`, `buildDaySelections<K>` and `buildSettleDays` are now generic over the row kind. The default stays the OMT kinds, so supplier code is unchanged. `buildDebtDayTargets` (the ONE payload builder for picked days, rule 22) wraps `buildDaySelections` and enters the credit as an ACCOUNT row. It returns the ticks, what they owe, the clamped credit use and the payment pre-fill.

### Write: `addRepayment`

Three new optional schema keys in `addRepaymentSchema`, shared by IPC and REST and consumed in the same change (rule 23 three-way diff: schema = preload type = handler `RepaymentData` → `DebtService` → `CreateRepaymentData`):

- `expectedOwed {usd, lbp}`: the stale check. With `targets`, the server recomputes `ownTargetsOpen(items, targets)`, the same shared function the page uses, over the cashier's own ticks and not the `auto` ones. A mismatch → `DEBT_DAYS_CHANGED`, thrown before anything commits.
- `creditUseUSD` / `creditUseLBP`: refused above `_accountLines(...).credit_*`, measured without the repayment's own row (`DEBT_CREDIT_NOT_AVAILABLE`). The credit is added to the allocation's coverage budget (`reductionUsd/Lbp`), so it pays the ticked items first, strictly in the same currency. Routing to the OMT/Whish cash drawer stays capped by the cash.
- The refine also accepts a repayment wholly from credit. "Nothing at all" is still refused.

**Deviation from the brief's wording ("CREDIT_USED + coverage"), stated plainly:** no `CREDIT_USED` ledger row is written. The client's credit already lowered the ledger balance when it was deposited (balance = Σ rows). A bare positive `CREDIT_USED` row would add the credit back onto what the client owes, charging them twice. Folding the credit into the 'Repayment' row would inflate "debt payments" in the Closing report and the dashboard, which both sum 'Repayment' rows. Credit use is therefore coverage only. It is recorded on the repayment's metadata as `credit_used` and inside the existing exact coverage record. The ledger balance and drawers move by the cash alone.

### Reversal owner (rule 20)

Credit use writes no new ledger row. It adds coverage, which the repayment's coverage record (`REPAYMENT_COVERAGE_KEY`) already captures. The existing void / refund of the DEBT_REPAYMENT (`TransactionRepository._restoreRepaymentDebt`) gives back exactly that coverage. Because credit is derived (balance − open items), it comes back by itself. Pinned by create + void = 0 tests over drawers, balance, charge / member coverage, sales paid and the account lines (`DebtRepository.lira347Days.test.ts`).

### D4 fix (rule 14, one place)

`refundReversedSql` (`sessionDebtCoverage.ts`) gives the magnitude a charge's own 'Refund Reversal' rows cancelled. It matches on the same `transaction_id` with `=`, so a basket's NULL-linked reversals never match, and it counts only negative amounts, so a sale's positive change-credit reversal never re-opens a charge. `coverageOutstandingSql` subtracts it, and the routing cap uses it instead of its own copy. The fix is read-side, so it also corrects charges refunded before it.

### Transports

- IPC `debt:get-month-rows` ({clientId, month}, same access as `debt:get-open-items`, invalid payload throws) — classified `read` in `offline/channelPolicy.ts`.
- REST `GET /api/debts/clients/:clientId/month-rows?month=YYYY-MM` validates with the same `debtMonthRowsSchema` (router-level `authenticateJWT`) and returns `{ success, data }`. The adapter returns the raw object.
- Offline replay (`debt:add-repayment` is offline-classified). A replayed repayment whose picked days changed meanwhile is refused by the stale check. It is then booked again without its ticks and without the stale figure, noted `ticks_dropped`, the same rule as a ticked item no longer open (LIRA-306 FR-029).

### UI (Debts page → Settle Debt)

A "Pick days on a calendar" button above the item list opens `DebtDayCalendar`, built from the generic `SettleCalendar` / `SettleSelectionBar` / `SettleDayDetails`. It has one state per day, $ / L badges, the amount left this month, the "N unselected days in <Month>" link and the day details with per-item untick. Picking days re-ticks the list and re-fills the amount. Under the calendar are the account lines: the earlier balance, and "Use credit [x] of [total]" per currency. Opening the calendar changes nothing until a day is picked.

## Not done / open

- **↺ undo marks**: not added. A void of a repayment that used credit brings the credit back by itself, because credit is derived, so there is no account row to mark.
- **Day details** show no "paid by #id" lines: debt coverage is recorded per repayment in metadata, not in a coverage table, so there is no cheap per-item "which repayment paid this" read.
- **What's new card + real screenshot** (rule 30): owed. Needs the web e2e screenshot run.
- Cross-currency edge: when a USD credit nets against an LBP no-item debt (LIRA-308 rule), the credit offered is what is left after that netting.
