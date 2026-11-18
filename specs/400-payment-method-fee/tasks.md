# Tasks: Payment method fee (phase 1)

**Input**: spec.md, plan.md, research.md, data-model.md, contracts/
**Tests**: required (rule 17 failing-first, rule 28d variants).

## Phase 1: Setup / foundation

- [x] T001 Migration v233 `payments.fee_amount` (up/down) in `packages/core/src/db/migrations/index.ts`; column in `electron-app/create_db.sql`
- [x] T002 [P] Leaf `packages/core/src/utils/legFee.ts` (eligibility, caps, messages, `priceOnlyLegRow`), exported from `browser.ts` + `index.ts`
- [x] T003 `insertPaymentRow` accepts `feeAmount` (`moneyPosting.ts`); `assertLegFeesAllowed(legs)` server check through the shared `legFeeError` with the DB method lookup (`isDrawerAffectingMethod` + `paymentMethodToDrawerName`)

## Phase 2: Guard tests FIRST (US1, US2) — must fail before T006–T010

- [x] T004 `packages/core/src/repositories/__tests__/paymentMethodFee.guard.test.ts`: through the real schemas + services: POS Whish $10 + $1 fee → Whish +11; void nets 0 (drawer + PM_FEE profit, per currency); refund keeps +1 in Whish and profit; recharge + debt repayment same; refusals (cash line, CUSTOMER_ACCOUNT, OUT leg, fee > amount, negative). Record the real failures.
- [x] T005 Variant tests (rule 28d), in the same file (`LIRA-400 variants` blocks): per form (POS, telecom recharge, debt repayment) — cash only; Whish + fee; split USD + LBP with fees; Whish + fee + change in the other currency.

## Phase 3: Core (US1–US4)

- [x] T006 Schemas: `salePaymentLegSchema.fee_amount`, recharge leg `feeAmount`, `repaymentPaymentLineSchema.feeAmount` + refine via legFee
- [x] T007 Post the fee: SalesRepository, RechargeRepository, DebtRepository in-leg loops (amount + fee, feeAmount, drawer delta amount + fee)
- [x] T008 Reversal: `_reversePayments` void/refund; `overridableNetByCurrency`, `paymentRowsToLegs`, `getPaymentsByTransactionId`, `_attachPaymentLegs` fee; `SalesRepository._itemRefundLegRows` + `_applySaleItemMoneyBack` price part
- [x] T009 Profit: `legFeeProfit` fragments in ProfitRepository (totals by currency, by method, detail, by date, by user, by client); ProfitService folds into PM_FEE + `pm_fee_by_method`
- [x] T010 Core build + sync; run T004/T005 green

## Phase 4: Transport + UI

- [x] T011 `electron-app/preload.ts` + `frontend/src/types/electron.d.ts` leg fee keys (rule 12; `ApiAdapter` payloads are already schema-derived, nothing to add)
- [x] T012 `MultiPaymentInput` `lineFees` mode (+ fee button, fee box, summary fee line, Paid = price + fee), exclusive with `showPmFee`; `PaymentLine.fee`
- [x] T013 `toSnakeLegs` / `toCamelLegs` carry fee
- [x] T014 POS CheckoutModal `allowLineFees` (POS only); PaymentSheet opt-in from TelecomForm; Debts repay mode
- [x] T015 Refund modal net minus fee (`refundLegOverride.ts`); Profits PM fee card by method
- [x] T016 Component tests (MultiPaymentInput lineFees)

## Phase 5: Proof + delivery

- [x] T017 Web e2e `frontend/tests/e2e-web/lira-web-103-payment-method-fee.spec.ts` + screenshot `frontend/public/whats-new/1.35.0/payment-method-fee.png`
- [x] T018 `docs/release-notes/UNRELEASED.md` bullets + Highlights card; `node scripts/build-release-notes.cjs --check`
- [x] T019 `current_sprint.md` LIRA-400 entry
- [x] T020 `yarn typecheck`, `yarn lint`, affected suites, full core suite `--maxWorkers=2`

## Dependencies
T001–T003 → T004/T005 (written, run failing) → T006–T009 → T010 → T011–T016 → T017–T020.

## Analyze (speckit-analyze, 2026-11-18)

Cross-artifact pass, no CRITICAL findings:
- Every FR maps to a task (FR-001–006 → T003/T006/T007/T012–T014; FR-007 → T009/T015; FR-008 → T008; FR-009 → T007; FR-010 → T006/T011).
- Constitution IV (money): reversal owner = generic `_reversePayments`; refund readers use one helper (`priceOnlyLegRow`).
- MEDIUM, logged for phase 2: the transaction's `payment_snapshot` (Transactions › details "how the customer paid") lists the leg without its fee; receipts/WhatsApp likewise (`getCustomerFacingLegs` shows the full amount received).
- LOW: the guard tests drive core through the schema with screen-shaped JSON; the frontend leg builders are covered separately (`paymentUtils.test.ts` parses their output with the same schemas).
