# Research: Loto on Settle Account (LIRA-351)

Code map gathered 2026-10-29 (read-only sweep of `LotoTicketRepository`, `LotoCashPrizeRepository`, `LotoCheckpointRepository`, `LotoService`, `SupplierRepository`, `TransactionRepository`, the Suppliers and Loto pages).

## R1 — What the calendar sees for Loto

- **Decision**: Use the existing day calendar unchanged. Loto's ticket rows (`supplier_ledger` `TOP_UP`, `+(sale − commission)`) and prize rows (`CASH_PRIZE`, `−prize`) are link-mode rows (`transaction_id` = the LOTO / LOTO_CASH_PRIZE transaction, no `source_ref`), which `accountRowScopeSql` already classifies as `DAY` rows on their shop day. Prizes net against sales within a day with no new code (owner decision 3).
- **Rationale**: One allocator, one calendar (rule 14); the netting the owner chose is what the allocator already does for OMT receives vs sends.
- **Alternatives**: a Loto-specific day view (rejected: a second calendar).

## R2 — Why history must be closed first

- **Finding**: `LotoCheckpointRepository.settleCheckpoint(s)` writes one raw `SETTLEMENT` ledger row for the checkpoint's net and never stamps `settlement_id` on the `TOP_UP` / `CASH_PRIZE` rows it pays. The open queue lists `settlement_id IS NULL` rows and hides `SETTLEMENT` rows (`isSettlementOwnRow`), so switching Loto on as-is would show every historical sale as open while the real balance is about 0.
- **Decision (owner decision 1)**: a one-time migration stamps `settlement_id` on every non-refunded Loto `TOP_UP` / `CASH_PRIZE` row whose ticket / prize belongs to a checkpoint with `is_settled = 1`, pointing at that checkpoint settlement's own `SETTLEMENT` ledger row when it can be found (via `loto_checkpoints.settlement_id` → `loto_settlements` → its transaction → its ledger row), else at the row itself as a legacy marker. No row is inserted or deleted, so the balance cannot change (SC-001).
- **Also stamped**: the waive `DISCOUNT` rows posted by checkpoint settlements (`_postSettlementWaive`, no `settlementId`), which would otherwise appear as open credits although their settlement already used them.
- **Not stamped**: tickets / prizes in unsettled checkpoints or never checkpointed (they stay open, FR-007); old Pay / Receive `PAYMENT` / `SUPPLIER_PAYS_US` rows (they stay open ACCOUNT rows = Loto credit or debt, FR-008).
- **Check that proves it**: after the migration, the sum of the open queue equals the Loto ledger balance, per currency. Where a past checkpoint was settled with client-supplied totals that differ from its rows (`settleCheckpoints` trusts `totalSales` / `totalCommission`), the difference shows as a small open amount; the quickstart reports it per shop instead of hiding it.
- **Alternatives**: "start from a date" (rejected by owner); an opening adjustment row (changes the ledger; rejected by SC-001).

## R3 — Gates that must change

- `settlesByDay` (`utils/settlesByDay.ts`) returns `false` for `LOTO` → change to `true`.
- `billsStayOnTickList` would then be `true` for Loto (calendar supplier with a provider, not an account member) → must be `false` for Loto: Loto has no bills, its tick list reads `financial_services` and is always empty. This also keeps Loto's rows out of the tick-list exclusion in `_accountRows`.
- `calendarTakesCommission` → `false` for Loto (commission earned at the sale; settlement books none).
- Suppliers page: Pay / Receive is already hidden for `isSettleByDay`; the "Settle" tab is shown for every non-member admin (`showSettleTab`) → hide it when the supplier has no bills (Loto). The Settle Account button follows `settlesByDay`.
- `SupplierService.settleAccount` refusal for non-calendar suppliers (SupplierService.ts ~299) lifts automatically.

## R4 — Drawer on settlement

- **Finding**: checkpoint settlement used `paymentMethodToDrawerName(method)` (CASH → General). Settle Account uses `resolveServiceCashDrawer(method, ctx)`, which only reroutes when the supplier is the shop's primary system (OMT / Whish); Loto is never a primary system, so CASH → General, as today.
- **Decision**: no change; a test pins CASH → General for a Loto settlement.

## R5 — Voids (owner policy, LIRA-343 option 3)

- **Finding**: for calendar suppliers, voiding a transfer that a settlement covered is allowed; the paid part becomes supplier credit (↺). Loto's own guard `_assertLotoTicketVoidable` refuses when the ticket's checkpoint is settled.
- **Decision**: keep the checkpoint guard for history (tickets in a settled checkpoint stay refused, as today); a ticket paid through the calendar follows the house rule — void allowed, its paid share becomes Loto credit. This differs from the first draft of FR-009 (refuse) — flagged to the owner; spec updated to match the house rule.
- **Cash prizes**: still non-reversible on their own; inside a session basket, `_assertLotoCashPrizeVoidable` keeps its checkpoint / reimbursed check; a calendar-covered prize in a basket follows the same credit rule.
- **Settlement void**: generic settlement void (LIRA-343) reopens the covered rows, reverses legs and the waive — no Loto-specific code.

## R6 — Retiring the old paths (owner decisions 2 and 4, FR-013)

- Loto page: `SettlementVerification` (create-and-settle, settle batch) loses its settle actions; checkpoint creation (`CheckpointScheduler`) and totals stay as a report. `SettlementDrawerIntegration.tsx` is dead code (no importer) → delete.
- Server: `loto:settle-checkpoint`, `loto:settle-checkpoints` (IPC) and their REST twins, plus `loto:mark-checkpoint-settled`, refuse with a message pointing to Suppliers → Loto → Settle Account. `SupplierService.recordSupplierCashflow` refuses `LOTO` (old Pay / Receive, and the cash path of Add Credit / Debt); paper Add Credit / Debt stays allowed.
- Offline channel policy: channel classes unchanged; a replayed refused call fails like any refused online call.

## R7 — Migration number

- Last entry in `packages/core/src/db/migrations/index.ts` is v225 → this feature adds v226 (and mirrors any schema-visible change in `electron-app/create_db.sql`; the backfill is data-only, so `create_db.sql` needs no change beyond the version note if any).
