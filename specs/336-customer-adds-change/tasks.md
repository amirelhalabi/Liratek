# Tasks: Customer adds change on payouts (LIRA-336)

**Input**: spec.md, plan.md, research.md (R1–R9), data-model.md, contracts/added-change.md.

**Tests**: required. Write each guard test first and see it fail (rule 17). Run only the affected files.

## Phase 1: Setup

- [X] T001 Add ticket LIRA-336 to `current_sprint.md` with a "What users will notice:" line. Another session is editing this file: insert the block only, never rewrite it.

## Phase 2: Foundational

- [X] T002 In `packages/core/src/validators/common.ts`, add:
  - `addedChangeFields`: `{ added_change_usd, added_change_lbp: z.number().nonnegative().optional() }`, with no default;
  - `ADDED_CHANGE_OVER_CAP_MESSAGE`, `ADDED_CHANGE_NOT_ALLOWED_MESSAGE`, `ADDED_CHANGE_MISMATCH_MESSAGE`, `ADDED_CHANGE_ACCOUNT_MESSAGE`;
  - `hasAddedChange()`.
- [X] T003 Add the fields to the five schemas (R1):
  - `addedChangeFields` on `createFinancialServiceSchema`, the exchange `keptChangeFields` group, `createRechargeSchema`, `topUpFromClientSchema` and `holdMoneyCollectSchema`;
  - a top-level `customerPayments: z.array(customerLegSchema).min(1).optional()` on recharge, top-up and hold money;
  - relax the financial refine so OMT/WHISH system RECEIVE accepts `customerPayments` only with an added-change claim.
  - Extend `packages/core/src/offline/__tests__/extraChargeReplayShape.test.ts`, or add a sibling test, proving older events still replay.
- [X] T004 Write the failing test `packages/core/src/repositories/__tests__/measureCustomerLegs.test.ts`:
  - existing behaviour is unchanged;
  - with `allowAddedChange`:
    - expected 0 plus $3 cash → added 3;
    - expected 100 plus $103 → added 3;
    - LBP lines on a USD target → added in the expected currency and as USD equivalent;
    - an account leg or a waive with an overpay → refused.
- [X] T005 Split `measureCustomerLegs` (pure, steps 1–4, with `allowAddedChange`) out of `bookCustomerLegs` in `packages/core/src/repositories/moneyPosting.ts`. Add an exported writer for step 5. `bookCustomerLegs` = measure + write, unchanged for existing callers. Make T004 pass.
- [X] T006 Write the failing test `packages/core/src/repositories/__tests__/addedChange.test.ts` for `resolveAddedChange`:
  - no claim → zero;
  - a USD claim of 3 with $3 cash and expected 0 → 3;
  - an LBP line of 268,500 on a USD payout at 89,500 → USD claim 3 accepted;
  - over the cap → refused;
  - a claim that doesn't match the lines → refused;
  - a claim with an account line → refused;
  - `notAllowed` → refused;
  - a claim in the other currency → refused.
- [X] T007 Implement `packages/core/src/repositories/addedChange.ts` (R3) and export it from `repositories/index.ts`. Make T006 pass.

## Phase 3: US1 + US2, OMT/WHISH system receive (P1) 🎯 MVP

- [X] T008 [US1] Write the failing guard test `packages/core/src/repositories/__tests__/lira336.addedChange.test.ts`, section FS system RECEIVE CASH. Cases:
  - $197 owed, customerPayments Cash USD 3, payments Cash USD 200, claim 3 → saved; primary cash drawer net −197; no Change rounding expense; amount and profit as for a plain $197;
  - customer pays LBP 268,500 → USD −200 and LBP +268,500;
  - void → each drawer nets 0;
  - over cap → refused;
  - no claim with customerPayments → refused as today.
  - Also, combined with LIRA-334: $201 handed with $3 added → $1 round-up.
- [X] T009 [US1] In FS `packages/core/src/repositories/FinancialServiceRepository.ts`:
  - accept the claim on the system RECEIVE CASH branch and write the customer's lines via `resolveServiceCashDrawer`;
  - pass owed + added to the round-up, kept-change and `postPayoutLegs` calls;
  - add refusal and fail-closed checks;
  - WHISH fee section: `bookFeeCollectionLegs` gains added change (R5).
  - Make T008 pass.
- [X] T010 [P] [US1] Write the failing test `frontend/src/shared/components/__tests__/MultiPaymentInput.addedChange.test.tsx`:
  - optional section closed by default (no customer section shown);
  - "+ Customer gives change" opens it;
  - Cash USD 3 → "Shop pays" target $200 and the summary row;
  - `onAddedChange({usd:3,lbp:0})`;
  - $200 paid → no round-up and no red;
  - $201 → round-up 1;
  - $199.90 → kept 0.10;
  - LBP 268,500 at 89,500 → added 3;
  - over the cap → section overpaid and `onAddedChange(null)`;
  - × closes, clears and reports null;
  - existing customer section with `allowAddedChange` → above its target counts;
  - an account line never counts.
- [X] T011 [US1] Implement in `packages/ui/src/components/ui/useLinesSection.ts` and `MultiPaymentInput.tsx` (R7), with i18n in `packages/ui/src/i18n/locales/{en,ar}/payment.json`. Make T010 pass. Existing counterFlow tests must stay green.
- [X] T012 [US1] Wire Services `frontend/src/features/services/pages/Services/index.tsx`:
  - optional section on OMT/WHISH RECEIVE cash cashout (no fee section);
  - `allowAddedChange` on the WHISH fee section;
  - send `customerPayments` or `feePayments` plus `added_change_*` from the one payload builder, with a stale guard;
  - Confirm gate.
  - Payload test `Services.addedChange.test.tsx`, failing first.

## Phase 4: US3, every other payout screen (P1)

- [X] T013 [US3] Extend `lira336.addedChange.test.ts` with failing sections for wallet receive (Binance, Whish App), Exchange (USD to LBP, $1 added), credit buy-back, top-up from client and Hold Money (one currency; `voidPickup` nets 0; two-currency refused). Include USD and LBP variants (rule 28d).
- [X] T014 [US3] Implement the measure-early, write-later steps and owed + added in `ExchangeRepository.ts` (USD/LBP only), FS wallet receive, `RechargeRepository.ts` (`processCreditBuyback`, `topUpFromClient`) and `HoldMoneyRepository.ts`. Add `customerPayments` to the payment snapshot where missing. Never change amount, profit, `cashPaid` or the hold portion. Make T013 pass.
- [X] T015 [US3] `packages/core/src/utils/walletTransfer.ts`: add an `addedChange` input to `buildWalletTransferPayload`, with a test.
- [X] T016 [US3] Rule 12: hand-typed payload types in `electron-app/preload.ts`, `frontend/src/types/electron.d.ts`, `electron-app/handlers/rechargeHandlers.ts` and `packages/core/src/services/RechargeService.ts`. Then rebuild core and sync it.
- [X] T017 [P] [US3] Wire the existing customer section with `allowAddedChange` plus `onAddedChange` and the payload: `Exchange/index.tsx` (USD/LBP only), `CryptoForm.tsx` with `Recharge/index.tsx` (Binance), and `OmtWhishAppTransferForm.tsx`. One payload test each, failing first.
- [X] T018 [P] [US3] Wire the optional section plus payload: `HoldMoneyPickupSheet.tsx` (one currency), `TelecomForm.tsx` with `Recharge/index.tsx` (buy-back, via PaymentSheet) and `packages/ui/src/components/ui/TopUpModal.tsx`. Payload tests failing first.
  - Note (screens B done): Exchange (T017 part), HoldMoneyPickupSheet and TopUpModal (T018 parts) wired, with `Exchange.addedChange`, `HoldMoneyPickupSheet.addedChange` and `TopUpModal.addedChange` tests. `PaymentSheet.tsx` now passes `onAddedChange` through (TelecomForm buy-back can use it). Exchange also off inside a customer session (FR-010). CryptoForm, OmtWhishAppTransferForm and TelecomForm are the other agent's part.
  - Note (screens A done): Services (T012), CryptoForm + Recharge (Binance) and OmtWhishAppTransferForm (T017 parts), TelecomForm + Recharge (buy-back optional section, T018 part) wired, with `Services.addedChange`, `Recharge.addedChange` and `OmtWhishAppTransferForm.addedChange` payload tests (failing first) plus `CryptoForm.addedChange` / `TelecomForm.addedChange` pass-through tests (written after the change, not proven failing-first). Services hides the section whenever any partner is set (core refuses THROUGH too).

## Phase 5: Polish

- [X] T019 [P] Docs: `docs/FEATURE_GUIDE.md` (§4.3 / §4.2.1, added change) and `docs/POSTING_MAP.md` (payout row: customer IN lines + OUT legs, reversal).
- [X] T020 [P] Release note in `docs/release-notes/UNRELEASED.md`, under "Payment window", in shop-owner language.
- [ ] T021 Run the affected tests (new ones plus the existing counterFlow, customer-pays, kept-change and round-up tests of the touched files), `yarn typecheck`, `yarn lint` and the CI checks.
- [X] T022 Add the web e2e spec `frontend/tests/e2e-web/lira-web-076-customer-adds-change.spec.ts` (REST): OMT receive $197 with Cash USD 3 in and Cash USD 200 out → drawer −197 net, no Change rounding expense, void nets 0; over-cap refused; no claim refused. Run it.

## Dependencies

- Phase 2 blocks everything.
- Core (T008–T009, T013–T016) and UI (T010–T011) can run in parallel.
- Screens (T012, T017, T018) need T011 and T003. Run T012 after the core rebuild (T016).
- Polish comes last.
