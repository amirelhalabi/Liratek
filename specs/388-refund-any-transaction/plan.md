# Implementation Plan: Refund any transaction

**Branch**: `388-refund-any-transaction` (work on `main`, ticket LIRA-388) | **Date**: 2026-11-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/388-refund-any-transaction/spec.md`

## Summary

One action, "Refund", on every transaction row except the structural ones. The existing `transactions:refund` channel (IPC + REST, already offline-replayable) becomes the ONE refund entry point: `TransactionService.refundTransaction` asks core's single classification (`refundPlanOf`, a leaf constant module) which owner reverses the row and dispatches to it:

- **generic** — `TransactionRepository._refundTransactionInternal` (REFUND row, `_reversePayments`, every rule-20 owner). The 13 non-structural types that today sit in `NON_REVERSIBLE_TRANSACTION_TYPES` only because nobody owned them get a type-gated owner step inside that same path (loto prize settled-day check, account-entry ledger reversal, hold drop-off cancel, loto monthly fee unpay, drawer top-up lot, partner/discount ledger, carrier-line restore).
- **page-owned** — the Hold Money page's `voidPickup`, the Vouchers page's `cancelVoucher`, the Warranty page's `voidClaim`, invoked as they are (rule 14), never re-implemented.
- **none** — 13 structural types plus two legacy-only types and carrier-line edits without stored values; the page shows "Can't refund here" with a true reason.

`NON_REVERSIBLE_TRANSACTION_TYPES` is NOT shrunk in place (it has ~20 consumers and is the generic path's safety gate): the raw `transactions:void` keeps refusing every type it refuses today. The refund path bypasses it only for types the classification names an owner for (`allowOwnedRefund`). The Transactions page loses its "Void" button; "Refund" opens the refund window with the original method preselected (an untouched confirm sends no override → exact mirror of every leg), or a one-line confirm for bookkeeping rows.

## Technical Context

**Language/Version**: TypeScript 5 (strict), React 19, Node 20

**Primary Dependencies**: `@liratek/core` (TransactionRepository, TransactionService, HoldMoney/Voucher/Warranty services, DebtRepository, PartnerSettlementRepository, ExchangeLotRepository, CarrierLineRepository, LotoMonthlyFeeRepository), react-i18next, `@liratek/ui` `CounterpartySettleModal` (via `RefundMethodModal`)

**Storage**: SQLite. One migration (v232): `hold_money.voided_at`, `hold_money.voided_by` (the status CHECK allows only 'held'/'collected'; a rebuild for a new status is avoided). Both `migrations/index.ts` and `create_db.sql`.

**Testing**: core jest on the real schema (`--maxWorkers=2`), backend jest (route tests), frontend jest (one path at a time), web e2e `lira-web-099` via `node scripts/run-e2e.mjs web`.

**Target Platform**: Electron desktop + web (same core, IPC + REST)

**Project Type**: monorepo desktop + web app

**Performance Goals**: `getRecent` keeps one correlated subquery for the reversed link (indexed `reverses_id`, plus `idx_transactions_source` for the voucher pair)

**Constraints**: basket (LIRA-381) and split-checkout actions untouched; raw void gate unchanged; no Electron run on this Mac

**Scale/Scope**: ~10 core files, 2 handlers/routes (role only), 4 frontend audit files, i18n en/ar, 1 migration, 1 web e2e + screenshot

## Corrections to the brief/spec found during research (recorded in spec.md → Decisions)

1. **Counts.** The spec's "twelve" structural types are thirteen (REFUND, REFUND_UNDO, VOUCHER_CANCEL, HOLD_MONEY_COLLECT_VOID, KEPT_CHANGE, WAIVED_SHORTFALL, EXTRA_CHARGE, BASKET_DISCOUNT, CHECKPOINT, LOTO_SETTLEMENT, CLIENT_CREATED/UPDATED/DELETED) and its "nineteen" refundable types are eighteen (FR-003 8 + FR-004 10). 13 + 18 = 31. Every test iterates the named lists, never a literal count.
2. **MTC_TOPUP / ALFA_TOPUP** are written by nothing since 2026-08-06 (`topUpFromCustomer` deleted); old rows carry no payment rows, and the carrier drawer is reconciled to Σ line credits (`getCarrierCreditsSum`) — taking credits out of the drawer with no line would create a false checkpoint difference. They stay "Can't refund here" with a true reason. The spec's "Alfa manual top-up" is today a `RECHARGE_TOPUP` (Recharge page "Top up"), already generically refundable; the e2e uses that.
3. **CARRIER_LINE_ADJUSTMENT** rows never stored before/after values. From now on the writer stores `credits_before`/`credits_after`; only such rows (reason `edited` / `quick-update`) are refundable, and only while the line still holds `credits_after`. Every existing row keeps "Can't refund here" (Q3 as recommended).
4. **Same-method confirm.** An untouched refund window sends no override; the server mirrors every customer leg exactly as void does (same drawers, currencies, ledgers). It writes a REFUND row (original keeps ACTIVE, profit negated on the refund's day) instead of flipping the original to VOIDED — the spec's own story 1 asks for a REFUND row. Two documented differences from today's Void, proven by a comparison test: profit is reversed on the refund's day (identical same-day), and a back-timed row's checkpoint-resolution offset is not mirrored (the refund is today's event — existing refund rule, LIRA-335).
5. **Roles.** `transactions:refund` (IPC + REST) opens from admin to admin + staff (FR-007). "Undo refund" stays admin. The Warranty service enforces admin inside `voidClaim` itself — the row's refund calls it unchanged, so a staff user gets the warranty page's own "Only an admin can void a warranty claim." (owner question).
6. **Basket and split-checkout actions** ("Void basket", "Void checkout") are untouched (spec edge case: baskets unchanged). The removed button is the per-row "Void".

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                   | Status                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I. One core, two transports | PASS — no new channel: `transactions:refund` IPC + `POST /api/transactions/:id/refund` already exist and call the same `TransactionService.refundTransaction`; dispatch is inside the service. Offline binding for the channel already exists (`offline/bindings/transactions.ts`). The classification module is a leaf, exported from `browser.ts` (rule 29). Web proven by lira-web-099. |
| II. Layer boundaries        | PASS — every new SQL statement lives in a repository (TransactionRepository owner steps, HoldMoneyRepository, LotoMonthlyFeeRepository, CarrierLineRepository, DrawerTopUpRepository); TransactionService only dispatches.                                                                                                                                                                 |
| III. Contracts defined once | PASS — no schema key added (rule 23: schema / preload / handler key sets unchanged). The refund classification is one core function read by the page (rule 14); the frontend `ACTIONABLE_TYPES` becomes derived from it. Opposite-entry text derives from the row's stored figures.                                                                                                        |
| IV. Money integrity         | PASS with design — each of the 16 refundable types (18 minus the two legacy) gets a named reversal owner (rule 20) and a create → refund → net-0-per-ledger-per-currency test, failing first (rule 17). `is_auto` untouched (rule 26). FEATURE_GUIDE §13 walked in research.md.                                                                                                            |
| V. Data and security        | PASS — `?` placeholders, `tenant_id` on every statement, migration in both files with `down()`. Role widening is an owner decision (FR-007).                                                                                                                                                                                                                                               |
| VI. Testing                 | PASS — guard tests written first and run on unfixed code, red lines recorded in tasks.md; e2e by identity + deltas.                                                                                                                                                                                                                                                                        |
| VII. Code quality           | PASS — no `any`, module loggers.                                                                                                                                                                                                                                                                                                                                                           |

Post-design re-check: PASS (no new violations; the role change is owner-approved in the spec).

## Project Structure

### Documentation (this feature)

```text
specs/388-refund-any-transaction/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/refund-any.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/core/src/
├── constants/refundKinds.ts                  # NEW leaf: REFUND_OWNERS, NON_REFUNDABLE_TRANSACTION_TYPES, refundPlanOf(row)
├── constants/transactionTypes.ts             # comments only (gate unchanged)
├── constants/partnerObligation.ts            # netting: reversal of a paper CREDIT counts 0 like its original
├── browser.ts / index.ts                     # export the leaf
├── services/TransactionService.ts            # refundTransaction dispatches by owner
├── repositories/TransactionRepository.ts     # allowOwnedRefund bypass + type-gated owner steps; reversed_by_id fragment
├── repositories/HoldMoneyRepository.ts       # voidHold (drop-off), voided holds leave the active list, collect refuses them
├── repositories/LotoMonthlyFeeRepository.ts  # markFeeUnpaid
├── repositories/CarrierLineRepository.ts     # stores credits_before/after; restoreCreditsForRefund
├── repositories/DebtRepository.ts            # (read) getClientBalance for the spent-credit refusal
├── db/migrations/index.ts                    # v232 hold_money.voided_at/voided_by
└── repositories/__tests__/lira388.refundAnyTransaction.test.ts   # table-driven guard (new)

electron-app/handlers/transactionHandlers.ts   # transactions:refund role admin → admin+staff
electron-app/create_db.sql                     # v232 columns
backend/src/api/transactions.ts                # POST /:id/refund role admin → admin+staff
backend/src/__tests__/…                        # route test

frontend/src/features/audit/
├── auditConstants.ts                          # ACTIONABLE_TYPES derived from core
├── nonReversibleReasons.ts                    # reasons only for non-refundable rows, all true
├── actionGating.ts                            # refundPlanForRow
├── components/TransactionCells.tsx            # single Refund, no Void
├── pages/TransactionsViewer.tsx               # Refund routes window / confirm; direction from core
└── __tests__/…                                # page test
packages/ui/src/i18n/locales/{en,ar}/audit.json
frontend/tests/e2e-web/lira-web-099-refund-any-transaction.spec.ts
frontend/public/whats-new/1.35.0/refund-any-row.png
```

**Structure Decision**: existing monorepo layout; one new leaf constant module in core.

## Complexity Tracking

| Violation                    | Why Needed                                                                                                         | Simpler Alternative Rejected Because                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Migration v232 (two columns) | a cancelled drop-off must leave the active list and refuse a pickup; `status` CHECK allows only 'held'/'collected' | a CHECK rebuild of `hold_money` is a table copy for one state; mislabelling the hold 'collected' would lie on the Hold Money page |
