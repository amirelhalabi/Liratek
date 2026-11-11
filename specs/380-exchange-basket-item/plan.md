# Implementation Plan: Exchange as a customer-session basket item

**Branch**: `380-exchange-basket-item` (work on `main`, no branch) | **Date**: 2026-11-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/380-exchange-basket-item/spec.md`

## Summary

With a customer session open, Confirm on the Exchange page adds a basket line
(`session_cart_items`, `ipc_channel = exchange:add-transaction`) instead of
booking. Nothing is written until the session checkout replays the line through
`ExchangeService.addDirectTransaction` in a new **deferred** mode
(`deferPayment` + `paid_in_session`, server-injected only): the exchange keeps
its own amounts and rates, consumes its lots and stamps its margin at that
moment, and books no payment lines for its USD/LBP sides — the basket's one
pooled payment carries them. One shared core rule (`utils/sessionExchangeLine.ts`)
says what an exchange line puts into the basket: the side the customer gives
is a charge, the side they receive is a payout, each in its own currency, and
the session link stores both (given +, received −).

The exchange's payout is **never netted** against the basket's charge at the
checkout rate (research R1): netting converts one currency into the other at
the session's editable rate, which is exactly the re-pricing the owner ruled
out. It goes out as its own gross `kind: "PAYOUT"`, `payoutOrigin: "GENERAL"`
leg.

## Technical Context

**Language/Version**: TypeScript 5 (strict), Node 20 / Electron 31

**Primary Dependencies**: React 19 + Vite, `@liratek/core`, `@liratek/ui` (MultiPaymentInput), Zod, better-sqlite3

**Storage**: SQLite (`session_cart_items`, `customer_session_transactions`, `transactions`, `exchange_transactions`, `exchange_lots`, `payments`, `drawer_balances`) — no migration

**Testing**: core jest (real schema via `wrongNumberDb.buildDb`), frontend jest + RTL, Playwright web e2e (`run-e2e.mjs web`)

**Target Platform**: desktop (Electron IPC) and web (REST on Fly) — both reach the same `SessionCheckoutService`

**Project Type**: Yarn monorepo (frontend, electron-app, backend, packages/core)

**Performance Goals**: N/A (one extra replay per basket line)

**Constraints**: rule 16 (no own legs in deferred mode), rule 14 (one split rule), rule 22 (one payload builder), rule 29 (the new util is a browser-safe leaf)

**Scale/Scope**: ~8 source files, 4 test files, 1 web e2e spec

## Constitution Check

| Principle | Status |
|---|---|
| I. One core, two transports | PASS — cart add and checkout already run on IPC + REST; the new replay case lives in core. The exchange payload is built once with a `mode` parameter. The new util imports nothing (rule 29). |
| II. Layer boundaries | PASS — SQL stays in `ExchangeRepository`; `SessionCheckoutService` only dispatches. |
| III. Contracts defined once | PASS — the cart line's `form_data` is the existing `ExchangeSubmitPayload` (`exchangeSubmitSchema`), re-validated at replay. `deferPayment`/`paid_in_session` are NOT schema keys (server-injected, like recharge). |
| IV. Money integrity | PASS with tests — FEATURE_GUIDE §13: no new txn type, IN/OUT unchanged, legs owned by the basket, client propagated by the checkout's injection, reversal owner = generic EXCHANGE reversal inside `refundSessionBasket`/`voidSessionBasket` (proven by a create+refund test). |
| V. Data and security | PASS — no new SQL. |

Post-design re-check: PASS (no violations; Complexity Tracking empty).

## Project Structure

### Documentation (this feature)

```text
specs/380-exchange-basket-item/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/basket-line.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/core/src/
├── utils/sessionExchangeLine.ts                 # NEW — the one charge/payout rule (browser-safe)
├── browser.ts, index.ts                         # export it
├── repositories/ExchangeRepository.ts           # deferred mode in createTransaction
└── services/SessionCheckoutService.ts           # case "exchange:add-transaction", two-sided link, booked profit

frontend/src/features/
├── exchange/pages/Exchange/index.tsx            # session mode → addToCart (no PaymentSheet)
├── exchange/utils/exchangeBasketLine.ts         # NEW — one payload builder (+ label)
├── sessions/types/cart.ts                       # CartModule "exchange"
├── sessions/utils/binanceCart.ts                # splitBasketCashSides reads the core rule
├── sessions/components/SessionCheckoutModal.tsx # gross exchange payout legs + module label
├── sessions/components/SessionFloatingWindow.tsx# icon
└── sessions/context/SessionContext.tsx          # getCartTotals reads the core rule

frontend/tests/e2e-web/lira-web-097-exchange-basket-line.spec.ts   # NEW
frontend/public/whats-new/1.35.0/exchange-basket-line.png          # NEW screenshot
```

**Structure Decision**: existing monorepo layout; no new package.

## Complexity Tracking

None.
