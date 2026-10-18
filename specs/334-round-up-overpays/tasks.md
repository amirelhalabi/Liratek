# Tasks: Round-up overpays (LIRA-334)

**Input**: Design documents in `specs/334-round-up-overpays/`: plan.md, spec.md, research.md, data-model.md, contracts/payout-rounding.md and quickstart.md.

**Tests**: These are required. Rule 17 says each guard test is written first and seen failing on the code before the fix. Run only the affected test files, never a full suite.

## Phase 1: Setup

- [X] T001 Add ticket LIRA-334 to `current_sprint.md`, with a "What users will notice:" line and a link to `specs/334-round-up-overpays/`.

## Phase 2: Foundational (blocks every story)

- [X] T002 Add the refusal messages `ROUNDING_GIVEN_OVER_CAP_MESSAGE`, `ROUNDING_GIVEN_WITH_KEPT_MESSAGE`, `ROUNDING_GIVEN_NOT_ALLOWED_MESSAGE` and `ROUNDING_GIVEN_CURRENCY_MESSAGE`, plus a shared `roundingGivenFields` object, to `packages/core/src/validators/common.ts`.
  - The object is `{ rounding_given_usd: z.number().nonnegative().optional(), rounding_given_lbp: z.number().nonnegative().optional() }`.
  - Do NOT add a `.default()`, because offline replay would refuse old events.
  - Export it from both `index.ts` and `browser.ts` if needed.
- [X] T003 Write the failing guard test `packages/core/src/repositories/__tests__/roundingGiven.test.ts` for `resolveRoundingGiven`. Cover:
  - no claim → zero;
  - USD claim 0.10 on owed 102.90 with legs 103 → `{usd: 0.10}`;
  - LBP claim 5,000 on 1,345,000 → ok;
  - USD payout topped up with an LBP leg → USD claim ok;
  - over the cap → refused;
  - claim with kept → refused;
  - partner, deferred, no legs, non-drawer leg or OUT leg → refused;
  - claim in the wrong currency → refused;
  - claim that does not match the legs → refused with the reconcile message.
- [X] T004 Implement `resolveRoundingGiven` in a new `packages/core/src/repositories/roundingGiven.ts`, following research R3 (modelled on the payout branch of `keptChange.ts`, using `isWithinShortfallMax` and `reconcileLegs` against `owed + rounding`). Make T003 pass.
- [X] T005 Write the failing guard test `packages/core/src/repositories/__tests__/changeRoundingExpense.payout.test.ts`. A USD and an LBP amount each book one "Change rounding" expense with the right `amount_usd` / `amount_lbp`, no payments row, `is_auto` true, and the expense day = the client day.
- [X] T006 Implement `bookPayoutRoundingExpense` in `packages/core/src/repositories/changeRoundingExpense.ts` (research R4), export it from `packages/core/src/repositories/index.ts`, and make T005 pass.
- [X] T007 Add `roundingGiven?: { usd: number; lbp: number }` to `PostPayoutLegsInput` in `packages/core/src/repositories/moneyPosting.ts`. The internal reconcile target becomes `owed − kept + rounding`.
- [X] T008 Add a public `voidLinkedExpenses(sourceTable, sourceId)` that wraps the private `_cascadeExpenseSiblingVoid`, in `packages/core/src/repositories/TransactionRepository.ts`.

## Phase 3: User Story 1, OMT/Whish system receive (P1) 🎯 MVP

**Goal**: An OMT receive of $102.90 paid out as $103 saves and books a $0.10 "Change rounding" expense, on desktop and web.

**Independent test**: the core test below, plus the MPI test.

- [X] T009 [US1] Write the failing guard test `packages/core/src/repositories/__tests__/lira334.payoutRounding.test.ts`, FSR system receive section:
  - a CASH payout of 103 on 102.90 with `rounding_given_usd: 0.10` saves;
  - the drawer goes down by 103;
  - one expense of 0.10 is booked;
  - the profit stamp is unchanged;
  - a void nets the drawer, expenses and profit to 0;
  - the expense transaction has `metadata_json.is_auto === true`;
  - a rounding of 6 is refused;
  - an overpay with no claim is still refused.
- [X] T010 [US1] Add `...roundingGivenFields` to `createFinancialServiceSchema` in `packages/core/src/validators/financial.ts`, and the fields to `CreateFinancialServiceData` in `FinancialServiceRepository.ts`.
- [X] T011 [US1] In `packages/core/src/repositories/FinancialServiceRepository.ts`, system RECEIVE CASH branch (~:5140-5178):
  - resolve the rounding and pass it to `postPayoutLegs`;
  - book `bookPayoutRoundingExpense` with parent `financial_services` / id;
  - refuse a claim on FOR partner, deferred, CUSTOMER_ACCOUNT or wallet cashout;
  - add a fail-closed check: a claim that no branch verified is refused.
  - Make T009 (system receive) pass.
- [X] T012 [P] [US1] Write the failing test `frontend/src/shared/components/__tests__/MultiPaymentInput.payoutRoundUp.test.tsx`:
  - with `onRoundUpChange`, a payout overpay of 0.10 shows `payout-roundup-summary`, the Paid figure is not red, and it reports `{usd:0.10, lbp:0}`;
  - over the cap it reports null and the figure is red;
  - without the prop the behaviour is unchanged;
  - with `payoutExcessToAccount` the round-up never fires;
  - switching the payer reports null.
- [X] T013 [US1] Implement `onRoundUpChange` in `packages/ui/src/components/ui/MultiPaymentInput.tsx` (research R6), with i18n `summary.roundUpBooked` in `packages/ui/src/i18n/locales/{en,ar}/payment.json`. Make T012 pass.
- [X] T014 [US1] Wire Services RECEIVE in `frontend/src/features/services/pages/Services/index.tsx`:
  - pass `onRoundUpChange` when the kept-change conditions apply (CASH cashout, no session, not FOR);
  - store `{usd, lbp, payout}`;
  - send `rounding_given_*` in the one `apiPayload` builder;
  - reset it on submit or clear.

## Phase 4: User Story 2, every other payout screen (P1)

**Goal**: Round-up works on Binance cash-out, OMT/Whish App receive, From-client top-up, Exchange, Hold Money pickup (one currency) and credit buy-back.

- [X] T015 [US2] Extend `lira334.payoutRounding.test.ts` with failing sections for each of these: wallet receive (Binance USD, Whish App USD), exchange payout, credit buy-back, top-up from client, and one-currency Hold Money pickup. Each case is saved → one expense → void nets 0. Run one USD case and one LBP case where the flow allows it (rule 28d). For Hold Money, `voidPickup` voids the expense. A Hold Money two-currency pickup with a claim is refused.
- [X] T016 [P] [US2] Add the schema fields: `keptChangeFields` in `packages/core/src/validators/exchange.ts`, `createRechargeSchema` and `topUpFromClientSchema` in `packages/core/src/validators/recharge.ts`, and `holdMoneyCollectSchema` in `packages/core/src/validators/holdMoney.ts`.
- [X] T017 [US2] FSR wallet RECEIVE branch (~:4392-4409): resolve and book with parent `financial_services` / id. Refuse when the cashout is CUSTOMER_ACCOUNT.
- [X] T018 [US2] `packages/core/src/repositories/ExchangeRepository.ts`: reconcile at `owed − kept + rounding` (~:857-874) and book the expense after the transaction is inserted (parent `exchange_transactions` / id). Refuse for a partner.
- [X] T019 [US2] `packages/core/src/repositories/RechargeRepository.ts`:
  - in `processCreditBuyback`, resolve before the db transaction, pass to `postPayoutLegs`, then book inside the transaction after `txnId` (parent `recharges` / id); refuse when `partnerMode === "FOR"`;
  - in `topUpFromClient`, resolve and book in the same way.
- [X] T020 [US2] `packages/core/src/repositories/HoldMoneyRepository.ts`: for a one-currency pickup, resolve and book after the pickup row is inserted (parent `hold_money_pickups` / pickupId). Refuse a claim on a two-currency pickup. `voidPickup` calls `voidLinkedExpenses("hold_money_pickups", pickupId)`.
- [X] T021 [US2] Make T015 pass. Rebuild core and sync it: `cd packages/core && npm run build && cp -r dist/. ../../node_modules/@liratek/core/dist/`.
- [X] T022 [US2] Add the `roundingGiven` input to `buildWalletTransferPayload` in `packages/core/src/utils/walletTransfer.ts`, emitting `rounding_given_*`.
- [X] T023 [P] [US2] Pass `onRoundUpChange` through `frontend/src/features/recharge/components/PaymentSheet.tsx`, `CryptoForm.tsx` and `TelecomForm.tsx` (props).
- [X] T024 [US2] Wire `frontend/src/features/recharge/pages/Recharge/index.tsx`: store and send for Binance (`handleCryptoSubmit`) and for the buy-back (`handleTelecomSubmit`), each with the `payout` stale guard.
- [X] T025 [P] [US2] Wire `frontend/src/features/recharge/components/OmtWhishAppTransferForm.tsx` through the builder.
- [X] T026 [P] [US2] Wire `packages/ui/src/components/ui/TopUpModal.tsx` (`onConfirmClient` payload).
- [X] T027 [P] [US2] Wire `frontend/src/features/exchange/pages/Exchange/index.tsx` (`handleProcess`).
- [X] T028 [P] [US2] Wire `frontend/src/features/custom-services/components/HoldMoneyPickupSheet.tsx`, for one-currency pickups only.
- [X] T029 [US2] Add a page-level payload test for one wired screen (Services RECEIVE) in `frontend/src/features/services/pages/Services/__tests__/Services.roundUp.test.tsx`. The field names come from the schema (rule 24).

## Phase 5: User Story 3, customer-pays autofill (P2)

- [X] T030 [P] [US3] Write the failing test for `suggestRoundUpExtra` in `packages/ui/src/components/ui/__tests__/roundUpExtra.test.ts`: overpay 0.10 → 0.10; overpay 0 → 0; overpay 6 → 0; LBP 5,000 → 5,000; above the page cap → 0.
- [X] T031 [US3] Implement `packages/ui/src/components/ui/roundUpExtra.ts`.
- [X] T032 [US3] Write the failing test `frontend/src/shared/components/__tests__/MultiPaymentInput.autoExtra.test.tsx`:
  - with `onExtraChange`, paying 103 on 102.90 switches to extra 0.10, `onExtraChange(0.10)` fires and there is no change box;
  - when cleared, the change box shows and the extra does not refill;
  - changing a leg refills it;
  - with a discount typed, nothing is filled;
  - payout mode → nothing is filled.
- [X] T033 [US3] Implement the autofill effect and the dismiss ref in `packages/ui/src/components/ui/MultiPaymentInput.tsx`, plus the hint `discountLine.autoExtraHint` in `packages/ui/src/i18n/locales/{en,ar}/ui.json`.
- [X] T034 [US3] Write the failing test `frontend/src/features/sales/pages/POS/components/__tests__/CheckoutModal.autoExtra.test.tsx`: 103 paid on a 102.90 cart → the payload has `extra_usd` 0.10; when cleared → no extra; for a partner sale → no autofill.
- [X] T035 [US3] Implement the autofill in `frontend/src/features/sales/pages/POS/components/CheckoutModal.tsx` using `suggestRoundUpExtra`.

## Phase 6: Polish

- [X] T036 [P] Update the docs: `docs/FEATURE_GUIDE.md` (payout round-up and the autofill, in the §4.2 Extra charges area), and `docs/POSTING_MAP.md` (the payout round-up expense row and its reversal owners, including Hold Money).
- [X] T037 [P] Add release-note lines in `docs/release-notes/UNRELEASED.md`, in shop-owner language.
- [X] T038 Run the affected tests from `quickstart.md`, the existing kept-change and extra tests next to the files touched, `yarn typecheck` and `yarn lint`.
- [X] T039 Add the web e2e spec `frontend/tests/e2e-web/lira-web-0NN-payout-roundup.spec.ts` (next free number): an OMT receive of 102.90 paid out as 103 → one "Change rounding" expense for this receive; the drawer delta is −103; the void nets to 0. Match rows by identity and assert deltas (rule 15). Constitution VI.

## Dependencies

- Phase 2 blocks everything.
- US1 core (T009-T011) and US1 UI (T012-T013) can run in parallel. T014 needs both.
- US2 needs T013 (the MPI prop) for the UI tasks, and T004, T006, T007 and T008 for the core tasks.
- US3 depends only on Phase 2 (and on nothing else for the UI helper). It can run in parallel with US2.

## Parallel examples

- US2 core: T017, T018, T019 and T020 touch different repositories. Give them one shared test file section each.
- US2 UI: T025, T026, T027 and T028 can run in parallel after T023.

## Implementation strategy

MVP = Phase 2 + US1 (OMT receive, which is the owner's case). Then US2 (all payout screens), then US3 (autofill). No commit until the owner says so.
