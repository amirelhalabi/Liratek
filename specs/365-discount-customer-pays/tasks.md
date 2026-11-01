# Tasks: Discount wherever a customer pays the shop (LIRA-365)

**Input**: `specs/365-discount-customer-pays/` (spec, plan, research, data-model, contracts, quickstart)

**Tests**: REQUIRED. The constitution (rules 17, 20, 24, 28d) requires guard tests that are written first and seen failing before the fix. Every test is run on its own file path only, never a full suite. Ask the owner before running any test. No Electron or desktop e2e on this Mac.

**Format**: `- [ ] Txxx [P?] [Story?] Description with file path`

---

## Phase 1: Setup

- [ ] T001 Read `docs/FEATURE_GUIDE.md` §13 and write a short "§13 walk" at the end of `specs/365-discount-customer-pays/research.md`. Fill in each item for this feature: transaction row fields, IN/OUT badge, payment legs, client propagation, CUSTOMER_ACCOUNT, supplier/partner ledger, void path, profit stamping, session branch.

---

## Phase 2: Foundational (blocks every story)

- [x] T002 Add `DISCOUNT_GIVEN_EXPENSE_CATEGORY = "Discount_Given"` next to `CHANGE_ROUNDING_EXPENSE_CATEGORY`, and export it from both `packages/core/src/index.ts` and `packages/core/src/browser.ts`. The module must be a leaf with no Node import (rule 29). Find the constant's home with `grep -rn CHANGE_ROUNDING_EXPENSE_CATEGORY packages/core/src`.
- [x] T003 Add the shared refusal messages and one cap helper `discountWithinCap(discount, waived, currency)` in `packages/core/src/validators/exchange.ts`, next to `SHORTFALL_MAX` / `isWithinShortfallMax`. It must enforce: "discount + waived ≤ SHORTFALL_MAX[currency], compared in the total's own currency, never converted; any other currency allows 0".
- [x] T004 Write a failing guard test `packages/core/src/repositories/__tests__/discountGivenExpense.test.ts`. A Discount_Given expense written for a parent must be books-only (no payments row, no drawer movement), have `is_auto` true from `source_ref_table`, take the parent's date and time, and be voided by `voidLinkedExpenses(sourceTable, sourceId)`. Record the failure.
- [x] T005 Create `packages/core/src/repositories/discountGivenExpense.ts`, modelled on `repositories/changeRoundingExpense.ts`. It exports `bookDiscountGivenExpense(db, { sourceTable, sourceId, amount, currency, createdAt, createdBy, tenantId, description })` through `ExpenseRepository.createExpense` with `books_only: true`. T004 must now pass.
- [x] T006 [P] Add the label "Discount given" (en) and its Arabic translation for `Discount_Given` in `frontend/src/features/expenses/utils/expenseCategoryLabel.ts` and the matching locale JSON under `packages/ui/src/i18n/locales/{en,ar}/`.

**Checkpoint**: the expense helper exists and is proven. The stories can start.

---

## Phase 3: User Story 1 — Discount on an OMT/Whish system send (P1) 🎯 MVP

**Goal**: A walk-in OMT/Whish system SEND takes a discount of up to $5 / 450,000 LBP. What is owed to OMT/Whish and the commission stay unchanged, and the shop records "Discount given".

**Independent test**: $400 WU + $15 fee − $2, $413 cash. Drawer +413, OMT owed 415, Discount_Given $2, commission $1.50. A void nets every ledger to 0.

### Tests first (each one seen failing before T011)

- [x] T007 [P] [US1] Write a core guard in `packages/core/src/repositories/__tests__/FinancialServiceRepository.lira365Discount.test.ts`.
  - Accepted: $400 WU + $15, `discount_amount: 2`, cash $413. Drawer +413; supplier ledger owes 415; one Discount_Given expense $2, books-only, `is_auto`, `source_ref_table "financial_services"`; commission unchanged; `details.discount = {amount:2,currency:"USD"}`.
  - Accepted, LBP: an LBP send with a 450,000 discount.
  - Refused: $6; 500,000 LBP; discount + `customer_waived_amount` above the cap; RECEIVE; `partnerMode:"FOR"`; `deferPayment:true`; provider OMT_APP/BINANCE; discount ≥ amount + fee; with `includingFees`, discount ≥ amount.
- [x] T008 [P] [US1] Write a core guard in `packages/core/src/repositories/__tests__/TransactionRepository.lira365DiscountVoid.test.ts`. Void, then separately refund, the discounted send from T007. Drawer, supplier ledger and expenses must each net to 0 per currency (rule 20).
- [x] T009 [P] [US1] Add schema cases in `packages/core/src/validators/__tests__/financial.lira365Discount.test.ts`. `createFinancialServiceSchema` must accept or refuse the same matrix as T007, using the shared messages from T003.

### Implementation

- [x] T010 [US1] Add `discount_amount: z.number().nonnegative().optional()` (in the send's `currency`) to `createFinancialServiceSchema` in `packages/core/src/validators/financial.ts`, with refines matching T009. Confirm `electron-app/schemas/index.ts` re-exports it and `backend/src/api/` validates with the same schema. No per-transport copy.
- [x] T011 [US1] In `packages/core/src/repositories/FinancialServiceRepository.ts`:
  - Add `discount_amount` to the create data type.
  - Repeat the schema refusals (offline replay skips Zod).
  - Subtract the discount from `totalCustomerPays` before `reconcileLegs` (~4944-4990). Do not touch the provider fee, the supplier-ledger amount or the commission.
  - After the transaction row exists, call `bookDiscountGivenExpense` (T005) with `sourceTable "financial_services"` and the row's `created_at`.
  - Put `discount` into `buildOmtWhishTransferDetails`.
  - Check the CUSTOMER_ACCOUNT debt equals the discounted unpaid part.
  - T007, T008 and T009 must now pass.
- [x] T012 [US1] Confirm that the generic void and refund (`TransactionRepository._cascadeExpenseSiblingVoid`, ~6382 / ~7106) reach the new expense, with no new code. If T008 still fails, fix the cascade, not the test.
- [x] T013 [US1] Rebuild core and sync it: `cd packages/core && npm run build`, then `cp -r packages/core/dist/. node_modules/@liratek/core/dist/`.

### Frontend

- [x] T014 [US1] Rewrite `frontend/src/features/services/pages/Services/__tests__/Services.sendNoDiscount.test.tsx` (do not delete it, rule 24) into a guard. It must check that the walk-in OMT and Whish system SEND show the Discount line and send `discount_amount`; that FOR, a session cart item and RECEIVE do not; and that field names are parsed through `createFinancialServiceSchema`. Seen failing.
- [x] T015 [US1] Write a variant test in `frontend/src/features/services/pages/Services/__tests__/Services.lira365DiscountVariants.test.tsx` (rule 28d). It walks every `OmtServiceType`, with "Fee included in amount" on and off, × walk-in / session / FOR. It builds the payload as the screen does and runs it through the real `createFinancialServiceSchema`. The payment total is lowered by the discount only where allowed. Seen failing.
- [x] T016 [US1] In `frontend/src/features/services/pages/Services/index.tsx`:
  - Turn on `showDiscount` for the walk-in system SEND only (not FOR, not session, not RECEIVE).
  - Pass `maxDiscount` = `SHORTFALL_MAX[currency]`.
  - Keep the emitted amount in state through `onDiscountChange`, and lower `sendCustomerTotal` by it. One derivation is used for both the screen and the payload (rule 14).
  - Add `discount_amount` to the ONE payload builder (rule 22).
  - Rewrite the comment at ~2645-2652.
  - T014 and T015 must now pass.
- [x] T017 [US1] Re-run `Services.sendExtra.test.tsx`, `Services.roundUp.test.tsx`, `Services.omtFeeZero.test.tsx` and `Services.brokerageFee.test.tsx` (paths only). Turning on `showDiscount` changes the extra-only line into the −Discount/+Extra switch and shows the built-in Waive. Update the expectations only where the new behaviour is intended, and say which.

**Checkpoint**: US1 works on its own (MVP).

**Done 2026-11-01.**
- Proven failing first: core `discountGivenExpense` (4) and `FinancialServiceRepository.lira365Discount` (14, covering T007–T009 and the T008 void/refund cases in one file). Frontend `Services.sendDiscount` (renamed from `sendNoDiscount`; 16 of 18 failed first, the 2 "no Discount line" cases already held). T015's variants are in the same file: every OMT type except OMT_WALLET/ONLINE_BROKERAGE, fee on top and fee included.
- `Services.sendExtra` was updated on purpose: `showDiscount` is now true.
- Neighbours pass: `FinancialServiceRepository.extraCharge`, `Services.roundUp`, `omtFeeZero`, `brokerageFee`.
- Research correction: `amount` reaching the repository is always the net principal, even with "Fee included", so the limit is `discount < amount + fee` in both modes.

---

## Phase 4: User Story 2 — Discount line in the customer-pays box (P2)

**Goal**: Exchange and the Whish App / OMT App / Binance cash-outs show the standard Discount line instead of the "Forgive $X" button. The booking (`customer_waived_amount`), the cap (`maxForgive`) and the reversal are unchanged.

**Independent test**: an exchange where the customer owes 9,000,000 LBP and types a 50,000 LBP discount. The payload carries `customer_waived_amount: 50000` as Forgive did; WAIVED_SHORTFALL is −50,000 LBP; a void nets 0.

- [x] T018 [P] [US2] Write a UI guard in `packages/ui/src/components/ui/__tests__/MultiPaymentInput.lira365CounterFlowDiscount.test.tsx`. With `counterFlow` and `maxForgive`, the box renders a `DiscountLine` (no `counter-flow-forgive` button). It shows "Total Amount", the Discount line and "After Discount". Typing an amount reports it as forgiven, clamped to `maxForgive`, and shows "Capped to max". A single line follows the discounted total. A line edit keeps the discount. No Waive button in this box (owner 2026-11-01), no Extra switch. Seen failing.
- [x] T019 [P] [US2] Write a core guard in `packages/core/src/repositories/__tests__/ExchangeRepository.lira365DiscountDetails.test.ts`. An exchange with `customer_waived_amount` 50,000 LBP stores `details.discount = {amount:50000,currency:"LBP"}`, books WAIVED_SHORTFALL −50,000, and a void nets 0. Seen failing on the details part.
- [x] T020 [US2] In `packages/ui/src/components/ui/MultiPaymentInput.tsx` (~2927-2945 and the counter-flow state in `useLinesSection`), replace the counter-flow Forgive toggle with a `DiscountLine` (`packages/ui/src/components/ui/DiscountLine.tsx`). It is labelled "Discount", placed under "Total Amount" like every other page, and its typed amount feeds `cf.state.forgiven`. Keep the `maxForgive` cap. No Waive button in this box (owner 2026-11-01). The hook (`useLinesSection.ts`) holds a typed discount instead of the Forgive toggle; every line-following path uses `totalAmount − discount`. Update the en and ar labels. T018 must now pass.
- [x] T020a [US2] On walk-in cash-outs, hide the shop-pays fee Discount while the customer-pays box is shown (`OmtWhishAppTransferForm.tsx`, `CryptoForm.tsx`), and send no fee discount then. One Discount per screen (owner 2026-11-01).
- [x] T021 [US2] In `packages/core/src/repositories/ExchangeRepository.ts`, write `details.discount` from `customer_waived_amount` in `buildExchangeDetails` (~246). Do the same for the cash-out paths in `FinancialServiceRepository.ts` that book `customer_waived_amount` (~2991). T019 must now pass. Rebuild and sync core (as T013).
- [x] T022 [US2] Rewrite the tests that click `counter-flow-forgive` so they type into the Discount line instead, keeping the same booked amounts:
  - `frontend/src/features/recharge/components/__tests__/PaymentSheet.counterFlow.test.tsx`
  - `frontend/src/shared/components/__tests__/MultiPaymentInput.test.tsx`
  - `packages/ui/src/components/ui/__tests__/MultiPaymentInput.payloadLanguage.test.tsx`
  - `frontend/src/features/exchange/pages/Exchange/__tests__/Exchange.customerPays.test.tsx`

  Run each on its own path.
- [x] T023 [US2] Grep `frontend/tests/e2e-web` for `counter-flow-forgive` and update any web e2e spec that clicks it.

**Checkpoint**: US2 works on its own; US1 still passes.

---

## Phase 5: User Story 3 — Discount on a voucher sale (P3)

**Goal**: A $50 voucher sold for $48. The sale records $48 paid, the voucher keeps its $50 value, "Discount given" is $2, and cancel refunds $48 and voids the expense.

- [ ] T024 [P] [US3] Write a core guard in `packages/core/src/repositories/__tests__/VoucherRepository.lira365Discount.test.ts`.
  - Sale: `discount_amount: 2` on a $50 voucher with $48 cash. VOUCHER_SALE amount 48; voucher face 50; Discount_Given $2 linked to `vouchers`; `details.discount`.
  - Refused: $6, discount ≥ face value.
  - `cancelWithRefund` refunds $48 and voids the expense. Drawer, debt and expenses net 0 per currency, including a case with $10 on CUSTOMER_ACCOUNT.

  Seen failing.
- [ ] T025 [US3] Add `discount_amount: z.number().nonnegative().optional()` and refines to `packages/core/src/validators/voucher.ts` (constraint: "≤ SHORTFALL_MAX[currency], < face value").
- [ ] T026 [US3] In `packages/core/src/repositories/VoucherRepository.ts`:
  - `sellVoucher` reconciles legs against face value − discount, and writes the VOUCHER_SALE amount = what was paid.
  - It calls `bookDiscountGivenExpense` (`sourceTable "vouchers"`).
  - `buildVoucherDetails` gets `discount`.
  - `cancelWithRefund` calls `voidLinkedExpenses("vouchers", id)`.

  T024 must now pass. Rebuild and sync core.
- [ ] T027 [US3] Check every reader of the VOUCHER_SALE amount for a face-value assumption, and fix any that reads face value from the sale:
  - `packages/core/src/utils/cashFlow.ts`
  - `packages/core/src/utils/clientDebtDetails.ts`
  - `packages/core/src/utils/transactionText.ts`
  - `packages/core/src/constants/postingRules.ts`
  - `packages/core/src/constants/paidViaVoucher.ts`
  - `frontend/src/features/audit/transactionPresentation.ts`
  - `frontend/src/features/vouchers/utils/voucherLegs.ts`

  Record each verdict in a comment on the task. Re-run `VoucherRepository.cancelRefund`, `VoucherRepository.sale`, `ProfitRepository.voucher` and `TransactionRepository.paidViaVoucher` (paths only).
- [ ] T028 [US3] In `frontend/src/features/vouchers/pages/Vouchers/index.tsx`, turn on the Discount line on the sale sheet (`showDiscount`, `maxDiscount` = cap, `onDiscountChange`), and add `discount_amount` to the one payload builder. Extend `frontend/src/features/vouchers/pages/Vouchers/__tests__/Vouchers.sellCancel.test.tsx`, failing first, with names from the voucher schema.

**Checkpoint**: all three stories work on their own.

---

## Phase 6: User Story 4 — POS unchanged (P3)

- [ ] T029 [US4] Add a guard in `frontend/src/features/sales/pages/POS/components/__tests__/CheckoutModal.lira365NoCap.test.tsx`: a $30 discount on a $300 sale is still accepted, so POS keeps its uncapped discount. Expected to pass at once. Label it "not a failing-first guard: pins existing behaviour".

---

## Phase 7: Polish & cross-cutting

- [ ] T030 Write a web e2e `frontend/tests/e2e-web/lira-web-087-discount.spec.ts`:
  - A discounted OMT system send.
  - A discounted exchange through the Discount line.
  - Match rows by identity and assert deltas (rule 15): drawer, OMT owed and Discount_Given expense.
  - Save a landscape PNG to `frontend/public/whats-new/<next version>/discount-line.png`.
- [ ] T031 Add release notes to `docs/release-notes/UNRELEASED.md`:
  - Bullets under OMT / Whish, Exchange and Vouchers.
  - A `### Discount on OMT/Whish sends, exchanges and vouchers` card in `## ✨ Highlights` with the T030 screenshot.
  - Then run `node scripts/build-release-notes.cjs --check`.
- [ ] T032 Update the LIRA-365 ticket in `current_sprint.md`: what was built, tests marked as proven failing-first or not, and the "What users will notice" line.
- [ ] T033 Run the gates: `yarn typecheck`, `yarn lint`, `yarn check:transport-parity`, `yarn check:tenant-scoping`, `yarn check:bind-arity`. Measure elapsed time, not output size (rule 28a).

---

## Dependencies

- T001 → T002-T006 (foundational) → US1 / US2 / US3.
- US1 (T007-T017) needs T002-T005.
- US2 (T018-T023) needs no new expense, only T002. It can run alongside US1.
- US3 (T024-T028) needs T002-T005.
- Polish (T030-T033) comes after the stories that ship.
- Core edits are followed by build and sync (T013 pattern) before any frontend test that imports `@liratek/core`.

## Parallel examples

- After T005: T007, T008 and T009 (US1 tests); T018 and T019 (US2 tests); T024 (US3 test). These are different files.
- T006 runs in parallel with anything.

## Implementation strategy

1. **MVP = US1**: the owner's original ask (OMT system send). Ship it after T017 plus T031 and T033.
2. Then US2 (the same Discount control on every customer-pays box).
3. Then US3 (vouchers).
4. Each story ends with core build and sync, typecheck and lint, and affected tests only.
