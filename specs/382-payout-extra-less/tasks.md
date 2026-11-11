---
description: "Task list for LIRA-382 — '− Less | + Extra' line on payout screens"
---

# Tasks: "+ Extra / − Less" line on every payout screen

**Input**: Design documents from `specs/382-payout-extra-less/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/payout-line-ui.md

**Tests**: Requested by the spec (SC-001, SC-002) and by rule 17 — guards are written first and seen failing.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [x] T001 Shared test steps for the line (type in a side, read the field, read the payout legs) in frontend/src/shared/testing/payoutExtraLess.ts

## Phase 2: Foundational (guard tests, failing first — rule 17)

- [x] T002 [P] MultiPaymentInput unit guard (shown/hidden, Extra 0.10 → leg 103, Less 5,000 LBP → leg 1,340,000, cap held at 5 with note, switch clears, legs fill the line, extra-only without kept) in frontend/src/shared/components/**tests**/MultiPaymentInput.payoutExtraLess.test.tsx — seen failing: `Unable to find an element by: [data-testid="payout-extra-less"]` (8 failed, 1 passed)
- [x] T003 [P] Table-driven screen guard, OMT/Whish system RECEIVE, real box, payload parsed by createFinancialServiceSchema, in frontend/src/features/services/pages/Services/**tests**/Services.payoutExtraLess.test.tsx — seen failing (2 failed, same message)
- [x] T004 [P] Table-driven screen guard, Exchange payout, real sheet, exchangeSubmitSchema, in frontend/src/features/exchange/pages/Exchange/**tests**/Exchange.payoutExtraLess.test.tsx — seen failing (2 failed)
- [x] T005 [P] Table-driven screen guard, Whish App "From client" top-up, topUpFromClientSchema, in frontend/src/features/recharge/components/**tests**/TopUpModal.payoutExtraLess.test.tsx — seen failing (2 failed)
- [x] T006 [P] Table-driven screen guard, OMT/Whish App RECEIVE, real sheet, createFinancialServiceSchema, in frontend/src/features/recharge/components/**tests**/OmtWhishAppTransferForm.payoutExtraLess.test.tsx — seen failing (2 failed)

## Phase 3: User Story 1 — Pay a round note on purpose (P1) 🎯 MVP

**Goal**: "+ Extra" on every payout screen that wires the LIRA-334 round-up; typing moves the payout line; booking unchanged (`rounding_given_*`).

**Independent test**: T002 extra cases + T003–T006 "+ Extra" rows pass.

- [x] T007 [US1] Add optional switch labels to DiscountLine (`discountSwitchLabel`, `extraSwitchLabel`, `modeGroupLabel`) keeping today's defaults, in packages/ui/src/components/ui/DiscountLine.tsx
- [x] T008 [US1] Payout line state (`payoutLineMode`, `payoutLineText`, `payoutLineBump`, `payoutLineCapped` — "own state, never `discountRaw`/`lineMode`") and gating (`isPayout && onRoundUpChange && !payoutExcessToAccount && !perCurrencyTotals && !discountRow`) in packages/ui/src/components/ui/MultiPaymentInput.tsx
- [x] T009 [US1] Fill target = owed ± bump for the payout's lines (single line set even after a hand edit; split: last line absorbs), never changing `effectiveTotals`, in packages/ui/src/components/ui/MultiPaymentInput.tsx
- [x] T010 [US1] Render the line under the total (testids per contracts/payout-line-ui.md), field shows typed text while focused else the value read back from `payoutRoundUpRounded`/`payoutKeptRounded`; cap held at `SHORTFALL_MAX[currency]` with the "Capped to max" note; "You pay" row, in packages/ui/src/components/ui/MultiPaymentInput.tsx
- [x] T011 [P] [US1] Labels en + ar ("− Less", "+ Extra", "Less", "Extra", "Less or extra", "You pay") in packages/ui/src/i18n/locales/{en,ar}/ui.json and payment.json; run `yarn check:i18n`

## Phase 4: User Story 2 — Pay a little less on purpose (P2)

**Goal**: "− Less" side, shown only when `onKeptChange` is wired; books `kept_change_*` as today.

**Independent test**: T002 less cases + T003–T006 "− Less" rows pass.

- [x] T012 [US2] "− Less" side + switch (switching clears the other side and returns the line to owed) in packages/ui/src/components/ui/MultiPaymentInput.tsx

## Phase 5: User Story 3 — Void and refund net to zero (P2)

**Goal**: unchanged LIRA-334 / kept-change reversal paths. No code; covered by existing core tests (roundingGiven / kept change void). Verified by not changing core (SC-003).

- [x] T013 [US3] Confirm `git diff --stat packages/core` is empty after the change — LIRA-382 touches no core file; the core diffs present on 2026-11-11 belong to LIRA-380/381 working in parallel

## Phase 6: Polish & cross-cutting

- [x] T014 Run the new guards + the existing payout regressions (MultiPaymentInput.payoutRoundUp, MultiPaymentInput.addedChange, Services.roundUp, Services.addedChangeRealBox, Exchange.roundUp, Exchange.addedChange, TopUpModal.roundUp, OmtWhishAppTransferForm.roundUp, HoldMoneyPickupSheet.roundUp, TelecomForm.buybackRoundUp, CryptoForm.roundUp, PaymentSheet.roundUp, Recharge.roundUp) by explicit path
- [x] T015 Web e2e frontend/tests/e2e-web/lira-web-095-payout-extra-less.spec.ts: OMT receive $102.90 with "+ Extra" 0.10 → drawer delta −103.00 (by identity), Expenses shows "Change rounding" 0.10; saves frontend/public/whats-new/1.35.0/payout-extra-less.png (1400×900)
- [x] T016 `yarn typecheck`, `yarn lint`, `yarn check:i18n` with elapsed times — root runs fail only on LIRA-380/381 files in progress; packages/ui tsc, frontend tsc (app/playwright/test) and eslint clean on every LIRA-382 file
- [x] T018 Record unattended decisions + morning questions in specs/382-payout-extra-less/spec.md (done during analyze)
- [x] T017 Release note bullet + What's new card text proposed in the final report (main session writes UNRELEASED.md)

## Dependencies

T001 → T002–T006 (done) → T007 → T008 → T009 → T010 → T012; T011 parallel with T008–T010; T013–T017 after T012.

## Implementation strategy

MVP = Phase 3 ("+ Extra"); Phase 4 is a small addition in the same component. All in one change, no page edits.
