---
description: "Task list for LIRA-388 — refund any transaction"
---

# Tasks: Refund any transaction

**Input**: `specs/388-refund-any-transaction/` (plan.md, spec.md, research.md, data-model.md, contracts/refund-any.md, quickstart.md)

**Tests**: requested by the spec (SC-001…SC-004) and required by rule 17 — every guard is written first, run on the unfixed code, and its red line is recorded under "Red → green log" at the bottom before the fix lands.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [x] T001 Read the code points named in research.md R4 and note file:line in the Build notes section below (no code change)

## Phase 2: Foundational (blocks every story)

- [x] T002 Write failing guard `packages/core/src/constants/__tests__/refundKinds.test.ts`: `NON_REFUNDABLE_TRANSACTION_TYPES` equals exactly the 13 structural types of User Story 5 plus MTC_TOPUP and ALFA_TOPUP; every other `TRANSACTION_TYPES` value has a plan with kind ≠ "none" (CARRIER_LINE_ADJUSTMENT only with `credits_before`/`credits_after` in metadata); every owned type is in `NON_REVERSIBLE_TRANSACTION_TYPES` (the raw-void gate stays); reversal rows (`reverses_id` set) plan "none"; directions per research R4
- [x] T003 Create leaf `packages/core/src/constants/refundKinds.ts` (`REFUND_OWNERS`, `NON_REFUNDABLE_TRANSACTION_TYPES`, `refundPlanOf(row)`, types `RefundPlan`/`RefundKind`/`RefundOwner`/`RefundDirection`); export from `packages/core/src/browser.ts` and `packages/core/src/index.ts`; no Node import (rule 29)
- [x] T004 Add `allowOwnedRefund` to `_assertReversible` / `_refundTransactionInternal` in `packages/core/src/repositories/TransactionRepository.ts`: stamps `metadata_json.refundType` ("standalone" for a window plan, "bookkeeping" for a confirm plan) on the REFUND row of an owned type; bypasses `NON_REVERSIBLE_TRANSACTION_TYPES` only when `REFUND_OWNERS[type].owner === "generic"` and the row is not session-linked; `transactions:void` unchanged
- [x] T005 Dispatch in `TransactionService.refundTransaction` (`packages/core/src/services/TransactionService.ts`) by `refundPlanOf`: generic → repository with `allowOwnedRefund`; holdPickup / voucher / warranty → their services; none → `{success:false, error: reason}`; a "confirm" plan refuses `refundLegs`
- [x] T006 Widen `reversed_by_id` in `getRecent` (`TransactionRepository.ts`) through one named SQL fragment (research R5): HOLD_MONEY_COLLECT_VOID / WARRANTY_COST / COUNTERPARTY_DISCOUNT reversal rows and a voucher's VOUCHER_CANCEL make the original read as reversed (FR-005 for page-owned owners)

## Phase 3: User Story 1 — standalone loto prize (P1) 🎯 MVP

**Independent test**: pay a standalone prize, refund it from the row; drawer net 0, prize voided and out of the checkpoint total, REFUND row linked; settled day refused.

- [x] T007 [US1] Write failing tests in `packages/core/src/repositories/__tests__/lira388.refundAnyTransaction.test.ts`: standalone prize create → `refundTransaction` → drawer delta 0 per currency, `loto_cash_prizes.voided = 1`, CASH_PRIZE ledger row soft-voided, REFUND row `reverses_id` = prize txn; prize whose CASH_PRIZE ledger row carries a day-settlement `settlement_id` → refused "already included in settlement", nothing written; raw `voidTransaction` still refused
- [x] T008 [US1] Implement the standalone settled-day refusal in `_assertLotoCashPrizeVoidable` (`TransactionRepository.ts`), standalone path only (basket path keeps LIRA-351 relief)

## Phase 4: User Story 2 — one Refund button, Void gone (P1)

**Independent test**: Transactions page shows no "Void" on any standalone row; Refund on each refundable type opens the window (original method preselected) or the confirm; untouched confirm books the same money as Void.

- [x] T009 [US2] Write failing core comparison test (same file as T007): for SALE, FINANCIAL_SERVICE, RECHARGE_TOPUP — void on copy A, untouched refund on copy B → identical `payments` legs per drawer/currency and identical ledger deltas
- [x] T010 [P] [US2] Write failing page test `frontend/src/features/audit/components/__tests__/ActionsCell.refundAny.test.tsx`: no button named "Void" on any standalone row of any type; exactly one "Refund" on every refundable type; "Can't refund here" only on non-refundable types; basket/split actions unchanged
- [x] T011 [P] [US2] Rewrite `frontend/src/features/audit/__tests__/nonReversibleReasons.guard.test.ts` + `actionGating.test.ts` partition guards to read core's `NON_REFUNDABLE_TRANSACTION_TYPES` / `refundPlanOf`; add "every reason names an action that exists" (no reason mentions an action we removed or that never existed — e.g. "from the Loto page", "Void")
- [x] T012 [US2] Derive `ACTIONABLE_TYPES` from core in `frontend/src/features/audit/auditConstants.ts`; `isReversibleRow` uses `refundPlanOf` in `frontend/src/features/audit/actionGating.ts`
- [x] T013 [US2] `frontend/src/features/audit/components/TransactionCells.tsx`: drop the per-row Void button; single Refund
- [x] T014 [US2] `frontend/src/features/audit/pages/TransactionsViewer.tsx`: Refund → plan.kind "window" opens `RefundMethodModal` with `direction` from the plan (from_customer offers drawer methods; never Customer Account on account cash rows); "confirm" → confirm dialog naming the opposite entry → `refundTransaction(id)`
- [x] T015 [US2] Rewrite `frontend/src/features/audit/nonReversibleReasons.ts` + `packages/ui/src/i18n/locales/{en,ar}/audit.json` `nonReversible.*` to the non-refundable types only, each pointing at an action that exists; add confirm strings
- [x] T016 [US2] Open roles: `electron-app/handlers/transactionHandlers.ts` `transactions:refund` and `backend/src/api/transactions.ts` `POST /:id/refund` → `requireRole(["admin","staff"])`; failing-first backend route test that a staff JWT is accepted (`backend/src/api/__tests__/…`)

## Phase 5: User Story 3 — customer-money rows (P2)

**Independent test**: each type refunded from its row nets every ledger to 0; dependency refusals write nothing.

- [x] T017 [US3] Failing tests (lira388 file): CREDIT_CASH_IN (drawer + client balance back; refused when credit since spent, message names what is left), CREDIT_CASH_OUT (drawer + credit restored, excess Manual Debt reversed), DEBT_CASH_OUT, ACCOUNT_ADJUSTMENT (credit and debt); each also asserts profit nets to 0 through the stored stamps (SC-005)
- [x] T018 [US3] Implement `_reverseAccountEntryLedger` + spent-credit refusal in `TransactionRepository.ts` (DebtRepository.getClientBalance read)
- [x] T019 [US3] Failing tests: HOLD_MONEY_COLLECT refund = `voidPickup` (pickup voided, hold back to held, row reads reversed); HOLD_MONEY drop-off refund (drawer 0, hold leaves active list, collect refused); drop-off with a live pickup refused
- [x] T020 [US3] Migration v232 `hold_money.voided_at DATETIME`, `hold_money.voided_by INTEGER REFERENCES users(id)` in `packages/core/src/db/migrations/index.ts` (with `down()`) and `electron-app/create_db.sql`; `HoldMoneyRepository.voidHold`, active list / collect exclude voided
- [x] T021 [US3] Failing tests: VOUCHER_SALE refund = `cancelVoucher` (cash back per leg, voucher cancelled, row reversed); redeemed voucher refused with the Vouchers page message; WARRANTY_COST refund = `voidClaim` (claim VOIDED, cost rows net 0)
- [x] T022 [US3] Wire holdPickup / voucher / warranty dispatch in `TransactionService.ts` (T005)

## Phase 6: User Story 4 — bookkeeping rows (P2)

- [x] T023 [US4] Failing tests: DRAWER_TOPUP (drawer + lot voided; sold lot refused; legacy one-leg from-drawer refused), DRAWER_CASHOUT, LOTO_MONTHLY_FEE (is_paid back to 0), SUPPLIER_ADJUSTMENT (balance back; whole-row settled refused), PARTNER_ADJUSTMENT credit + debit (ledger balance and netting balance net 0), COUNTERPARTY_DISCOUNT standalone client / supplier / partner (ledger + profit net 0; bundled refused), CARRIER_LINE_ADJUSTMENT with stored values (line + drawer back; edited since refused) and without (refused); profit nets to 0 for the discount rows through the counterparty-discount total (SC-005)
- [x] T024 [US4] Owner steps in `TransactionRepository.ts`: lot guard/void widened to `drawer_topups`; legacy top-up refusal; `LotoMonthlyFeeRepository.markFeeUnpaid`; supplier whole-row settled refusal; partner step widened + `partnerNettingBalanceSql` fix (`packages/core/src/constants/partnerObligation.ts`); standalone discount owners extracted from the bundled helpers; carrier-line restore (`CarrierLineRepository.ts` stores `credits_before`/`credits_after`, `restoreCreditsForRefund`)

## Phase 7: User Story 5 — honest "Can't refund here" (P3)

- [x] T025 [US5] Covered by T002 + T011 (structural types refused in core; reasons true and pointing at existing actions)

## Phase 8: Polish

- [x] T026 Web e2e `frontend/tests/e2e-web/lira-web-099-refund-any-transaction.spec.ts`: standalone loto prize refunded from the row (the drawer named on the prize's own payment row net 0, checkpoint/day prize total unchanged from before), Alfa top-up (RECHARGE_TOPUP) refunded with one confirm, a sale refunded via the single Refund same-method (drawer back as Void did); saves `frontend/public/whats-new/1.35.0/refund-any-row.png` (refund window on the loto prize row)
- [x] T027 Re-point existing tests/e2e that click the per-row "Void" on the Transactions page (`lira-web-037`, `lira-web-096`, frontend `ActionsCell.test.tsx` and any other test found by grepping for the per-row Void)
- [x] T028 Rebuild + sync core; `yarn typecheck`, `yarn lint`, `yarn check:i18n`, `yarn check:transport-parity`; full core suite `--maxWorkers=2`; affected frontend/backend/electron suites; e2e runs per quickstart; restore unrelated whats-new PNGs
- [x] T029 Draft release-note lines, What's new card and FEATURE_GUIDE §9 paragraphs (report only — files owned by the main session)

## Dependencies

Phase 2 → all stories. US1 and US2 first (MVP), US3 and US4 independent of each other after Phase 2, US5 falls out of Phase 2 + T011. Polish last.

## Parallel opportunities

T010/T011 (frontend tests) alongside T007/T009 (core tests); T017, T019, T021, T023 test writing in parallel once Phase 2 exists.

## Implementation strategy

MVP = Phase 2 + US1 + US2 (loto prize refundable, single Refund). Then US3, US4, polish.

## Build notes

- One entry point = the existing `transactions:refund` (IPC + REST + offline binding); dispatcher `TransactionService._refundByOwner`.
- Generic owner steps: `TransactionRepository._assertOwnedRefundable` (refusals, before any write) and `_reverseOwnedRefundEffects` (inside the refund's db transaction, after the generic steps), both type-switched; lot guard/void widened through `_lotSourceOf`; `_reversePartnerSettlementLedger(..., owned)`; `_reverseDebtDiscountTxn` extracted from `_reverseDebtBundledDiscount` (one reversal for bundled and standalone client discounts).
- `_negateCounterpartyDiscountProfit` now picks the discount's OWN row (type + `reverses_id IS NULL`): `getBySourceId` returned the REFUND row written a moment earlier on the same source.
- `reversedByIdSql` (one fragment) replaces the inline `reversed_by_id` subquery. A first version JOINed `warranty_claims`, which broke every hand-rolled test schema without that table; replaced by the type list (a WARRANTY_COST reversal row is written only by `voidClaim`).
- create_db.sql: the v232 comment sits OUTSIDE the `CREATE TABLE hold_money` text — SQLite's DROP COLUMN re-parses the stored table SQL and failed with "incomplete input" when the comment was inside.
- Hold Money page: a refunded drop-off keeps `status = 'held'` (CHECK), so `getAll({status:'held'})` now also requires `voided_at IS NULL`, and the page shows a "Refunded" tag with no Collect button on it in the "All" view (`HoldMoneySection.tsx`).
- `reversedByIdSql` uses `+r.tenant_id` (EXPLAIN QUERY PLAN on create_db.sql: `idx_transactions_reverses` and `idx_transactions_source`).
- Desktop e2e re-pointed (edited, NOT run — no Electron on this Mac): lira-145, lira-142, lira-092, lira-133 (per-row Void → Refund + Confirm Refund / confirm, VOIDED → REFUND row). lira-124 and lira-143 only assert Void is absent (still true).
- e2e step 2: the spec's "Alfa manual top-up" cannot be a drawer top-up any more (`/api/recharge/top-up-app` refuses Alfa: "Alfa credits are added on the phone line itself"); the e2e uses a line credits edit (CARRIER_LINE_ADJUSTMENT with recorded values), which is the bookkeeping one-confirm path.

## Red → green log

| Test                                                                                                                                                                     | Red (on code without the change)                                                                                                                                                                  | Green |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `refundKinds.test.ts` (T002, 10 tests)                                                                                                                                   | `Cannot find module '../refundKinds'`                                                                                                                                                             | 10/10 |
| lira388 US1 "standalone prize refund"                                                                                                                                    | `LOTO_CASH_PRIZE transactions cannot be voided or refunded — reverse them from their own module`                                                                                                  | ✓     |
| lira388 US1 "settled day refused"                                                                                                                                        | expected /already included in settlement/, received the same gate message                                                                                                                         | ✓     |
| lira388 US2 void-vs-refund comparison (SALE / CUSTOM_SERVICE / RECHARGE)                                                                                                 | characterization, green on the unchanged generic path by design (pins the money equality the single Refund relies on)                                                                             | ✓     |
| lira388 CREDIT_CASH_IN spent credit                                                                                                                                      | `Expected: false, Received: true` (refund went through)                                                                                                                                           | ✓     |
| lira388 CREDIT_CASH_OUT beyond credit / DEBT_CASH_OUT / ACCOUNT_ADJUSTMENT debt                                                                                          | debt ledger off by the cash-out (`- Expected -1 + Received +3`): drawer back, client debt/credit not                                                                                              | ✓     |
| lira388 HOLD_MONEY drop-off / live pickup refused                                                                                                                        | `Expected: false, Received: true` (collect still allowed; refund not refused)                                                                                                                     | ✓     |
| lira388 HOLD_MONEY_COLLECT / VOUCHER_SALE reversed on the page                                                                                                           | `reversed_by_id` `Received: null`                                                                                                                                                                 | ✓     |
| lira388 DRAWER_TOPUP one-leg legacy refused                                                                                                                              | `Expected: false, Received: true`                                                                                                                                                                 | ✓     |
| lira388 LOTO_MONTHLY_FEE unpaid                                                                                                                                          | `{is_paid: 1, paid_date: …}`                                                                                                                                                                      | ✓     |
| lira388 SUPPLIER_ADJUSTMENT whole-row settled                                                                                                                            | `Expected: false, Received: true`                                                                                                                                                                 | ✓     |
| lira388 COUNTERPARTY_DISCOUNT client write-off                                                                                                                           | debt off by the discount, then discount profit `usd: -10` (found the REFUND row, see Build notes)                                                                                                 | ✓     |
| lira388 COUNTERPARTY_DISCOUNT bundled refused                                                                                                                            | `Expected: false, Received: true`                                                                                                                                                                 | ✓     |
| lira388 CARRIER_LINE_ADJUSTMENT with values                                                                                                                              | metadata lacked `credits_before/after`                                                                                                                                                            | ✓     |
| lira388 PARTNER_ADJUSTMENT CREDIT/DEBIT                                                                                                                                  | not red on the product: the first fixture omitted `transactionType` (NOT NULL) — fixed in the test; written after `_reversePartnerSettlementLedger(owned)` — **not proven failing-first**         | ✓     |
| lira388 CREDIT_CASH_IN refund, ACCOUNT_ADJUSTMENT credit, WARRANTY_COST, DRAWER_TOPUP external, DRAWER_CASHOUT, redeemed voucher, Customer Account refused, US5 refusals | passed on their first run — written after the dispatcher (T004/T005) landed; **not proven failing-first**                                                                                         | ✓     |
| lira388 partner write-off                                                                                                                                                | written after its owner — **not proven failing-first**                                                                                                                                            | ✓     |
| `v232.holdMoneyVoided.test.ts`                                                                                                                                           | written after the migration — **not proven failing-first**                                                                                                                                        | 3/3   |
| frontend `ActionsCell.test.tsx` (3 old cases run against the new cell)                                                                                                   | "names the Hold Money page for a HOLD_MONEY_COLLECT row", "still shows real Void/Refund buttons for SALE", "non-session row still gets plain Void/Refund" — failed; rewritten as guards (rule 24) | 36/36 |
| frontend `actionGating.test.ts` old "a LOTO_CASH_PRIZE is NOT reversible"                                                                                                | failed against the new gate; premise reversed (rule 24)                                                                                                                                           | 15/15 |
| frontend `voucherPresentation.test.ts` "VOUCHER_SALE has a reason…"                                                                                                      | `received value must be a string` (no reason any more); rewritten                                                                                                                                 | 5/5   |
| frontend `ActionsCell.refundAny.test.tsx` (61), `nonReversibleReasons.guard.test.ts` (9)                                                                                 | written with/after the change — **not proven failing-first**                                                                                                                                      | ✓     |
| backend `transactions.refundAnyRole.api.test.ts`                                                                                                                         | written after the role change — **not proven failing-first**                                                                                                                                      | 4/4   |
| web e2e `lira-web-099`                                                                                                                                                   | first run red at step 2 on a test-design error (Alfa drawer top-up refused); steps 1 and 3 were written after the implementation — **not proven failing-first**                                   | 1/1   |
