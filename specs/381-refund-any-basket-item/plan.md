# Implementation Plan: Refund any item of a customer-session basket

**Branch**: `381-refund-any-basket-item` (work on `main`, ticket LIRA-381) | **Date**: 2026-11-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/381-refund-any-basket-item/spec.md`

## Summary

"Refund item" on a checked-out session basket (LIRA-232) is opened to every live basket member. The whitelist (`SESSION_ITEM_REFUNDABLE_TYPES`) and the netted-payout refusal (`_assertNoNettedPayoutMembers`) go away; one pure core predicate (`isSessionItemRefundableMember`) decides which rows are items (everything except the basket-level siblings KEPT_CHANGE / WAIVED_SHORTFALL / EXTRA_CHARGE / BASKET_DISCOUNT and reversal rows), shared by the planner and the Transactions page.

Each member is reversed by its existing reversal owner (`_applyGenericItemReversal` + the member's own `_reversePayments`), and the planner now runs the same up-front refusals the whole-transaction refund runs (settled loto ticket/prize, settled supplier sibling, sold exchange lot). Money direction follows the member's customer-side sign (`customer_session_transactions.amount_*`):

- **to_customer** (charge): today's flow — account first, then the remainder through the refund window. In a basket that contained a netted payout the remainder is handed back in the item's own currency, capped per currency by the basket's gross charge minus earlier item refunds (instead of the netted cash pool).
- **from_customer** (payout): no account-first step; the customer's lines (cash, wallet or the customer's account) are measured and written by the existing "Customer pays" writer (`measureCustomerLegs` / `writeCustomerLegs`), with account lines booked as `Session Refund Debt`.

The whole-basket reversal and the "fully refunded" check learn one shared per-currency residual so create + item refunds + whole-basket refund nets to 0 even when the pool was netted. No schema change on the wire: `refundLegs` carries the customer's lines on a from_customer refund; the server derives the direction. The preview gains `direction` and `paidOnItsOwn` (output only).

## Technical Context

**Language/Version**: TypeScript 5 (strict), React 19, Node 20

**Primary Dependencies**: `@liratek/core` (TransactionRepository, moneyPosting, validators), `@liratek/ui` (`CounterpartySettleModal`, `MultiPaymentInput` — existing props only), react-i18next

**Storage**: SQLite (better-sqlite3 / SQLCipher). No migration: new keys live in `transactions.metadata_json`; one new `debt_ledger.transaction_type` value (`Session Refund Debt`).

**Testing**: core jest on the real schema (`testHelpers/debtItemDb` + `postingAssert`), frontend jest, Playwright web e2e (`node scripts/run-e2e.mjs web`)

**Target Platform**: Electron desktop and web (same core, IPC + REST)

**Project Type**: desktop + web app, monorepo

**Performance Goals**: preview stays a handful of single-session queries; `getRecent` unchanged

**Constraints**: the no-payout path stays byte-identical (≈80 LIRA-232 tests stay green); files owned by LIRA-380/382 are not edited

**Scale/Scope**: core repository + one leaf constant module, transaction-type constants, frontend audit page (cells, hook, modal), i18n en/ar, one web e2e + screenshot

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                   | Status                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. One core, two transports | PASS — IPC `transactions:refund-session-basket-item` / REST `POST /session-basket/:id/items/refund` already exist and forward the schema output to the same service; preview is passed through verbatim. Web proven by e2e 096. Leaf predicate exported from `browser.ts` (rule 29: no Node import).                                                                                                        |
| II. Layer boundaries        | PASS — all SQL stays in TransactionRepository; no handler/route logic added.                                                                                                                                                                                                                                                                                                                                |
| III. Contracts defined once | PASS — no input key added (rule 23 diff: schema / preload / handler keys unchanged). `direction` is derived, never accepted. Member rule defined once (`isSessionItemRefundableMember`) and read by the frontend (rule 14).                                                                                                                                                                                 |
| IV. Money integrity         | PASS with design — every member keeps its existing reversal owner (rule 20); the new account row `Session Refund Debt` is classified in `MODULE_DEBT_TRANSACTION_TYPES`; the whole-basket reversal residual makes create + item + whole refund net 0 per ledger per currency; from_customer posts IN lines only through the shared customer-pays writer (rule 16). FEATURE_GUIDE §13 walked in research.md. |
| V. Data and security        | PASS — `?` placeholders, `tenant_id` on every statement, admin-only gate unchanged.                                                                                                                                                                                                                                                                                                                         |
| VI. Testing                 | PASS — table-driven guard written first and run on unfixed code (failures recorded in tasks.md); rule-24 rewrites of tests whose premise was "payouts refused"; e2e by identity + drawer delta.                                                                                                                                                                                                             |
| VII. Code quality           | PASS — no `any`; hook reads `api` through its ref.                                                                                                                                                                                                                                                                                                                                                          |

Post-design re-check: unchanged, PASS.

## Project Structure

### Documentation (this feature)

```text
specs/381-refund-any-basket-item/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/session-item-refund.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/core/src/
├── constants/sessionPayoutMember.ts        # + isSessionItemRefundableMember, sessionItemRefundDirection (leaf)
├── constants/transactionTypes.ts           # SESSION_ITEM_REFUNDABLE_TYPES removed; SESSION_REFUND_DEBT_TYPE classified
├── repositories/TransactionRepository.ts   # planner, refundSessionBasketItem, pooled-reversal residual, fully-refunded
└── repositories/__tests__/lira381.refundAnyBasketItem.test.ts   # table-driven guard (new)

frontend/src/features/audit/
├── components/TransactionCells.tsx         # Refund item on every live member; hideRefundItem dropped
├── components/RefundMethodModal.tsx        # direction prop (labels, no kept/added change)
├── hooks/useSessionItemRefund.ts           # direction from preview; skip modal for swap / paid-on-its-own
└── pages/TransactionsViewer.tsx            # wiring (methods incl. customer account for from_customer)

frontend/src/locales/{en,ar}/audit.json      # new strings
frontend/tests/e2e-web/lira-web-096-refund-basket-item.spec.ts
frontend/public/whats-new/1.35.0/refund-basket-item.png
```

**Structure Decision**: existing monorepo layout; no new module, no new transport surface.

## Complexity Tracking

None.
