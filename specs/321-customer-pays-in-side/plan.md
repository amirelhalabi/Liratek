# Implementation Plan: "Customer pays" becomes the money-in side of payout screens

**Branch**: `321-customer-pays-in-side` (work on `main`, ticket LIRA-321) | **Date**: 2026-10-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/321-customer-pays-in-side/spec.md`

## Summary

On payout screens (Exchange, Whish App / OMT App receive, Binance cash-out) the payment box's existing "Customer pays" section becomes the whole money-in side: pre-filled with what the customer owes (main amount, plus the fee as a second line when paid separately), single or split like "Shop pays", shown **above** "Shop pays", and balanced on save, with a shortfall going on the client's account or forgiven within $5 / 450,000 LBP. The UI work extracts a `SplitToggle` and a `useLinesSection` hook from `MultiPaymentInput` so both sections share the button and the IN side gets real single/split. The server gets one new sibling array, `customerPayments[]`, booked by one new helper, `bookCustomerLegs`, which posts each line to its drawer or wallet and books the shortfall as `'Exchange Debt'` (new, generic reversal) or `'Service Debt'` (existing). Exchange gains `client_id` (migration v215). Old payloads book exactly as today. Whish ↓ system receive is unchanged (owner decision). Details: [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md).

## Technical Context

**Language/Version**: TypeScript (strict), Node 22 / Electron 31, React 19

**Primary Dependencies**: `@liratek/core` (repositories, services, Zod validators, `moneyPosting`), `@liratek/ui` (MultiPaymentInput, PaymentSheet pass-through), Express backend, Electron IPC, offline sync bindings

**Storage**: SQLite (SQLCipher desktop, Litestream web) — migration v215 + `create_db.sql`

**Testing**: core jest (in-memory DB, ledger deltas), frontend jest (RTL), backend jest, web e2e (Playwright). Desktop e2e not run on the owner's Mac.

**Target Platform**: desktop app and the multi-tenant web app

**Project Type**: monorepo — desktop + web off one core

**Performance Goals**: no measurable change (a few payment rows per transaction instead of one)

**Constraints**: offline replay and old clients keep working (new fields optional, old path kept); both transports identical; create + refund nets to 0 per ledger per currency; order change is visual only (FR-019)

**Scale/Scope**: 1 shared UI component (+2 extracted pieces), 3 pages (Exchange, app-transfer form, Recharge/Crypto), 2 schemas families, 2 repositories, 1 posting helper, 1 migration

## Constitution Check

*GATE: checked before Phase 0 and again after Phase 1.*

| Principle | How this plan meets it | Status |
| --- | --- | --- |
| I. One core, two transports | `customerPayments` and `clientId` added to the core schemas used by IPC, REST and offline binding; payload built once per page; pages use `useApi()`; `bookCustomerLegs` lives in `moneyPosting.ts` (not reachable from `browser.ts`; UI only imports `isWithinShortfallMax`, already browser-safe). | Pass |
| II. Layer boundaries | All SQL in `ExchangeRepository`, `FinancialServiceRepository`, `moneyPosting`; `ExchangeService` only forwards. | Pass |
| III. Contracts once | One `customerLegSchema` fragment spread into three schemas; adapter types stay `z.input`; rule-23 three-way key diff on `exchange:add-transaction` (preload type is hand-written) and on the financial channel before wiring. | Pass |
| IV. Money integrity | FEATURE_GUIDE §13 per screen; customer lines are IN legs only, payout/change legs untouched (rule 16); `client_id` UI → IPC/REST → repo → `createTransaction` (rule 11); reversal owners: generic `_reversePayments` + `_cancelDebt` (`'Exchange Debt'` whitelisted, `'Service Debt'` already), LIRA-310 path for forgiven rows; create + refund = 0 tests per case (rule 20). Debts are side effects, not sibling transactions, so rule 26 (`is_auto`) does not apply. | Pass |
| V. Data & security | `?` placeholders; `tenant_id` on the new index and queries; v215 in both files with `down()`; same roles (admin, staff) on both transports. | Pass |
| VI. Testing | Guards written first and seen failing per phase; e2e by identity + deltas; payload names from schemas; counts confirmed. New web e2e for app-wallet/Binance receive (none exists). | Pass |
| VII. Code quality | Strict TS, module loggers, named exports; `useApi` read through a ref where it enters a dependency array. | Pass |

Re-check after design: no violations; no Complexity Tracking entries.

## Project Structure

### Documentation (this feature)

```text
specs/321-customer-pays-in-side/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── payment-box.md
│   └── write-payloads.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/ui/src/components/ui/
├── MultiPaymentInput.tsx        # counterFlow v2: seedLines, lockCurrency, maxForgive, onStateChange; IN above OUT; payout labels
├── SplitToggle.tsx              # extracted split-toggle button (new)
└── useLinesSection.ts           # split flag, leftover, balance state (new)
frontend/src/features/recharge/components/PaymentSheet.tsx      # counterFlow pass-through + confirmDisabled prop
packages/core/src/
├── db/migrations/index.ts       # v215 exchange_transactions.client_id
├── validators/{exchange,financial}.ts + shared customerLegSchema
├── constants/transactionTypes.ts            # 'Exchange Debt' in MODULE_DEBT_TRANSACTION_TYPES
├── repositories/moneyPosting.ts             # bookCustomerLegs; bookFeeCollectionLegs delegates
├── repositories/ExchangeRepository.ts       # client_id, customer lines replace the lump
├── repositories/FinancialServiceRepository.ts  # app/Binance RECEIVE inflow from customer lines
└── offline/bindings/{exchange,financial}.ts    # pass-through check
electron-app/create_db.sql   electron-app/preload.ts   electron-app/handlers/exchangeHandlers.ts
backend/src/api/{exchange,services}.ts
frontend/src/
├── features/exchange/pages/Exchange/index.tsx           # client picker, counterFlow, payload
├── features/recharge/components/OmtWhishAppTransferForm.tsx
├── features/recharge/components/CryptoForm.tsx
├── features/recharge/pages/Recharge/index.tsx            # Binance payload
└── shared/components/__tests__/MultiPaymentInput.test.tsx
frontend/tests/e2e-web/lira-web-0xx-*.spec.ts            # new exchange + app-receive specs
docs/FEATURE_GUIDE.md   docs/release-notes/UNRELEASED.md   current_sprint.md
```

**Structure Decision**: existing monorepo layout; no new package. Two small files extracted inside `packages/ui` to share the split button and the line-section logic.

## Delivery phases (one PR each)

0. **Done (not committed)**: leftover line defaults to Customer Account (spec prerequisite).
1. **Foundation**: payment box (single/split IN section, seed lines, lock, overpay/balance state, forgive, IN above OUT, payout labels) + `customerLegSchema` + `bookCustomerLegs`. `bookFeeCollectionLegs` is left untouched, so old `feePayments` payloads (offline queue, FR-017) keep today's exact checks; it may delegate later only after characterization tests pin its current behaviour. `PaymentSheet` gains a `confirmDisabled` prop (Confirm is gated only by `isSubmitting` today) that pages set from `onStateChange`. Screens still send `feePayments` — no user-visible money change yet except the box.
2. **Exchange**: v215, client picker, `customerPayments` + `clientId` end to end, `'Exchange Debt'`, refunds, web e2e.
3. **Whish App receive**, then **OMT App** (transfer line only), then **Binance**: `customerPayments` replaces the single wallet row; web e2e per screen.

## Owner checks before Phase 2/3 (not blockers for Phase 1)

1. **Profit timing** (R6): a receive whose customer owes part of the transfer gets a "Service Debt", and the existing rule then waits for repayment before counting the fee profit. Likely, based on the exchange profit query having no debt check: an exchange with an "Exchange Debt" counts its profit at once. A Phase 2 test confirms this before the owner is asked whether the two should match.
2. **OMT App** takes no fee (D1, 2026-09-25): its "Customer pays" holds the transfer only. Spec updated to say so.
3. **USDT shortfall**: decided (owner, 2026-10-14) — 1 USDT = $1; short 20 USDT means the client owes $20.

## Complexity Tracking

None.
