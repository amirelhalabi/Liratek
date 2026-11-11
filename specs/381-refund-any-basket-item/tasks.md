---
description: "Task list for LIRA-381 — refund any item of a customer-session basket"
---

# Tasks: Refund any item of a customer-session basket

**Input**: Design documents from `specs/381-refund-any-basket-item/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/session-item-refund.md, quickstart.md

**Tests**: Requested (rule 17 failing-first table-driven core guard, frontend tests, web e2e 096).

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [x] T001 Read `docs/FEATURE_GUIDE.md` §11/§13 and `docs/plans/done_plans/SESSION_ITEM_REFUND_PLAN.md`; record the §13 walk in `specs/381-refund-any-basket-item/research.md` (done in plan)

---

## Phase 2: Foundational (blocking)

- [x] T002 Write the table-driven guard `packages/core/src/repositories/__tests__/lira381.refundAnyBasketItem.test.ts` on the real schema (`testHelpers/debtItemDb`, real `SessionCheckoutService.checkout`), one row per member type: sale line, custom service, recharge, loto ticket, loto prize, OMT send, OMT/Binance receive payout, maintenance, negative custom-service payout, story 1's exact basket (ticket must come back as 300,000 LBP), plus exchange/page-linked rows where the fixture allows. Each row: refund the member, assert its ledgers + `metadata_json.direction`, then `refundSessionBasket` the rest and assert every ledger nets to 0 per currency vs pre-checkout
- [x] T003 Run T002 on the unfixed code (`npx jest <file> --maxWorkers=2`) and record the exact refusal line per row in this file under "Failing-first evidence"
- [x] T004 Add `isSessionItemRefundableMember` + `sessionItemRefundDirection` to `packages/core/src/constants/sessionPayoutMember.ts` (leaf; exported via `browser.ts` already); remove `SESSION_ITEM_REFUNDABLE_TYPES` from `packages/core/src/constants/transactionTypes.ts`; add `SESSION_REFUND_DEBT_TYPE = "Session Refund Debt"` to `MODULE_DEBT_TRANSACTION_TYPES`

**Checkpoint**: guard red for the right reasons; shared rule exists.

---

## Phase 3: User Story 1 — Refund one loto ticket from a basket (P1) 🎯 MVP

**Goal**: any to_customer member (ticket, send, maintenance, custom service, recharge, sale) refunds on its own, in its own currency in a netted-payout basket.

**Independent test**: T002 rows "loto ticket" and "story 1 basket".

- [x] T005 [US1] In `packages/core/src/repositories/TransactionRepository.ts` `_planSessionItemRefund`: replace the whitelist + payout refusals with `isSessionItemRefundableMember`; run the up-front owners' asserts (`_assertSupplierSiblingsVoidable`, `_assertSupplierBundledDiscountVoidable`, `_assertExchangeLotsVoidable`, `_assertLotoTicketVoidable`, `_assertLotoCashPrizeVoidable`); non-SALE amount + sign from the cst row; return `direction`, `paidOnItsOwn`
- [x] T006 [US1] Remove `_assertNoNettedPayoutMembers`; in a netted-payout basket hand back the pool part in the item's own currency capped per currency by gross positive member charges minus earlier item refunds (research R3) in `TransactionRepository.ts`
- [x] T007 [US1] Shared per-currency residual (research R4) used by `_reverseSessionPooledPayments` and `isSessionBasketFullyRefundedBatch` in `TransactionRepository.ts`
- [x] T008 [US1] Write path: stamp `direction` in metadata, link row = exact negation of the member's cst amounts; paid-on-its-own / swap members mirror own legs only and refuse `refundLegs` in `TransactionRepository.ts`
- [x] T009 [US1] Preview + result types gain `direction`, `paidOnItsOwn` (`SessionItemRefundPreview`, `RefundSessionBasketItemResult` in `TransactionRepository.ts`)

---

## Phase 4: User Story 2 — Refund a payout member (P2)

**Goal**: prize / cash-out / receive refunds take money FROM the customer by any method incl. customer account.

**Independent test**: T002 rows "loto prize", "OMT receive", "Binance receive", "custom-service payout".

- [x] T010 [US2] from_customer branch in `refundSessionBasketItem` (`TransactionRepository.ts`): no account-first; `measureCustomerLegs`/`writeCustomerLegs` with debt type `'Session Refund Debt'`; default lines = cash in the payout's currencies; refuse kept/added change; stamp `collectedUsd/Lbp`
- [x] T011 [US2] Preview for from_customer returns IN default legs (`direction: "in"`, positive `signed_amount`) and 0 account reduction in `TransactionRepository.ts`
- [x] T012 [P] [US2] `RefundMethodModal` `direction` prop (title/subtitle/"Customer pays" label, no kept/added change) in `frontend/src/features/audit/components/RefundMethodModal.tsx`; en/ar strings in `frontend/src/locales/{en,ar}/audit.json`
- [x] T013 [US2] `useSessionItemRefund` keeps `direction`/`paidOnItsOwn` from the preview; skips the modal for swap / paid-on-its-own members; `TransactionsViewer.tsx` passes methods incl. `CUSTOMER_ACCOUNT` for from_customer
- [x] T014 [P] [US2] Frontend test: hook opens in from_customer direction for a negative member, `frontend/src/features/audit/hooks/__tests__/useSessionItemRefund.direction.test.ts`

---

## Phase 5: User Story 3 — Sold item in a basket that had a payout (P2)

**Goal**: the Refund item button shows on every live member; payout baskets no longer hide it.

**Independent test**: ActionsCell shows Refund item on a loto ticket row and on a sale row with `hideRefundItem` gone.

- [x] T015 [US3] `ActionsCell` uses `isSessionItemRefundableMember(row)`; drop `hideRefundItem` from `frontend/src/features/audit/components/TransactionCells.tsx` and `pages/TransactionsViewer.tsx`; `sessionsWithPayoutMember` removed from `hooks/useTransactionRows.ts` if unused
- [x] T016 [US3] Rule-24 rewrites: `ActionsCell.hideRefundItemForPayoutBasket.test.tsx`, `TransactionsViewer.hideRefundItemForPayoutBasket.test.tsx` → guards that Refund item SHOWS in a payout basket; `ActionsCell.sessionItemRefund.test.tsx` → loto ticket row shows it
- [x] T017 [US3] Rule-24 rewrites in core: `TransactionRepository.refundSessionBasketItem.test.ts` (payout refusal cases → allowed / kept-change still refused), `TransactionRepository.sessionPayoutGuardCstAmount.test.ts`, check `SessionCheckoutService.nettedPayoutSignal.test.ts` premise

---

## Phase 6: User Story 4 — Send, exchange, maintenance (P3)

- [x] T018 [US4] T002 rows for OMT send (supplier sibling reversed), maintenance (parts back), exchange (mirror, lots back, no override) green

---

## Phase 7: Polish

- [x] T019 Rebuild + sync core; run affected core tests by path (`--maxWorkers=2`)
- [x] T020 Web e2e `frontend/tests/e2e-web/lira-web-096-refund-basket-item.spec.ts` (stories 1 + 2, drawer deltas, rows by identity) + screenshot `frontend/public/whats-new/1.35.0/refund-basket-item.png` (1400×900, from_customer window)
- [x] T021 `yarn typecheck`, `yarn lint`, `yarn check:i18n` with elapsed times
- [x] T022 Unattended decisions + morning questions appended to `spec.md`

## Dependencies

T002–T004 → US1 (T005–T009) → US2 (T010–T014) → US3 (T015–T017) → US4 (T018) → Polish. US2/US3 frontend tasks [P] with each other once core types exist.

## Implementation strategy

MVP = US1 (owner's loto ticket case). Each later story is additive on the same planner.

## Notes from the build

- T018: OMT send, maintenance, an exchange linked from its own page AND an exchange as a pooled basket line (LIRA-380, landed during this build) are green in the guard file; `SessionCheckoutService.exchangeLine.test.ts` 7/7 green after the change. Added after review: a Binance cash-out row and a Profits-page (ProfitService.getSummary) margin check for ticket / send / repair / two receives.
- T016: the frontend guards (ActionsCell, TransactionsViewer, hook direction, modal direction) were written/rewritten after the code change — not proven failing-first by a run (rule 17 forbids re-breaking the code to prove them).
- Prettier reformatted the whole of `TransactionRepository.refundSessionBasketItem.test.ts` (it was not prettier-clean before); most of that file's diff is formatting.

## Failing-first evidence

Run 2026-11-11 on the unfixed code: `npx jest src/repositories/__tests__/lira381.refundAnyBasketItem.test.ts --maxWorkers=2` → 14 tests, 14 failed:

| Row                            | Failure on unfixed code                                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| sale line                      | drawer move correct; `refundDirection` missing from the REFUND row                                                     |
| custom service                 | same — `refundDirection` missing                                                                                       |
| recharge                       | same — `refundDirection` missing                                                                                       |
| loto ticket                    | `LOTO cannot be refunded on its own from a session basket — only sold items (products, services, recharges) can be; …` |
| loto cash prize                | `LOTO_CASH_PRIZE cannot be refunded on its own from a session basket — only sold items …`                              |
| story 1 basket (ticket)        | `LOTO cannot be refunded on its own …`                                                                                 |
| story 3 (sale in prize basket) | `This basket includes a payout (LOTO_CASH_PRIZE) that was netted against its items — refund the whole basket instead.` |
| OMT send                       | `FINANCIAL_SERVICE cannot be refunded on its own …`                                                                    |
| OMT SYSTEM receive             | `FINANCIAL_SERVICE cannot be refunded on its own …`                                                                    |
| Whish App cash-out             | `FINANCIAL_SERVICE cannot be refunded on its own …`                                                                    |
| maintenance                    | `MAINTENANCE cannot be refunded on its own …`                                                                          |
| custom-service payout          | `CUSTOM_SERVICE is a payout, not a sold item — it cannot be refunded on its own from a session basket.`                |
| story 2 (prize on account)     | `LOTO_CASH_PRIZE cannot be refunded on its own …`                                                                      |
| kept change refused            | refused, but with the old whitelist text instead of the new "not an item" reason                                       |

Note found while writing the guard: a custom service's own `metadata_json` already carries `direction: "IN"/"OUT"`, which `_createRefundRow` copies onto the REFUND row — so the new stamp is named `refundDirection`, not `direction`.
