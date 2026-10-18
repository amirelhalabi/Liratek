# Implementation Plan: Round-up overpays

**Branch**: `334-round-up-overpays` (work on `main`; ticket LIRA-334) | **Date**: 2026-10-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/334-round-up-overpays/spec.md`

## Summary

**Payouts.** When the cashier pays out more than is owed, within $5 / 450,000 LBP, the payout is accepted. The difference is booked as the existing automatic "Change rounding" expense: books-only, hidden by default, voided with the payout.

This needs four pieces:

- one new optional wire pair, `rounding_given_usd` / `rounding_given_lbp`, on the five payout schemas;
- one resolver, `resolveRoundingGiven`;
- one writer, `bookPayoutRoundingExpense`;
- an opt-in MultiPaymentInput prop, `onRoundUpChange`, wired into seven payout screens.

**Customer pays.** An overpay within the same cap fills in "+ Extra" automatically, through one pure helper used by both MultiPaymentInput and CheckoutModal.

## Technical Context

**Language/Version**: TypeScript 5 (strict), Node 22

**Primary Dependencies**: React 19, Zod, better-sqlite3 / SQLCipher, Express (backend), Electron 31

**Storage**: SQLite. No migration: the existing `expenses` and `transactions` rows are reused.

**Testing**: jest (core, frontend, ui). Affected files only. Web e2e is optional (see Constitution VI note).

**Target Platform**: Electron desktop and the web app (Vercel + Fly)

**Project Type**: monorepo desktop + web app

**Performance Goals**: n/a (one extra row per round-up)

**Constraints**: offline replay. The new fields are optional with no default.

**Scale/Scope**: 5 schemas, 5 repositories (FSR, Exchange, Recharge ×2 paths, HoldMoney), 1 helper module, MPI plus 8 screens

## Constitution Check

| Principle | Status |
| --- | --- |
| I. One core, two transports | PASS: schema-only change on existing shared channels. IPC handlers and REST routes already pass the parsed body through (research R2). Payloads are built once per page, and OMT/Whish App goes through the core `buildWalletTransferPayload`. |
| II. Layer boundaries | PASS: all validation and booking are in repositories. |
| III. Contracts once | PASS: fields are added to the core validators only. Adapters are `z.input`. `TopUpFromClientInput` is `z.infer`; the optional field behaves the same. |
| IV. Money integrity | PASS: reversal owner named for every flow (R5). `is_auto` is derived at `createExpense`. OUT legs are refused on payouts. |
| V. Data/security | PASS: no new SQL except the parameterized `voidLinkedExpenses` wrapper, which already has tenant-scoped SQL inside the cascade. |
| VI. Testing | PASS with a note: guard tests are written first and seen failing. Web parity is proven by the web e2e spec in T039. |
| VII. Quality | PASS |

Re-checked after Phase 1 design: no change.

## Project Structure

### Documentation (this feature)

```text
specs/334-round-up-overpays/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/payout-rounding.md
└── tasks.md
```

### Source Code

```text
packages/core/src/
├── validators/{financial,exchange,recharge,holdMoney,common}.ts   # fields + messages
├── repositories/roundingGiven.ts                                  # NEW resolver
├── repositories/changeRoundingExpense.ts                          # + bookPayoutRoundingExpense
├── repositories/moneyPosting.ts                                   # postPayoutLegs roundingGiven
├── repositories/{FinancialService,Exchange,Recharge,HoldMoney}Repository.ts
├── repositories/TransactionRepository.ts                          # voidLinkedExpenses wrapper
└── utils/walletTransfer.ts                                        # builder input
packages/ui/src/components/ui/
├── MultiPaymentInput.tsx       # onRoundUpChange + built-in extra autofill
├── roundUpExtra.ts             # NEW pure helper
├── TopUpModal.tsx
└── i18n/locales/{en,ar}/payment.json, ui.json
frontend/src/features/
├── services/pages/Services/index.tsx
├── recharge/{pages/Recharge/index.tsx, components/{CryptoForm,OmtWhishAppTransferForm,TelecomForm,PaymentSheet}.tsx}
├── exchange/pages/Exchange/index.tsx
├── custom-services/components/HoldMoneyPickupSheet.tsx
└── sales/pages/POS/components/CheckoutModal.tsx
docs/FEATURE_GUIDE.md, docs/POSTING_MAP.md, docs/release-notes/UNRELEASED.md, current_sprint.md
```

**Structure Decision**: existing monorepo layout. There are no new packages.

## Complexity Tracking

None.
