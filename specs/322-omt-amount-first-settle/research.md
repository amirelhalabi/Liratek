# Research: OMT settlement by amount, one currency at a time (LIRA-322)

Sources: two code maps of the current account settle path (server and frontend, 2026-10-15) and a live reproduction on test.liratek.shop. `SR` = `packages/core/src/repositories/SupplierRepository.ts`, `TR` = `TransactionRepository.ts`, `FSR` = `FinancialServiceRepository.ts`. Line numbers are as of commit `7b921120`.

## Findings in today's code (read, not run unless stated)

| # | Finding | Where | Tier |
| --- | --- | --- | --- |
| F1 | The sheet collapses a mixed USD+LBP selection into one USD figure. The server checks each currency separately and refuses it. | `accountSettleMath.collapseNetBalance`, sheet 228-269; `_resolveSettlementLegs` SR:2805 | **Certain** (reproduced live: "expected at least $497.00 + 900000 LBP, paid $507.11 + 0 LBP") |
| F2 | Every selected row is settled whole (`settlement_id` stamp with a `.changes` guard). No partial-coverage column exists on `financial_services` or `supplier_ledger`. | SR:4303-4368, 5433-5456 | Certain (code + schema read) |
| F3 | The settlement's commission credit row (`SUPPLIER_PAYS_US`, −commission, `source_ref_table='supplier_ledger'`) keeps `settlement_id` NULL. The queue's ledger filter only excludes `source_ref_table='financial_services'`. So after a settlement with commission, that credit shows up in the OMT queue as an open credit and can be applied a second time. | written SR:4044-4056, filter SR:2588-2604 | **Likely, from reading both sites** (no other stamp found by grep). Not run. |
| F4 | The sheet sends `amount_* = |gross net|` while the server compares it with net − entered commission. Entering a commission on the account sheet is therefore likely refused today. | sheet 309-312; SR:4944 | Likely, from reading. Not run. |
| F5 | The Paid / Partial / Unpaid labels come from a separate USD-only estimate over manual Pay / Receive payments. They have no link to account settlements, and LBP rows are compared with the USD pool. | `FinancialService.getAllByProvider`, `getManualPaymentPools` SR:2117 | Certain (code read) |
| F6 | Each OMT transfer already writes an auto `TOP_UP` ledger row (`source_ref_table='financial_services'`), so its debt sits in the balance (ledger sum). The queue reads the transfer row itself and excludes the sibling. Settling never touches the sibling; the settlement's own ledger rows offset it. | FSR:5015-5028; SR:2588 | Certain (code read) |
| F7 | Validation runs before the `db.transaction` (SR:5137), against an earlier read. | SR:4747-5041 | Certain |
| F8 | `MultiPaymentInput` already takes per-currency `totals[]` (Debts repayment uses `[{USD},{LBP}]`), but one box has one `payer` direction. | MultiPaymentInput props ~95; Debts 2560-2606 | Certain |

F3 and F4 are fixed by this design (R6, R9). Each gets a failing-first test before the fix (rule 17).

## Decisions

### R1 — Coverage lives in its own table, not in columns on the rows

- **Decision**: new table `supplier_settlement_coverage`. Each row records how much one settlement applied to one queue row in one currency, and from which source. "Paid so far" = SUM of active coverage. Rows still close by today's `settlement_id` stamp once fully covered.
- **Rationale**: a void must give back exactly its own share (FR-018). A table keyed by settlement gives that exactly. One table serves both row kinds (`FINANCIAL_SERVICE`, `LEDGER`) and both currencies, so no second definition is needed (rule 14). Whole-row settlements keep their existing stamps, so the existing reversal and reports keep working.
- **Alternatives**: `covered_usd/covered_lbp` columns on `financial_services` and `supplier_ledger`, as `debt_ledger` does (v129). Rejected: a void would have to reconstruct its share newest first and could not tell sources apart (money, netting, commission, waive). It would also mean two tables to keep in step.

### R2 — One pure allocator, shared by the sheet preview and the server

- **Decision**: `packages/core/src/utils/accountSettleAllocation.ts`, pure math, re-exported from both `index.ts` and `browser.ts`. It builds on `allocateFifo` (`utils/fifoCoverage.ts`). It must stay a leaf: no imports beyond pure utils (rule 29; the `browserEntryIsNodeFree` guard checks this).
- **Order**: by `created_at` string, then kind (`FINANCIAL_SERVICE` before `LEDGER`), then id. Strings are compared, never parsed with `new Date()`. `'YYYY-MM-DD HH:MM:SS'` sorts correctly as text and parses inconsistently across engines. This matches SQL `ORDER BY created_at, id`.
- **Rationale**: the preview (FR-007) and the write must agree to the cent, so they share one function (rule 14).

### R3 — Signed per-currency budget; credits net first

For each currency independently, all amounts signed (positive = shop owes OMT):

1. **Netting**: open credits (negative rows: receives, OMT App cash-outs, earlier payments, overpay credits) are applied oldest first to open debts (positive rows), up to the smaller total. Both sides get `NETTING` coverage of equal size. No money moves.
2. **Settlement budget** `S = P + c + w`:
   - `P` = money: + IN legs − OUT change legs in this currency when the shop pays. When OMT pays the shop, the IN legs count negative.
   - `c` = commission entered in this currency (always reduces what the shop owes).
   - `w` = waive, signed with the currency's direction.
   - `S > 0` covers remaining debts oldest first. `S < 0` covers remaining credits oldest first.
3. **Extra**: budget left after every in-scope row is covered goes on the account as credit, per LIRA-315 (`_bookSettlementOverpay`, one row per currency). The calculation is the only source of `extra`; `_resolveSettlementLegs` only validates legs (method, cash-only change, change ≤ extra).

Worked check, owner's numbers: credit $60, debts $152, $101, …; P = $100.
- Netting: $60 onto the $152.
- Budget: $92 finishes the $152, and $8 goes to the next $101.
- Matches spec US3 scenario 3.

COLLECT check: credits −$100, P = −$100 (received), c = 0, so S = −$100 and the credits close.

### R4 — Commission recognition

- The entered commission `c` is a coverage source (owner: gross closes a transfer; commission counts toward coverage).
- **Profit**: `c` is allocated over the commission-model-1 transfers this settlement **fully closes**, in proportion to the amount each one still owed before this settlement. The existing `allocateProportional` and `settlement_commission_allocations` are reused (one allocation row per closed transfer). Reusing them also keeps "one allocation per transfer" true.
- **Refusals**: entered commission with no model-1 transfer closing in that currency (spec edge case). The existing "commission member" rule still applies: closed model-1 rows across more than one member are refused (SR:4828).
- **Deferred OMT App cash-out commission** (`_sumCashoutCommission`) is counted only for cash-out credit rows this settlement fully closes.

### R5 — One settlement transaction, two directions (owner decision)

- **Decision**: one `SUPPLIER_SETTLEMENT` transaction carries both currencies. `metadata_json.per_currency = { USD: {direction, paid, commission, waive, extra}, LBP: {…} }`. `amount_usd/amount_lbp` stay magnitudes, as today.
- **Ledger**: written one row per member per currency (R7), so no row mixes directions. This removes the throw in `resolveEntry` (SR:5123).
- **Payment legs**: each leg names the currency section it belongs to. A change (`OUT`) leg moves its drawer opposite to its own section's direction, in any currency (owner: change in any currency, as today). Drawers move through the existing `applyDrawerDelta` / `insertPaymentRow`. `_reversePayments` reverses each leg by its own signed amount, so no reversal change is needed for the legs (verify in a test).
- **Badge**: the Transactions IN/OUT badge for a mixed settlement is taken from its payment legs (both directions shown) instead of the static `TRANSACTION_CASH_DIRECTION.SUPPLIER_SETTLEMENT`. FEATURE_GUIDE §13 item covered in T-tasks.
- **Posting rules**: a new `postingRules.ts` entry `SUPPLIER_SETTLEMENT/account-amount-first` documents the rows written.
- **Alternative**: two transactions, one per currency. Rejected by the owner.

### R6 — Rows the settlement writes, and closing

- **Anchor**: the first member row written (commission member, else parent, else lowest member id, as today). `settlement_id` on a fully covered queue row = the anchor's ledger id, so the existing void lookup (`settlement_id IN (rows of this txn)`) finds it.
- **Netting-only settlement** (no money, credits close debts): allowed. A zero-amount anchor row is written so the transaction has a source row. The queue already filters out zero rows; the balance is unaffected.
- **Commission credit row** (F3): stamped `settlement_id = anchor`, so it no longer appears as an open credit. Old open ones from past settlements are excluded from the queue with one named predicate, `isSettlementCommissionCredit` (rule 14): `entry_type='SUPPLIER_PAYS_US' AND source_ref_table='supplier_ledger'` and is_auto. A failing-first test proves F3 first.

### R7 — Cross-member netting moves the lines (owner decision)

- When netting pairs a credit on member A with a debt on member B (A ≠ B), the settlement writes two auto ledger rows: B −x (`PAYMENT`) and A +x (`SUPPLIER_PAYS_US`). Both carry `is_auto = 1` (rule 26), `transaction_id` = the settlement and `note` "Auto: netted with <A> in settlement #id".
- **Reversal owner**: the existing `_reverseSupplierSettlement` soft-voids every `supplier_ledger` row `WHERE transaction_id = txn` (TR:8991). No new code, but a test proves it nets to 0 per member (rule 20).

### R8 — Void: newest first, coverage soft-voided (owner decision)

- **Guard** `_assertSettlementIsNewestOnItsRows`, run before any reversal write: refuse if another active settlement has coverage on any row this settlement covered, and was created after it. Message: "A later settlement (#id, date) paid the same transfers. Void it first."
- **Reversal**: `UPDATE supplier_settlement_coverage SET is_reversed=1 WHERE transaction_id=?`. The existing reopen of `settlement_id` rows (TR:9029-9085) then applies. A partly paid row has no stamp; its coverage going inactive is enough.
- Commission allocations are already deleted per ledger id (TR:9104).

### R9 — Contract: extend the schema, don't replace it

- `supplierSettleAccountSchema` gains a `per_currency` object and `expected_owed` (FR-021). `selections` becomes optional (an override). `direction`/`amount_*` become optional (legacy).
- **Dispatch**: with `per_currency` present, the amount-first path runs. Otherwise the legacy whole-row path runs unchanged, so the existing suites (accountSettlement, lira310AccountSettle, overpaymentCredit, coveredTypesSettlement, accountSettlementReversal) stay a regression net.
- The new sheet always sends `per_currency`.
- `preload.ts:745-774` (hand-typed payload) is replaced by the schema-derived type (rules 21, 23). Three-way key diff before wiring.

### R10 — Stale-state refusal (FR-021)

- The allocation runs **inside** the `db.transaction`, on a fresh queue read (moving F7's validation in).
- The client sends `expected_owed = {USD, LBP}`: the signed in-scope total it previewed.
- If the fresh total differs by more than the epsilon ($0.005 / 0.5 LBP), the settlement is refused: "OMT's balance changed since you opened this sheet. Check the new amounts." The sheet refetches on that error.

### R11 — Account members only see Settle Account

- **Gate**: `isAccountMember = selectedSupplier.account_supplier_id != null || isSelectedAccountParent` (Suppliers/index.tsx 938-965).
- **Hidden for members**: the Pay / Receive tab and the Commission settlement block. The default tab becomes the Transactions history. The OmtStatementCheckPanel and the ledger stay.
- **Transactions labels** (FR-017): for account members, `getAllByProvider` takes status and paid amounts from coverage (`fifo_paid_usd` plus a new `fifo_paid_lbp`). Non-members keep the pool estimate. "Outstanding" shows both currencies.

### R12 — Rounding and order of operations

- **Tolerances**: USD $0.005 and LBP 0.5 (existing `EPS_USD`/`EPS_LBP`). A row whose remaining amount is within the tolerance closes. Coverage amounts are rounded to cents / whole LBP before they are stored.
- **Statement panel**: `getAccountExpectedStatement` uses each row's **remaining** gross. A part-paid row still lists its full expected commission (it is recognised when the row closes).

## Not changed

- Suppliers outside an account: batch settle and Pay / Receive are unchanged (spec assumption).
- Partner and Whish flows: unchanged.
- Waive UI on the account sheet: stays off, as today (`waiveDisabled`). Server support follows R3 (FR-011, server only) so a later UI can switch it on.
- Legacy whole-row path: kept, but refuses any selected row with active coverage, so an outdated client can never pay a part-paid transfer twice.

## §13 map (T001, 2026-10-15)

| §13 item | This feature |
| --- | --- |
| 1 Schema/plumbing | v217 table in migrations + `create_db.sql`; schema extended in core; preload type derived; `electron.d.ts` bridge type derived; core build & sync before desktop runs |
| 2 Transactions row | existing `SUPPLIER_SETTLEMENT`, `source_table='supplier_ledger'`/`source_id`=anchor; `profit_*` = entered commission (closed rows) + cash-out commission (closed credits); `exchange_rate` stamped |
| 3 IN/OUT badge | two badges when the legs run both ways (T036/T040) |
| 4 Payment legs | one payload; per-currency IN legs; change (OUT) legs cash-only, any currency; one leg loop (existing) |
| 5 Drawers | `resolveServiceCashDrawer(method, {provider: parent.provider})` per leg, per currency (unchanged) |
| 6/7 Client / CUSTOMER_ACCOUNT | not applicable (no client) |
| 8 Supplier ledger | per member per currency rows (−money PAY / +money COLLECT); netting pair; commission credit stamped; gross owed model unchanged |
| 9 Void | newest-first guard + coverage soft-void + existing reversal; nets to 0 per currency |
| 10 Profits | commission recognised only on closed rows (FR-012) |
| 11 Sessions | not applicable (supplier settlement is never in a basket) |
| 12 Audit viewer | label unchanged; badge per T040 |
| 13 E2E | lira-web-065; identity + delta assertions |
| 14 One obligation | ledger owns "owed to OMT"; coverage only records how it was paid — never a second balance |
| 15 Legs vs amount | the allocator is the ONE rule deciding what counts; `_resolveSettlementLegs` validates legs only; whole write in one `db.transaction` with `.changes` guards |
| Offline (LIRA-306) | `suppliers:settle-account` stays `online_only`; new writer methods go into `offline/testHelpers/onlineOnlyExempt.ts` if the `requestNow.guard` ratchet flags them |

## Rule-23 diff (T003, 2026-10-15)

| Key | (a) schema | (b) preload type | (c) handler/route forwards |
| --- | --- | --- | --- |
| account_supplier_id, direction, selections, amount_usd/lbp, commission_usd/lbp | ✓ | ✓ | ✓ (spread `...v.data` / `...req.body`) |
| entry_mode, commission_rate, commission_unit_count, note, exchange_rate, payments(+direction) | ✓ | ✓ | ✓ |
| surplus_usd/lbp, covered_omt_service_types, discount | ✓ | ✓ | ✓ |
| per_currency, expected_owed (new) | add (T013) | add via derived type (T014) | forwarded by the spread — no change |

No key in (b) or (c) is missing from (a). Finding: both the IPC handler (`supplierHandlers.ts` audit summary) and the REST route read `direction` and `selections.length` for the audit text; with the amount-first payload both are absent, so the audit summary must be rewritten for that payload (T019).
