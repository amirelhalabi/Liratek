# Implementation Plan: Discount wherever a customer pays the shop

**Branch**: `365-discount-customer-pays` (work on `main`; ticket LIRA-365) | **Date**: 2026-10-31 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/365-discount-customer-pays/spec.md`. The Note part moved to LIRA-366 (`specs/366-payment-note/`).

## Summary

Discount on three money-in forms, capped at the shared `SHORTFALL_MAX` ($5 / 450,000 LBP). Every form shows the same control: the standard `DiscountLine` under "Total Amount".

- **OMT/Whish system SEND**:
  - The page turns on `MultiPaymentInput`'s Discount line and sends `discount_amount` explicitly, as Loto does.
  - The server lowers the amount it reconciles against. What is owed to OMT/Whish and the commission stay unchanged.
  - The server books a books-only, linked, `is_auto` expense "Discount given". The generic void cascade reverses it.
- **Voucher sale**:
  - Same expense.
  - The VOUCHER_SALE transaction records what was paid; the voucher keeps its face value.
  - `cancelWithRefund` refunds what was paid and voids the expense.
- **Exchange and the other customer-pays boxes** (Whish App, OMT App, Binance cash-outs):
  - The counter-flow "Forgive" button is replaced by the standard Discount line.
  - It feeds the existing `customer_waived_amount`, so booking, cap and reversal are unchanged (WAIVED_SHORTFALL sibling).

Decisions are in [research.md](research.md).

## Technical Context

- **Language/Version**: TypeScript strict (Node 22 / Electron 31 / React 19)
- **Primary Dependencies**:
  - `@liratek/core`: validators (Zod), repositories
  - `@liratek/ui`: `MultiPaymentInput`, `DiscountLine`
  - REST (`backend/`) and IPC (`electron-app/`) share the core schemas.
- **Storage**: SQLite. **No migration**:
  - The expense category is free text.
  - The discount goes in `details.discount`.
  - The voucher sale amount column already exists.
- **Testing**: core jest (Node ABI), frontend jest (affected files only), one web e2e. No Electron on this Mac.
- **Target Platform**: desktop app and multi-tenant web app.
- **Project Type**: Electron + web monorepo.
- **Performance Goals**: n/a (one extra INSERT per discounted entry).
- **Constraints**: the cap is compared in the total's own currency, never converted. Session-basket items, For Partner and RECEIVE take no new discount.
- **Scale/Scope**: 2 repositories changed (Financial, Voucher), 1 new expense helper, 1 shared UI change (counter-flow Forgive → Discount line), 3 pages.

## Constitution Check

| Principle | Status |
|---|---|
| I. One core, two transports | ✅ Keys added to the shared core schemas used by IPC and REST. One payload builder per page. Web e2e proves it. |
| I. Rule 27 | ✅ The expense date comes from the parent row, not the server clock. |
| I. Rule 29 | ✅ The cap and messages go in leaf validator modules. The expense helper is server-only (`repositories/`). |
| II. Layers | ✅ SQL only in repositories. Handlers and routes unchanged. |
| III. Contracts once | ✅ `discount_amount` defined once per schema. Refusal messages are shared constants. Adapter types derive from schemas. |
| IV. Money integrity | ✅ FEATURE_GUIDE §13 walked in tasks. Reversal owners: OMT/Whish → `_cascadeExpenseSiblingVoid`; voucher → `cancelWithRefund` + `voidLinkedExpenses`; exchange → existing WAIVED_SHORTFALL. `is_auto` derived at `createExpense`. No new leg iteration (rule 16). |
| V. Data/security | ✅ No new table; `?` placeholders; tenant_id on every statement. |
| VI. Testing | ✅ Failing-first guards (rule 17). Create + reverse nets to 0 per currency (rule 20). Variant test per money form (rule 28d). Schema-derived names (rule 24). |
| VII. Code quality | ✅ No `any`; stable `useApi` mocks. |

Gate: **pass**.

## Project Structure

### Documentation

```text
specs/365-discount-customer-pays/
├── spec.md · plan.md · research.md · data-model.md · quickstart.md
├── contracts/write-payloads.md
├── checklists/requirements.md
└── tasks.md   # /speckit-tasks
```

### Source Code

```text
packages/core/src/
├── validators/financial.ts            # discount_amount + refines (OMT/WHISH SEND only, cap, < total)
├── validators/voucher.ts              # discount_amount + refines
├── constants/…                        # DISCOUNT_GIVEN_EXPENSE_CATEGORY, refusal messages
├── repositories/discountGivenExpense.ts            # new, modelled on changeRoundingExpense.ts
├── repositories/FinancialServiceRepository.ts      # SEND reconcile, expense, details.discount
├── repositories/VoucherRepository.ts               # sell (amount = paid), expense, cancel voids it
└── repositories/ExchangeRepository.ts              # details.discount from customer_waived_amount
packages/ui/src/components/ui/MultiPaymentInput.tsx # counter-flow Forgive button → DiscountLine
packages/ui/src/i18n/locales/{en,ar}/…              # labels
frontend/src/features/
├── services/pages/Services/index.tsx               # Discount on walk-in system SEND
├── vouchers/pages/Vouchers/index.tsx               # Discount on sale
├── exchange/pages/Exchange/index.tsx               # nothing page-specific beyond the shared box
└── expenses/utils/expenseCategoryLabel.ts          # "Discount given"
frontend/tests/e2e-web/lira-web-0xx-discount.spec.ts
```

**Structure Decision**: the existing monorepo layout. Money logic goes in core repositories; pages only collect the amount.

## Delivery order

1. **OMT/Whish system SEND (US1, P1)**: core guard tests, then core, then page.
2. **Shared box: Forgive → Discount line (US2, P2)**: Exchange and the three cash-out screens at once.
3. **Voucher sale (US3, P3)**.
4. Release notes plus a What's new card with a real screenshot (rule 30).

## Existing tests this changes (rewrite, never delete — rule 24)

- `Services.sendNoDiscount.test.tsx`: becomes "discount on walk-in system SEND; none on FOR, session or RECEIVE". The comment at Services ~2645-2652 is rewritten to match.
- `Services.sendExtra` and `Services.roundUp`: turning on `showDiscount` changes the extra-only line into the −Discount/+Extra switch and shows the built-in Waive. Re-check and keep their cases.
- Tests that click `counter-flow-forgive` (Exchange, Whish App / OMT App / Binance cash-out, `MultiPaymentInput` counter-flow suites): rewritten to type into the Discount line. The booked `customer_waived_amount` stays the same.
- Variant test (rule 28d): every OMT service type, with "Fee included in amount" on and off, × walk-in, session and FOR.

## Risks

- **Vouchers**: readers of the VOUCHER_SALE amount (cash flow, client debt details, transaction text, posting rules, audit presentation) must not assume it equals the face value. A task checks each one, and a failing-first nets-to-0 test guards the cancel.
- **The Forgive → Discount change reaches four screens**: Forgive filled the whole gap in one tap. The Waive button must keep that one-tap path, or cashiers lose a shortcut.
- **"Fee included in amount"**: the discount must be below `amount`, not `amount + fee`.

## Complexity Tracking

None.
