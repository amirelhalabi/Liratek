# Research: Checkpoint open differences (LIRA-335)

Three read-only code surveys (2026-10-18) fed these decisions. File:line references are as of that date.

## R1. Where to hook the resolution (no single posting chokepoint)

- **Finding**: drawer legs are posted by `insertPaymentRow` (`moneyPosting.ts:449`) + `applyDrawerDelta` (`:401`) from about 100 call sites in 30 repositories. Neither primitive knows the transaction's other legs or its time. `TransactionRepository.createTransaction` (`:1582–1600`) is the only common point that sees `transaction_time` (`created_at = data.transaction_time ?? requestNow()`), but it posts no legs; each flow posts its legs afterwards with the returned id, inside its own `this.db.transaction(...)`.
- **Decision**: one core function `resolveBackTimedDrawerMovement(db, { transactionId, userId })` in a new module `repositories/checkpointResolution.ts`, called by each flow at the end of its own db transaction, after all legs are written. It reads the transaction's `created_at` (the effective time: custom time or offline event time) and its drawer-affecting legs, and does nothing unless a checkpoint of that drawer exists after that time.
- **Guard (rule 14 / one derivation)**: a source-scan jest guard fails when a repository passes `transaction_time` to `createTransaction` without calling `resolveBackTimedDrawerMovement` in the same file, unless listed in a documented exclusion list.
- **Alternatives rejected**: (a) hooking `insertPaymentRow` per leg — cannot net a sale's IN leg against its change leg, so caps and direction would be wrong; (b) a commit hook — better-sqlite3 has none; (c) hooking `createTransaction` — legs do not exist yet.

## R2. Effective time and offline replay

- **Finding**: `payments.created_at` never carries the custom time (`insertPaymentRow` stamps `createdAt ?? requestNow()`); only `transactions.created_at` does. Offline replay sets `requestNow()` to the event time (`ReplayEngine.ts:258,361`), so replayed transactions and their legs carry the event time.
- **Decision**: effective time = `transactions.created_at` of the saved transaction. This covers both Set custom time and replayed offline transactions with no extra code (spec FR-006). Resolution runs only at save time, so a transaction saved before a checkpoint can never be treated as "after" it.
- **"First checkpoint after T" for drawer D**: key on `daily_closing_amounts.drawer_name` (an all-drawers setup row stores `AGGREGATED` in `daily_closings.drawer_name`), `julianday(dc.created_at) > julianday(T)`, ordered by `julianday(dc.created_at), dc.id`, limit 1.

## R3. Offset legs: new payment method

- **Decision**: new method `CHECKPOINT_RESOLUTION` (constant next to `CHECKPOINT_ADJUSTMENT_METHOD` in `constants/checkpointAdjustment.ts`, re-exported from `browser.ts`). Offset legs sit on the resolving transaction itself (same `transaction_id`), so the generic void mirrors them.
- **Classification**: add to `INTERNAL_LEG_METHODS` (`TransactionRepository.ts:297`) — this one set hides them from customer-facing legs, in/out legs, paid-via-drawer filter, D1 cash-flow (`getCashFlowByDate`) and Profits "By payment" (`ProfitRepository.ts:3336`), and makes `isOverridableLeg` false. NOT audit-only (they move a drawer), so `drawerAffectingPayments`, `getDrawerBalancesAsOf` and `recalculateDrawerBalances` count them automatically. Add to `PROVIDER_BOOKKEEPING_METHODS` in `testHelpers/paymentSnapshotAssert.ts:50`. Label in `frontend/src/features/audit/transactionDisplay.ts:207` ("Checkpoint resolution · <Drawer>").
- **No new transaction type** → none of the type guards fire (postingRules, TRANSACTION_TYPE_LABELS, cashFlow map, presentation map, actionGating).

## R4. Void vs refund

- **Finding**: `_reversePayments` (`TransactionRepository.ts:8820`) mirrors every payments row of the original (no method filter) on both void (`:6099`) and refund (`:6545`); partial item refunds scale every row (`SalesRepository._applySaleItemMoneyBack:3699`, `_itemRefundLegRows:2306`).
- **Decision** (spec FR-009 as corrected): void mirrors offset legs (resolution undone, drawer nets to zero). Refund (full, partial, item) must skip `CHECKPOINT_RESOLUTION` legs: the counted cash was real, the refund is new cash out. `_reversePayments` gets an explicit mode (`"void" | "refund"`); item-refund scaling filters the method out.
- **Resolution activeness** is derived, never stored: a resolution counts while its transaction is not voided — one named SQL fragment `ACTIVE_RESOLUTION_SQL` (rule 14). Implementer verifies the exact voided status value used by `_voidTransactionInternal`.

## R5. Drawer shortage expense

- **Finding**: `ExpenseRepository.createExpense` (`:304`) supports `books_only` (returns before any payments row, `:639`), `source_ref_table/source_ref_id` (derives `is_auto`, `:626`). `changeRoundingExpense.ts` is the pattern. There is no update-amount path ("financial data is immutable"); `voidLinkedExpenses(sourceTable, sourceId, userId)` (`TransactionRepository.ts:8109`) voids every expense linked to a source. Profits subtracts books-only expenses by `expense_date` (`ProfitRepository.getExpenseTotals:5590`). Expenses hold USD and LBP only.
- **Decision**: `bookDrawerShortageExpense` in `repositories/drawerShortageExpense.ts`, category `"Drawer shortage"`, books-only, `source_ref_table = 'checkpoint_differences'`, `source_ref_id = difference id` (unique per drawer and currency, so `voidLinkedExpenses` hits exactly one), `expense_date` = the checkpoint's `closing_date`. Shrinking or growing = void + recreate through one `syncShortageExpense(differenceId)`; called after close, reopen, a new resolution and a void of a resolving transaction.
- **Currencies other than USD/LBP** (EUR, USDT): Close records the closed state with no expense, and the Close window says so. Assumption, logged in the spec Assumptions at implementation.
- **Manual void blocked**: no flag exists today. Guard in `ExpenseRepository.deleteExpense` (`:1007`), `updateMetadata` (`:1028`, category change) and the generic void path for expenses linked to `checkpoint_differences`, unless called internally by `syncShortageExpense`/reopen. HistoryModal hides void/edit on those rows.

## R6. Storage

- **Decision**: migration v222 adds `checkpoint_differences` and `checkpoint_difference_resolutions` (see data-model.md), modelled on v217 `supplier_settlement_coverage`. Add both to `constants/resetTables.ts` (RESET_WIPE_TABLES) and `scripts/check-tenant-scoping.mjs` `TENANT_SCOPED_TABLES`. `create_db.sql` gets both tables and `(222, 'checkpoint_differences')` in the seed list.
- Differences are written by `createCheckpoint` from its own `adjustments` (the posted delta), so checkpoints saved before v222 have none (spec FR-022, owner decision "from now on").

## R7. Session checkout

- **Finding**: session-basket legs sit on `session_id` rows with `transaction_id` NULL (`SessionPaymentService.ts:733–849`), each item copies the checkout time into `transaction_time` (`SessionCheckoutService.ts:228`), and basket reversal lives in `TransactionRepository.ts:3114`.
- **Decision**: implementer evaluates in task T0xx whether offset legs can be attached so the basket reversal mirrors them. If yes, wire it. If not, list session checkout in the guard's exclusion list with the reason, and the release note and spec say so. No silent gap.
- **Outcome (Lane B, T020, 2026-10-18)**: excluded. Each basket item still runs its own module's flow with the checkout time, and that flow calls the engine, so legs on the item's own transaction (provider stock, crypto, cost legs) resolve and reverse like any other transaction (void mirrors, basket refund and item refund skip). The customer's pooled payment legs cannot: they sit on the session (`session_id` set, `transaction_id` NULL), so there is no transaction to carry an offset leg or a resolution row (`transaction_id` is NOT NULL), and the basket reversal mirrors pooled legs the same way on void and refund. `services/SessionPaymentService.ts` is listed in `CHECKPOINT_RESOLUTION_EXCLUSIONS` with this reason. Effect for the owner: a back-timed **session checkout** moves the drawer as today and resolves nothing; the release note and spec must say so (Lane E / orchestrator).

## R8. Transports and offline policy

- Reads: extend `getCheckpointTimeline` (IPC `closing:getCheckpointTimeline` `dbHandlers.ts:355`, REST `GET /api/closing/checkpoint-timeline` `closing.ts:290`) with `differences` per checkpoint and an `open_only` filter; new read `closing:get-open-differences-after`. Both `READ` in `offline/channelPolicy.ts`.
- Writes: `closing:close-difference`, `closing:reopen-difference` — admin, Zod in `validators/closing.ts`, `ONLINE_ONLY` in channelPolicy with a reason comment (rare admin bookkeeping that edits Expenses; no replay binding needed). REST `POST /api/closing/differences/close|reopen`, `requireAuth, adminGate, validateRequest`.
- Layers per endpoint: schema → electron `schemas/index.ts` re-export → IPC handler → REST route → `backendApi.ts` (`ipcOrHttp`) → `ElectronApiAdapter.ts` → `packages/ui/src/api/types.ts` (types derived from schema, rule 21) → `preload.ts` → `electron.d.ts`. Guards: `channelPolicy.complete.test.ts`.

## R9. The hint under Transaction time

- **Finding**: 16 forms use `TransactionTimeOverride`; only POS knows its drawer before save (`saleDrawerDestinations.ts`), and several forms cannot (Exchange, Crypto, Financial provider legs, CardGridPayView, Maintenance).
- **Decision**: the hint is driven by time only. When a custom time is set, the component asks `getOpenDifferencesAfter({ at })` and lists the open differences that money saved at that time could resolve ("General · Mon 18:00 · Over $50.00 open — money into General will resolve it"). No per-form wiring; every form gets it at once. Read through a ref (rule 25); any failure or a missing adapter method hides the line, so existing form tests that mock `useApi` without it keep passing.
- **Rejected**: per-form drawer/amount preview (accurate wording like the mockup's "$50 of this $60 sale") — needs drawer knowledge most forms lack. Logged as a follow-up.

## R10. Expected figure stored at save (spec FR-023)

- `createCheckpoint` stores `daily_closing_amounts.opening_amount` from the client (`ClosingRepository.ts:635–642`) while the delta uses `getDrawerBalancesAsOf` (`:652–671`). Decision: store the server balance used for the delta. The client's figure stays only as a fallback for line-derived carrier rows, which already use the live balance.

## R11. Existing defect noticed, out of scope

- `getCashFlowByDate` and `ProfitRepository.getPaymentMethodRows` (`:7696`) appear to count today's `CHECKPOINT_ADJUSTMENT` legs (no CHECKPOINT type filter). Logged for a follow-up ticket; not changed here.
