# Research: OMT settlement by day (LIRA-343)

All findings below come from reading the code on 2026-10-26 (three read-only research passes plus spot checks). Nothing was run. Line numbers are approximate and must be re-checked when a task touches the file.

## R1 — Settle request: send `selections`, not days

- **Decision**: The sheet turns the picked days, minus the transfers unticked in a day's details, into the existing `selections` list (`{ kind, id }[]`, `validators/supplier.ts` ~:266). The server keeps scoping by `selections` in `_amountFirstScope` (`SupplierRepository.ts` ~:6619). One new optional key, `include_account_credits: true`, makes the server add every open account credit (R4) to the scope.
- **Rationale**:
  - The write path stays as it is: one payload builder (rule 22), the stale check on `expected_owed` (~:6125), the "a ticked transfer is no longer open" refusal (~:6633), and `metadata_json.selections` as an audit of exactly what was settled.
  - The server never has to work out a day on the write path, so rule 27 cannot bite there.
  - Unticked transfers (FR-016a) are simply left out of the list.
- **Side effect (intended)**: a transfer recorded while the sheet is open is not settled, because it is not in `selections`. The stale check is computed over the scoped rows only, so it does not refuse in that case. The new transfer stays open and shows on the calendar after the reload.
- **Alternatives rejected**:
  - Send `days[]` + tz and resolve on the server. This duplicates day logic on the write path, needs a schema change and a tz-dependent query, and still needs `selections` for unticked transfers.
  - A new endpoint. Rejected for the same reasons.

## R2 — Where the shop day is computed

- **Decision**: The server returns a `shop_day` (`YYYY-MM-DD`) on every row it sends to the calendar, computed in the repository with `localDayExpr(col)` (`reportingTimeFragments.ts` ~:95). On web, this uses the request's `X-Client-Tz-Offset` (`'N minutes'`); on desktop, SQLite `'localtime'`. The frontend never derives a day from `created_at`.
- **Rationale**:
  - It follows rule 27 with the existing helper. The exact pattern exists in `SalesRepository.getChartData` (~:4708).
  - The grouping util stays pure: it takes `shop_day` strings and imports nothing from `requestDay.ts`, so it is safe to reach from `browser.ts` (rule 29).
- **Known limit**: on web, the offset is the browser's current offset. A transfer from the other side of a DST change can shift by one hour between 00:00 and 01:00. This is the same limit every other web report has today (LIRA-237); desktop is DST-correct.
- **Alternative rejected**: grouping in the browser from raw UTC strings. That is a second definition of "shop day" (rule 14), and the frontend must not parse timestamps into days.

## R3 — Month rows: extend the queue builder, no parallel query

- **Decision**: Extract the row source of `getAccountUnsettled` (~:2901) into one private builder with two modes:
  - **open**: today's behaviour, the queue.
  - **range**: every account row in a UTC window, settled or not, with coverage.
- **How the range mode differs**: it keeps the same members (`accountMemberOf`), the same two FS branches (pending-type rows and SEND cost > 0 rows, `FinancialServiceRepository.getUnsettledBySupplier` ~:6239), the same not-refunded predicates, the same FS-sibling exclusion, and the same `isSettlementCommissionCredit` exclusion. It drops only the "still open" conditions (`is_settled = 0`, `settlement_id IS NULL`). It also excludes SETTLEMENT ledger rows and account credits (R4) from "had a transaction".
- **Coverage**: computed in one batched read (`getRowCoverage`, ~:2842), not one query per row.
- **Rationale**: two independent definitions of "an account row" would drift. A day could then look green while the queue still holds an open row on it. An invariant test pins the two together: for every day and currency, owed − covered over range rows = the queue's remaining over that day's open rows.
- **Notes**:
  - **Activity branch (fix after review)**: the pending-type FS branch alone misses FS rows born settled (non-pending types, wallet sales with nothing owed). Range mode adds a third FS branch for those rows with owed 0, so a day whose only rows are of these types shows green, never grey (owner rule: any OMT-account transaction counts).
  - `NOT_REFUNDED_SQL` (`FinancialServiceRepository.ts` ~:1608) must be exported, not re-typed.
  - FS rows born `is_settled = 1` with no settlement (non-pending types) count as activity with nothing owed, so such a day shows green.
  - Legacy whole-row settled rows (pre-LIRA-322, `settlement_id` set, no coverage rows) are closed: they count as fully paid.
- **Window**: the shown month ± 1 day in UTC, then filtered by `shop_day` inside the month. This catches 00:00–03:00 Beirut rows stored on the previous UTC day.

## R4 — Day credits vs account credits

- **Owner decision 2026-10-26** (spec clarifications): there are two kinds of "OMT owes the shop".
- **Classification is by provenance, not sign (fix after review)**. A LEDGER row is an **account row** when a settlement created it (`transaction_id` points at a `SUPPLIER_SETTLEMENT` transaction: overpay rows of either sign, commission credits) or a manual Pay / Receive wrote it (no `source_ref_table`, entry `PAYMENT` / `SUPPLIER_PAYS_US`). Account rows of either sign sit on no day, are always in scope with `include_account_credits`, and net against each other first. A positive one (the shop collected more than OMT owed, so it owes that back) shows inside the "OMT credit" line as a negative credit. Every other row is a **day row**. Among day rows, an open row with negative remaining is a:
  - **Day credit** if it is a FINANCIAL_SERVICE row (a counter RECEIVE), or a LEDGER row that points at a source transaction (`source_ref_table` set). The OMT App cash-out is written as `PAYMENT` with `source_ref_table = 'recharges'` (`RechargeRepository.ts` ~:2997).
  - **Account credit** if it is a LEDGER credit with no source: overpay rows (`_insertSettlementOverpayRows` ~:3255, `PAYMENT`/`SUPPLIER_PAYS_US` with `transaction_id` = the settlement), the amount-first commission credit (`_bookAmountFirstCommission` ~:6959, link-mode `SUPPLIER_PAYS_US`), and manual Pay / Receive `PAYMENT` rows.
- **To verify in tasks**: list every writer of a negative `supplier_ledger` row for OMT-account members and classify each one, failing-first if any writer lands in the wrong class. The queue row needs `source_ref_table` added to `AccountUnsettledRow`.

## R5 — Allocator: account credits fill the gap

- **Update (owner 2026-10-26, "I want to be in control")**: the user sets how much account credit to use (`credit_used`, per currency, 0 ≤ x ≤ min(D, Σcredits) when the shop pays). The allocator uses exactly `credit_used` (oldest credit first) and then the money; it no longer derives credit use from the payment. The steps below are kept for the OMT-pays case and as history; where they say "shortfall decides", read "`credit_used` decides".
- **Decision**: Extend `allocateAccountSettlement` (`utils/accountSettleAllocation.ts`, pure) with an optional `account_credits` list, kept apart from `rows`. Per currency:
  1. Day credits in `rows` net against debts in `rows`, as today.
  2. Let D = signed net owed of `rows` and M = signed money.
  3. **Shop pays (D > 0)**: shortfall = max(D − M, 0). Account credits cover min(shortfall, Σcredits), oldest first, as NETTING coverage against the oldest debts. Then the money covers the rest, oldest first. Anything beyond D is extra, as today.
  4. **OMT pays (D ≤ 0, M < 0)**: received money covers the day credits in `rows` first, then the account credits, oldest first. Anything beyond is extra.
  5. **Pre-fill**: the sheet computes D − Σcredits per currency.
- **Invariant kept**: at most one part-paid row per currency. When the shop pays, either the credits run out (a debt may be part-paid) or the shortfall is fully covered (one credit may be part-used), never both. When OMT pays, a credit can only be part-used after every day credit is closed.
- **Owner tables** (spec clarifications) become table-driven allocator tests, written failing-first.
- **Alternative rejected**: put account credits in `rows`. The step-1 netting would then always use them in full, which contradicts the $375 and $380 rows of the owner's table.

## R6 — "Settled up to <date>"

- **Decision**: No new endpoint and no stored setting. The sheet offers a one-time "Settle old history up to…" action. It builds `selections` = every open debt and day credit with `shop_day` ≤ the date, sets `include_account_credits: true`, and sends money 0 in every currency.
- **Why no new money logic is needed**: by R5, D > 0 and M = 0, so the account credits cover min(D, Σcredits) oldest first and nothing else moves.
- **Evidence**: a zero-money netting-only settlement is already accepted. The only guard is "nothing to settle" (`SupplierRepository.ts` ~:6200), which NETTING takes satisfy. The anchor ledger row is written as 0/0 (~:6259). It is undone like any settlement (FR-018) and nets to zero (FR-020).
- **Not done**: a date filter on the credits. Owner decision: account credits are used whatever their date (old payments are often dated after the transfers they paid).

## R7 — "Added after settlement" tag: no migration

- **Finding**: No column stores the real entry time of a back-dated transfer. `financial_services.created_at` and `transactions.created_at` both hold the business time (`FinancialServiceRepository.ts` ~:2750, `TransactionRepository.ts` ~:1713). iPick / OMT App ledger rows cannot be back-dated (`RechargeRepository.topUpFromSupplier` takes no time; `addLedgerEntry` stamps `requestNow()`).
- **Decision**: Derive the tag from ids, which only grow in insert order. An open FINANCIAL_SERVICE row is "added after settlement" when its unified `transactions.id` is greater than the `transaction_id` of an active coverage row on another row of the same `shop_day`.
- **Rationale**: Exact for the case the owner described, with no schema change. Migrations stay at v224.
- **Alternative rejected**: a new `entered_at` column (v225). It needs a migration and writer changes, and old rows would have NULL anyway.

## R8 — Day details read

- **Finding**: Nothing exposes "which settlement paid this row". `getRowCoverage` returns sums only (~:2842).
- **Decision**: A new read, `getAccountDayDetail(accountId, shopDay)`. It returns the day's range rows (R3) plus, per row, its active coverage rows grouped by settlement (`transaction_id`, settlement date, currency, amount) and the R7 tag. It is a read only, with no role gate beyond the existing `account-unsettled` read (`supplierHandlers.ts` ~:67, `suppliers.ts` ~:259).

## R9 — Statement types (LIRA-256) on the calendar

- **Finding**: Model-1 OMT rows outside the chosen statement types cannot be settled (`_amountFirstScope` ~:6653). The sheet's "Which OMT shares" choice decides which rows those are.
- **Decision**: A day's colour uses every open row, because they are all owed, so the colour never changes with the sheet's choice. When building `selections`, rows not covered by the chosen types are left out (as today), and the day's details show them as "waiting for its statement type".
- **Rationale**: Day colour reflects what is owed, not a filter. The existing `settlementScope` already excludes waiting rows.

## R12 — Undo and void with no exception (owner 2026-10-26)

- **Decision**: Remove the two refusals for OMT accounts: `_assertSettlementIsNewestOnItsRows` (undo) and `_assertNoActiveSettlementCoverage` (void / refund of a covered row). Later settlements are never changed. What they relied on is moved to the account:
  - **Undo #A when a later settlement used #A's account credit** (or #A's coverage on a row a later settlement also covered): reverse #A's money and its own coverage as today. Keep the consumed part of #A's credit row in place, because #B's coverage still points at it. Then book a balancing **account row** of the same amount and the opposite sign ("Undo of #A: credit already used by #B"). The net balance moves exactly as if #A never happened, and the open queue shows "you owe OMT $X" on no day.
  - **Void or refund a covered transfer**: reverse the transfer as today. The settlement's coverage on it is converted into an account credit of the applied amount, so the settlement keeps its money and the account shows "OMT owes you $X".
- **Reversal owner (rule 20)**: the balancing account row belongs to the undo / void transaction that wrote it, and is reversed only if that transaction is reversed (settlement undo is final; a voided transfer is not restored). Its row is linked by `transaction_id` = the undo / void transaction, so `row_scope = 'ACCOUNT'`.
- **Invariant (failing-first test)**: after every create, undo and void, in any order, per currency: account balance = Σ open remaining in the queue (day rows + account rows). Seeded property test over random settle / undo / void sequences, extending `SupplierRepository.lira322Invariant`.
- **Exact row mechanics** (which existing rows are soft-voided vs kept, where the balancing row is inserted) are fixed in tasks against the invariant test, starting failing-first.
- **Replaces**: R10's reworded refusal (no longer needed) and LIRA-322 FR-018 for OMT accounts.

## R10 — Void message (superseded by R12)

- **Decision**: Reword the refusal in `TransactionRepository._assertNoActiveSettlementCoverage` (~:7819) to name the settlement and its shop day: "Can't void #440 — it was paid to OMT in settlement #10061 (18 Oct). Undo settlement #10061 first, then void."
- **Constraint**: The core only has the UTC time, so the day in the message uses `clientDayOfUtcTimestamp` (request path).
- **Existing tests**: tests that match the old message text must be updated to the new text, read from one exported constant.

## R11 — Performance

- **Estimate, not measured**: one month of one account is a few hundred rows.
- **Indexes the range query can use**: `idx_financial_services_provider_type_created_at` and `idx_financial_services_created_at` on the FS side, and `idx_supplier_ledger_supplier_id_created_at` on the ledger side. Coverage is one batched `IN (…)` read served by `idx_ssc_row`.
- **To measure in quickstart**: time the calendar read on the test shop.
