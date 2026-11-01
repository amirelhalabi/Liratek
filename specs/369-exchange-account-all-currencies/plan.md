# Implementation Plan: Exchange — customer account both ways, payment window for every currency

**Branch**: `369-exchange-account-all-currencies` (work on `main`; ticket LIRA-369) | **Date**: 2026-11-01 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/369-exchange-account-all-currencies/spec.md`

## Summary

- **Window**: the Exchange payment window opens for every walk-in exchange (`canSplitPayout = !forPartner`). For Partner keeps its direct save.
- **Two payout modes**:
  - **USD/LBP target**: as today, plus Customer account.
  - **Native target (EUR…)**: Cash in that currency plus Customer account only. Reconciled natively, with no keep/round/added change.
- **Payout to account**: one `CREDIT_DEPOSIT` per currency, linked to the exchange (`DebtService.addCreditOrThrow`). `_cancelDebt` already reverses it.
- **Customer side**: the account is offered for every currency. The USD/LBP-only refine is lifted for account lines (forgive/discount stays USD/LBP). `bookCustomerLegs` already folds one non-USD currency into USD.
- **Conversion**: a non-USD/LBP account line converts at a typed rate ("1 EUR = X USD") sent as `customer_account_usd_rate` / `payout_account_usd_rate`. The result is a fixed USD amount. The note keeps "40 EUR @ 1.10 = $44".
- **Lots (option A)**: only physically moved quantity is acquired or consumed. The rate box starts at the exchange's own rate; a different typed rate changes the exchange's margin by `±q·(t − r)`.
- **Margin timing (option A, "all waits")**: the exchange's margin counts only once no `'Exchange Debt'` on it is still owed. This reuses `notDebtPending` in `ProfitRepository`, so existing USD/LBP account exchanges get it too.
- **Rate box**: `MultiPaymentInput` gets a currency-pair prop. The USD↔LBP box is unchanged.

Decisions: [research.md](research.md). Data: [data-model.md](data-model.md). Contract: [contracts/write-payloads.md](contracts/write-payloads.md).

## Technical Context

- **Language/Version**: TypeScript strict (Node 22 / Electron 31 / React 19)
- **Primary Dependencies**:
  - `@liratek/core`: `validators/exchange.ts`, `ExchangeRepository`, `moneyPosting.ts`, `DebtService`
  - `@liratek/ui`: `MultiPaymentInput`
  - Frontend: `PaymentSheet` and the Exchange page
  - IPC and REST share `exchangeSubmitSchema`.
- **Storage**: SQLite. **No migration.**
- **Testing**:
  - core jest (Node ABI);
  - frontend/ui jest, affected files only;
  - one web e2e;
  - no Electron on this Mac;
  - ask the owner before running any suite.
- **Target Platform**: desktop app and multi-tenant web app.
- **Project Type**: Electron + web monorepo.
- **Performance Goals**: n/a.
- **Constraints**:
  - USD/LBP exchanges behave exactly as today, apart from the new payout account option (FR-012).
  - Converted amounts are fixed USD and never recalculated (FR-014).
- **Scale/Scope**: 1 validator, 2 core files (`ExchangeRepository`, `moneyPosting`), 1 shared UI component, 1 page, preload type, ui api types.

## Constitution Check

| Principle | Status |
|---|---|
| I. One core, two transports | ✅ One schema change used by IPC and REST. One payload builder (`handleProcess`). Web e2e proves it. |
| I. Rule 27 | ✅ No clock use. The rate is supplied by the client. |
| I. Rule 29 | ✅ The new refines live in `validators/exchange.ts` (leaf). `reconcileNativeLegs` is server-only (`repositories/moneyPosting.ts`). |
| II. Layers | ✅ SQL stays in repositories (`DebtRepository.addCredit`). Handlers and routes unchanged. |
| III. Contracts once | ✅ The two rate keys are defined once. Rule 23 three-way diff (schema / preload / `CreateExchangeData`) is a task. `ApiAdapter` type is derived (rule 21). |
| IV. Money integrity | ✅ §13 walked: client propagation already present (LIRA-321). Account debt via `bookCustomerLegs`, credit via `addCreditOrThrow`. Reversal owners: `_cancelDebt` (`'Exchange Debt'`, `CREDIT_DEPOSIT`) and `_reverseExchangeLotEffects`. One predicate decides which payout legs count (§13 item 15). No OUT legs iterated (rule 16). |
| V. Data/security | ✅ No new table. `?` placeholders. Tenant id via the existing writers. |
| VI. Testing | ✅ Failing-first guards (rule 17). Create + void = 0 per currency across drawers, debt ledger, lots and profit (rule 20). Variant table across USD/LBP/native × customer/payout × cash/account/split (rule 28d). Schema-derived names (rule 24). |
| VII. Code quality | ✅ No `any`. Stable `useApi` mocks. |
| Delivery | ✅ Release note plus a What's new card with a real screenshot (new window for EUR, new rate box). |

Gate: **pass**. Owner confirmed the R5 seed (exchange rate) and margin timing A on 2026-11-01.  A released margin shows under the exchange's own date (R6b).

## Project Structure

### Documentation

```text
specs/369-exchange-account-all-currencies/
├── spec.md · plan.md · research.md · data-model.md · quickstart.md
├── contracts/write-payloads.md
├── checklists/requirements.md
└── tasks.md   # /speckit-tasks
```

### Source Code

```text
packages/core/src/
├── validators/exchange.ts                 # lift account half of exchangeCustomerCanOwe; native-mode refine; 2 rate keys; clientId for any account line
├── repositories/moneyPosting.ts           # reconcileNativeLegs + one "counts toward payout" predicate
├── repositories/ExchangeRepository.ts     # measure legs before lot effects; physical lot qty; payout account → addCreditOrThrow; native reconcile; typed-rate gap into margin; note + details snapshot; drop stale guards (:901, :916)
├── repositories/ProfitRepository.ts       # exchange arm gated by notDebtPending (totals, drill-down, by-user, pending)
└── repositories/__tests__/ExchangeRepository.lira369.test.ts (+ validator test)
packages/ui/src/
├── components/ui/MultiPaymentInput.tsx    # rate box currency-pair prop ("1 EUR = … USD"); USD/LBP default unchanged
└── api/types.ts                           # derived payload type
frontend/src/
├── features/exchange/pages/Exchange/index.tsx   # window for all walk-in; methods per mode; account rate state + seed; loss confirm on sheet path; payload keys
├── features/recharge/components/PaymentSheet.tsx # pass the rate-pair prop through
└── features/exchange/pages/Exchange/__tests__/Exchange.lira369.test.tsx
electron-app/preload.ts                     # exchange payload type: new keys
frontend/tests/e2e-web/lira-web-0NN-exchange-account.spec.ts
docs/release-notes/UNRELEASED.md (+ What's new card, frontend/public/whats-new/<next>/)
docs/FEATURE_GUIDE.md §5                     # Exchange: account both ways, conversion snapshot
```

**Structure Decision**: existing monorepo layout. No new modules.

## Build order

1. **Core guards first**, failing on today's code:
   - validator test;
   - repository scenarios (US2, US3, edge cases);
   - create + void = 0.
2. Core:
   - schema;
   - `reconcileNativeLegs`;
   - reorder measurement ahead of lot effects;
   - payout account credit;
   - typed-rate gap folded into the margin;
   - Profits gate (`notDebtPending` on the exchange arm), failing-first;
   - snapshot.
3. UI: `MultiPaymentInput` rate-pair prop, with a failing test first.
4. Exchange page: window gate, methods, rate seed, loss confirm, payload. Then the page test.
5. Transport plumbing: preload type, derived `ApiAdapter` type.
6. Web e2e, release note, What's new screenshot, FEATURE_GUIDE §5.

## Complexity Tracking

None. No constitution violations.
