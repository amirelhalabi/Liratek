# Implementation Plan: Payment method fee (phase 1)

**Branch**: `400-payment-method-fee` (built on `main`, no branch) | **Date**: 2026-11-18 | **Spec**: [spec.md](./spec.md)

## Summary

A typed per-line fee on wallet payment lines. Stored as `payments.fee_amount` (a part of `payments.amount`, which stays the whole drawer movement). Posted by the three phase-1 repositories (Sales, Recharge, Debt repayment), reversed by the generic void (fee and all) and kept by refunds (price part only). Reported by the existing PM_FEE profit source from one new SQL fragment. UI: an opt-in `lineFees` mode on `MultiPaymentInput`, turned on by POS checkout, the telecom payment sheet and Debts repay.

## Technical Context

**Language/Version**: TypeScript strict (core, electron-app, backend, frontend, packages/ui)
**Primary Dependencies**: zod, better-sqlite3, React 19
**Storage**: SQLite — migration v233 adds `payments.fee_amount REAL NOT NULL DEFAULT 0`
**Testing**: core jest (repo/service guards, variant tests), packages/ui + frontend jest for the component, Playwright web e2e `lira-web-103`
**Target Platform**: desktop (Electron IPC) and web (REST) — same core service
**Constraints**: rule 29 (leaf module reachable from `browser.ts`), rule 17 (failing-first), rule 20 (reversal owner), rule 23/24 (schema keys)

## Constitution Check

| Principle | Status |
| --- | --- |
| I. One core, two transports | PASS — no new channel; the three existing schemas gain the key, both transports and offline bindings feed the same services |
| II. Layer boundaries | PASS — SQL only in repositories (`moneyPosting`, `TransactionRepository`, `ProfitRepository`); `ProfitService` only assembles |
| III. Contracts defined once | PASS — eligibility/caps in `utils/legFee.ts` used by screen + server; one profit SQL fragment `legFeeProfitSql`; payload types already derived from schemas (`SaleProcessPayload`, `CreateRechargePayload`, `AddRepaymentPayload`) |
| IV. Money integrity | PASS — §13 walked (below); reversal owner = generic `_reversePayments`; create+void nets 0, create+refund keeps fee, failing-first |
| V. Data/security | PASS — server-side validation on both transports |
| VI. Testing | PASS — guard tests failing-first; variant tests per form (rule 28d); web e2e |
| Delivery | PASS — UNRELEASED bullets + Highlights card with real screenshot |

### FEATURE_GUIDE §13 walk

1. Schema/plumbing: migration both files; schemas; preload + electron.d.ts leg types; core build & sync.
2. Transactions row: unchanged (no new type); `amount_usd/lbp` stay the price; profit stamp unchanged (fee not stamped).
3. IN/OUT badge: unchanged types.
4. Payment legs: fee only on IN legs, refused on OUT; OUT loop untouched.
5. Drawers: fee to the method's drawer (`paymentMethodToDrawerName`), never General.
6. Client propagation: unchanged.
7. CUSTOMER_ACCOUNT: fee refused on account legs.
8. Supplier/partner ledger: none.
9. Void: generic path reverses fee; refund keeps it (spec FR-008).
10. Profits: PM_FEE source extended; view agreement kept.
11. Sessions: excluded in phase 1 (basket has no lines on POS add-to-session; recharge session-cart branch has no legs).
12. Audit viewer: leg shows full amount received; refund modal subtracts fee.
13. E2E guard: lira-web-103 (delta + identity).
14–16: no counterparty obligation; reconcileLegs sees price-only amounts; back-timed resolution untouched (drawer delta still posted through the same helpers).

## Project Structure (files touched)

```text
packages/core/src/db/migrations/index.ts              v233
electron-app/create_db.sql                            payments.fee_amount
packages/core/src/utils/legFee.ts                     NEW leaf: eligibility, caps, priceOnlyLegRow
packages/core/src/browser.ts, index.ts                export legFee
packages/core/src/validators/sale.ts                  salePaymentLegSchema.fee_amount + refine
packages/core/src/validators/recharge.ts              payments[].feeAmount + refine
packages/core/src/validators/debt.ts                  repaymentPaymentLineSchema.feeAmount + refine
packages/core/src/repositories/moneyPosting.ts        insertPaymentRow feeAmount; assertLegFeesAllowed
packages/core/src/repositories/SalesRepository.ts     post fee; _itemRefundLegRows price-only
packages/core/src/repositories/RechargeRepository.ts  post fee
packages/core/src/repositories/DebtRepository.ts      post fee
packages/core/src/repositories/TransactionRepository.ts  _reversePayments, overridableNetByCurrency, paymentRowsToLegs, getPaymentsByTransactionId, attached leg fee_amount
packages/core/src/repositories/ProfitRepository.ts    legFee fragment in PM_FEE totals/detail/by date/by user/by client/by method
packages/core/src/services/ProfitService.ts           summary pm_fee_by_method, drill-down rows
electron-app/preload.ts, frontend/src/types/electron.d.ts   leg fee fields
packages/ui/src/components/ui/MultiPaymentInput.tsx   lineFees mode
frontend/src/utils/paymentUtils.ts                    toSnakeLegs/toCamelLegs carry fee
frontend/src/features/sales/pages/POS/components/CheckoutModal.tsx  allowLineFees (POS only)
frontend/src/features/recharge/components/PaymentSheet.tsx + TelecomForm.tsx  opt-in
frontend/src/features/debts/pages/Debts/index.tsx     repay mode
frontend/src/features/audit/refundLegOverride.ts      net minus fee
frontend/src/features/profits/pages/Profits.tsx       by-method on PM fee card
frontend/tests/e2e-web/lira-web-103-payment-method-fee.spec.ts
docs/release-notes/UNRELEASED.md, frontend/public/whats-new/1.35.0/payment-method-fee.png
current_sprint.md
```

## Complexity Tracking

| Choice | Why | Simpler alternative rejected |
| --- | --- | --- |
| Fee inside `payments.amount` + `fee_amount` part | drawer rebuilds/expectations sum `payments.amount` | amount = price only → `ClosingRepository` rebuild drops fees |
| Fold into PM_FEE profit line | one "Payment Method Fees" line on the page | a second identically named line |
