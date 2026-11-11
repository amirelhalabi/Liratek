---
description: "Task list for LIRA-380 — exchange as a customer-session basket item"
---

# Tasks: Exchange as a customer-session basket item

**Input**: Design documents from `specs/380-exchange-basket-item/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/basket-line.md, quickstart.md

**Tests**: required (CLAUDE.md rule 17 — every guard test is written first and seen failing on the unfixed code; the failure line is recorded next to the task).

## Implementation record (2026-11-11 night)

- T002 failing first: 3 of 6 failed against the one-sided stub (`sessionExchangeLineSides` "Expected - 4 / Received + 1": no payout side). Green after T003.
- T004 failing first: 4 of 5 failed — `Failed to process cart item "Exchange ex" (exchange): Unknown IPC channel for session checkout: exchange:add-transaction`. The refusal test passed on the unfixed code for that same reason; it now asserts the deferred-mode message. Green (5/5) after T005–T006, with NO change to `TransactionRepository.ts` (SC-003 nets to 0).
- T008 failing first: 3/3 failed — `Unable to find role="button" and name /Add to basket/i`. Green after T009–T010.
- T013 failing first: 2/3 failed — `payoutLbp` Expected 8950000, Received 0. Green after T014.
- T015: written after the modal change — NOT proven failing-first (rule 17); its rule is proven one level down by T013.
- T012: rewrote Exchange.overrideSign / Exchange.lotLossConfirm / Exchange.addedChange session tests into "old path NOT taken" guards; desktop lira-094 rewritten (edited, not run — no Electron on this Mac).
- T018: lira-web-097 passed (1 test); screenshot saved 1400×900.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [x] T001 Read `docs/FEATURE_GUIDE.md` §10, §11 and the §13 checklist; confirm no migration is needed (data-model.md: "No migration")

## Phase 2: Foundational (the one shared rule)

- [x] T002 [P] Write failing test `packages/core/src/utils/__tests__/sessionExchangeLine.test.ts` (USD→LBP, LBP→USD, USD→EUR, EUR→LBP, malformed) against a one-sided stub
- [x] T003 Implement `packages/core/src/utils/sessionExchangeLine.ts` (`EXCHANGE_CART_CHANNEL`, `isExchangeBasketLine`, `sessionExchangeLineSides`, `sessionExchangeLineLink`, `sessionExchangeCartAmount`; imports nothing — rule 29) and export it from `packages/core/src/browser.ts` and `packages/core/src/index.ts`

**Checkpoint**: T002 green.

## Phase 3: User Story 1 — Exchange waits in the basket (P1) MVP

**Goal**: Confirm in a session adds a line; checkout books the exchange once with the basket's payment.

**Independent Test**: core checkout test story 1 + web e2e 096.

- [x] T004 [US1] Write failing test `packages/core/src/services/__tests__/SessionCheckoutService.exchangeLine.test.ts` (story 1, story 2 LBP→USD + USD→EUR, refused hand-built line, SC-003 whole-basket refund)
- [x] T005 [US1] Deferred mode in `packages/core/src/repositories/ExchangeRepository.ts` `createTransaction`: `deferPayment`/`paid_in_session` on `CreateExchangeData` only; refuse walk-in-only fields before any write; skip USD/LBP side legs; exotic side keeps its CASH lump; `buildPaymentSnapshot({ sessionId })`; `details.paid_in_session`
- [x] T006 [US1] `case "exchange:add-transaction"` in `packages/core/src/services/SessionCheckoutService.ts` `processCartItem`: re-validate `formData` through `exchangeSubmitSchema`, inject `deferPayment`/`paid_in_session`/time, NO checkout rate; return `bookedProfitUsd`; link with `sessionExchangeLineLink` (two-sided) and the booked profit; totals two-sided
- [x] T007 [US1] Rebuild core and sync `node_modules/@liratek/core/dist`; T004 green
- [x] T008 [P] [US1] Write failing test `frontend/src/features/exchange/pages/Exchange/__tests__/Exchange.sessionBasketLine.test.tsx`: in session mode Confirm calls `addToCart` with the schema-derived payload, never `addExchangeTransaction`/`linkTransaction`; label shows "@ 89,500"; no payment window
- [x] T009 [US1] One payload builder `frontend/src/features/exchange/utils/exchangeBasketLine.ts` (`buildExchangePayload(input, mode)`, `exchangeBasketLabel`) typed `ExchangeSubmitPayload`
- [x] T010 [US1] `frontend/src/features/exchange/pages/Exchange/index.tsx`: session mode → `addToCart` (skip PaymentSheet, keep the loss confirmation); remove the `linkTransaction` path; walk-in uses the same builder
- [x] T011 [P] [US1] Add `"exchange"` to `CartModule` in `frontend/src/features/sessions/types/cart.ts`; module label (en + ar) in `SessionCheckoutModal.tsx`; icon in `SessionFloatingWindow.tsx`
- [x] T012 [US1] Rewrite (rule 24) tests whose premise was "exchange links immediately" (grep `linkTransaction` in frontend tests and `lira-094`) into guards that the old path is not taken

## Phase 4: User Story 2 — Both directions and every currency pair (P1)

**Independent Test**: split test + checkout modal test with exchange lines.

- [x] T013 [P] [US2] Write failing test `frontend/src/features/sessions/utils/__tests__/binanceCart.exchangeLine.test.ts`: `splitBasketCashSides` puts the given side in the charge and the received side in a never-netted payout bucket (USD→LBP, LBP→USD)
- [x] T014 [US2] `frontend/src/features/sessions/utils/binanceCart.ts` reads `sessionExchangeLineSides` (adds `grossPayoutUsd/Lbp`); `SessionCheckoutModal.tsx` posts that bucket as its own `kind:"PAYOUT"`, `payoutOrigin:"GENERAL"` leg, excluded from netting; `SessionContext.tsx` `getCartTotals` reads the rule
- [x] T015 [US2] Write test for the checkout modal buckets with an exchange line in `frontend/src/features/sessions/components/__tests__/SessionCheckoutModal.exchangeLine.test.tsx`

## Phase 5: User Story 3 — Basket payment covers the exchange (P2)

- [x] T016 [US3] Session-mode controls hidden on the Exchange page (covered by T008: no payment window); For partner stays hidden in a session (existing `useForPartnerOffInSession`)
- [x] T017 [US3] Whole-basket refund nets to 0 with an exchange member (T004 SC-003). If it fails, record the needed `TransactionRepository.ts` change under "Left for integration" — do not edit that file (LIRA-381 owns it tonight)

## Phase 6: Polish & cross-cutting

- [x] T018 Web e2e `frontend/tests/e2e-web/lira-web-097-exchange-basket-line.spec.ts` (story 1 end to end; drawer deltas; Transactions shows nothing before checkout and both rows after) + screenshot `frontend/public/whats-new/1.35.0/exchange-basket-line.png` (1400×900)
- [x] T019 `yarn typecheck`, `yarn lint`, `yarn check:i18n` (measure elapsed time)
- [x] T020 Report: release-note bullet, What's new card text, FEATURE_GUIDE §11 sentences to replace (do not edit UNRELEASED.md / FEATURE_GUIDE.md / current_sprint.md)

## Dependencies

- T002 → T003 → (T005, T006 → T007) → T014
- T004 before T005/T006 (failing first); T008 before T009/T010; T013 before T014
- T018 needs T007, T010, T014

## Parallel opportunities

- T008, T011, T013 touch different files and can be written while core is built.

## Implementation strategy

MVP = Phases 2–3 (core replay + page adds a line). Phase 4 makes the checkout modal post the payout correctly (needed for e2e). Phase 5 is verification only.
