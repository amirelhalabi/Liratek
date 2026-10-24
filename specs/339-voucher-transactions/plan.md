# Implementation Plan: Voucher transactions

**Branch**: `main` (in place) | **Date**: 2026-10-24 | **Spec**: [spec.md](./spec.md)
**Ticket**: LIRA-339

## Summary

Selling a voucher becomes a money flow. It works like Hold Money's drop-off, the closest precedent: a liability that is paid in through payment legs and has profit 0.

- `VoucherRepository.sellVoucher` inserts the voucher, a `VOUCHER_SALE` transaction and its payment legs, all in one `db.transaction()`.
- `VoucherRepository.cancelWithRefund` flips the voucher from pending to cancelled with a guarded UPDATE. It then pays back what the `VOUCHER_SALE` actually took in, through payout legs, and writes a `VOUCHER_CANCEL` row.
- Both types are module-owned and are gated in `NON_REVERSIBLE_TRANSACTION_TYPES`. They are kept out of profit/revenue.
- A new `paid_via_voucher` tag, defined once in core (`constants/paidViaVoucher.ts` plus one SQL fragment), drives a new **Vouchers** Type-filter group.
- Session-checkout redemptions get detected going forward through the new column `vouchers.redeemed_session_id` (migration v224).

## Technical Context

**Language/Version**: TypeScript 5 (strict), Node 20 / Electron 31
**Primary Dependencies**: better-sqlite3 (SQLCipher), zod, React 19, TanStack Query, Express (backend)
**Storage**: SQLite. The migration is v224: the last entry in `packages/core/src/db/migrations/index.ts` is v223 (verified 2026-10-24).
**Testing**: core jest (affected paths only), frontend jest (affected paths only), Playwright web e2e. Desktop e2e is NOT run on this Mac (owner rule). The desktop path is covered by core jest plus a handler unit test.
**Target Platform**: Electron desktop (IPC) and the multi-tenant web app (REST on Fly, UTC)
**Project Type**: Monorepo: `packages/core`, `electron-app`, `backend`, `frontend`, `packages/ui`
**Constraints**: CLAUDE.md rules 10–31. Phases run TESTS FIRST (rule 17).

## Constitution Check

| Principle | How this plan complies |
|---|---|
| I. One core, two transports (rule 19) | The new service methods sit in core. The IPC `voucher:create`/`voucher:cancel` handlers and the REST `POST /api/vouchers` and `POST /api/vouchers/:id/cancel` routes share the core schemas. There is one adapter path through `ipcOrHttp`. |
| II. Layers (rule 13) | All SQL lives in `VoucherRepository` and `TransactionRepository`. `VoucherService` only validates and orchestrates. The `getClientRepository()` lookup stays where it already is. |
| III. Contracts once (rules 14, 21–24) | `voucherCreateSchema` is extended and a new `voucherCancelSchema` is added in `validators/voucher.ts`. Adapter payloads use `z.input`. There is one payload builder per operation. A three-way key diff (rule 23) is a task. The "paid with a voucher" predicate is ONE SQL fragment, which is reused by `restoreRedeemedByTransaction` too. |
| IV. Money integrity (rules 16, 18, 20, 26) | IN legs and OUT change go through ONE posting loop. `reconcileLegs` checks the legs against the face value. The reversal owner is the module (`cancelWithRefund`), and both types are gated as non-reversible. The new 'Voucher Debt' charge joins `MODULE_DEBT_TRANSACTION_TYPES` and is reversed by cancel with the shared 'Refund Reversal' helper (decision 12). There are no auto rows, so `is_auto` does not apply. |
| V. Data/security | Cancel is admin-only on both transports. REST takes the actor from the JWT. Every query is tenant-scoped and parameterized. |
| VI. Testing (rules 17, 28d) | Guard tests are written and seen failing BEFORE the code. They include a variant table (USD/LBP voucher × cash/LBP/split/change). A web e2e covers the flow. |
| Rule 27 (where code runs) | Cancel's expiry check uses the `day` the client supplies, falling back to `clientDay()`. `requestNow()` provides timestamps. |
| Rule 29 (browser leaf) | `constants/paidViaVoucher.ts` has type-only imports and is exported from `browser.ts`. |
| Rule 30 | A line in `UNRELEASED.md`, plus a Highlights card with a real web screenshot. |

Gate result: PASS. No violations.

## Design decisions (detail in research.md)

1. **Types**: `VOUCHER_SALE` (cash IN, `source_table='vouchers'`, `source_id=voucher.id`) and `VOUCHER_CANCEL` (cash OUT, same source). Both have profit 0. Both are added to `NON_REVERSIBLE_TRANSACTION_TYPES`, with a reason in `frontend/src/features/audit/nonReversibleReasons.ts` that points to the Vouchers page. Both are kept out of `ProfitRepository`'s `PROFIT_TXN_TYPES`.
2. **Sale tender** (owner 2026-10-24: account allowed): drawer methods AND `CUSTOMER_ACCOUNT`. The repository refuses `GIFT_CARD`, and refuses `kept_change`, `added_change` and `rounding_given`. `reconcileLegs` runs over all IN legs, account legs included (the moneyPosting S2 invariant counts them), against `currency==='LBP' ? {usd:0,lbp:amount} : {usd:amount,lbp:0}`. One loop posts the legs:
   - each drawer leg (`isDrawerAffectingMethod`) writes `insertPaymentRow` + `applyDrawerDelta`, and OUT change legs are negative (rule 16)
   - the `CUSTOMER_ACCOUNT` legs are summed per currency and booked ONCE per currency with `bookClientDebtCharge(db, {transactionType: 'Voucher Debt', clientId: voucher.client_id, transactionId: saleTxnId, ...})`. The literal stays at the call site for the guard.

   No `payments` row is written for an account leg (NON_DRAWER_METHODS). An account leg needs the owner to have a name and phone: the UI gates with `canChargeToCustomerAccount`, and the repository also refuses when the owner has no phone. Without legs it falls back to one CASH leg in the voucher's currency, the same as Hold Money. That keeps old callers working.
3. **Refund, leg by leg** (owner 2026-10-24). `findSaleTotals(voucherId)` returns, for the ACTIVE `VOUCHER_SALE` row (`source_table='vouchers' AND source_id=?`, `reverses_id IS NULL`):
   - `total`: the row's amounts
   - `onAccount`: the SUM of its `debt_ledger` rows with `transaction_type='Voucher Debt'` and `transaction_id=saleTxnId`, per currency
   - `cash`: `total − onAccount`, per currency

   On cancel:
   - (a) If there is no sale row (a legacy voucher): no money moves, any legs are refused, and a 0-amount `VOUCHER_CANCEL` row is written with `metadata.legacy=true` (owner-confirmed).
   - (b) The on-account part is reversed ledger-only. For each 'Voucher Debt' row of the sale, insert the SAME 'Refund Reversal' shape the generic `_cancelDebt` uses: negated amounts, `transaction_id` = the SALE id, so the pair nets on one link. Use one shared helper, `insertDebtRefundReversal` in the new `repositories/debtReversal.ts`, which `_cancelDebt` is refactored to call (rule 14). The reversal always takes the FULL on-account amount, whether or not it was repaid. A repaid part therefore becomes account credit, the same as every other refund of an on-account charge. Coverage (`covered_*`) is left as it is, the same as `_cancelDebt`.
   - (c) The cash part is paid out through the operator's payout legs (drawer methods only, no `direction`, each one debits its drawer). The legs must reconcile against `cash` at the stamped rate, and none are allowed when `cash` is 0.

   The `VOUCHER_CANCEL` row's amounts = `total`. Its `metadata_json` records `{refunded_cash, reversed_to_account}`.
4. **Cancel atomicity**: `UPDATE vouchers SET status='cancelled' … WHERE id=? AND status='pending' AND tenant_id=?` runs FIRST inside the transaction. If `changes !== 1`, it throws "Voucher can no longer be cancelled" before any leg is written. Expired vouchers (stored `pending`) can be cancelled. The effective-expiry check is informational only, because the refund is allowed either way.
5. **Client**: `client_id`, `client_name` and `client_phone` come from the voucher snapshot onto both rows (rule 11). The voucher owner is the buyer.
6. **paid_via_voucher**: the leaf module `constants/paidViaVoucher.ts` exports `PAID_VIA_VOUCHER_OWN_TUPLES = [{type:'VOUCHER_SALE'},{type:'VOUCHER_CANCEL'}]`. `TransactionRepository` gains:
   - `voucherLinkedSql(tenantId, params)`: `t.id IN (SELECT redeemed_transaction_id FROM vouchers WHERE tenant_id=? AND redeemed_transaction_id IS NOT NULL) OR cst.session_id IN (SELECT redeemed_session_id FROM vouchers WHERE tenant_id=? AND redeemed_session_id IS NOT NULL)`
   - `buildPaidViaVoucherCondition`
   - a `paid_via_voucher` row column
   - a branch in the typeFilters loop

   These mirror `accountLinkedSql` exactly. Because the voucher's own link columns are the source of truth, the fragment does not need the debt-ledger note match. `restoreRedeemedByTransaction`'s EXISTS clause keeps its own job (pairing with `_cancelDebt`). It is a different predicate, so rule 14 is not violated.
7. **Session link**: migration v224 runs `ALTER TABLE vouchers ADD COLUMN redeemed_session_id INTEGER` and adds an index on `(tenant_id, redeemed_session_id)`. `redeemByCode` accepts `sessionId` and stamps it. `SessionPaymentService` passes its `sessionId`. `restoreRedeemedByTransaction` also clears the column. Older rows stay undetectable by design.
8. **Labels/direction**:
   - core `utils/cashFlow.ts` `TRANSACTION_CASH_DIRECTION`: VOUCHER_SALE→in, VOUCHER_CANCEL→out
   - labels: "Voucher sold" / "Voucher cancelled" in `TRANSACTION_TYPE_LABELS` (core `utils/transactionText.ts`), `transactionPresentation.ts` and `typeTitleText.ts`
   - i18n: whatever strings those files already source (an Arabic gate test exists)
9. **Sessions**: no basket branch. A voucher is sold from the Vouchers page only (spec clarification).
10. **Not auto**: both rows are operator actions, so they are visible by default.
11. **FEATURE_GUIDE**: add a §9 bullet for the voucher lifecycle and its reversal owner, and a §3 table entry.
12. **'Voucher Debt' classification (rule 20).** It is added to `MODULE_DEBT_TRANSACTION_TYPES`, which means:
    - It inherits repayment FIFO coverage and the aging and outstanding views. `SERVICE_DEBT_COVERAGE_TYPES` and `REPAYMENT_COVERABLE_DEBT_TYPES` derive from that list.
    - The `moduleDebtTypes.guard.test.ts` scan classifies it.
    - The generic `_cancelDebt` would reverse it correctly. It is never reached, though, because `VOUCHER_SALE` is gated non-reversible.

    The effective reversal owner is `VoucherRepository.cancelWithRefund`, which writes the same 'Refund Reversal' shape through the shared helper. That is stated in the constant's comment.

    Rejected alternative: excluding it in `EXCLUDED_DEBT_TYPES`. That would stop repayments from covering it, so `covered_*` would stay 0 forever and the aging views would show it as unpaid.

    The `VOUCHER_SALE` row is account-linked (`accountLinkedSql`), so it also shows under the Debts filter. That is intended (owner 2026-10-24).
13. **Invariant (FEATURE_GUIDE §13 item 14).** One obligation, one owner: the customer's debt lives only in `debt_ledger`, and the cash lives only in the drawers. For a sale then a cancel refunded leg by leg: Σ drawer deltas = 0 and Σ debt_ledger(client) = 0, per currency.

## Project Structure (files touched)

```text
packages/core/src/
  constants/transactionTypes.ts          # +VOUCHER_SALE, VOUCHER_CANCEL, NON_REVERSIBLE entries, 'Voucher Debt' in MODULE_DEBT_TRANSACTION_TYPES
  repositories/debtReversal.ts           # NEW shared 'Refund Reversal' insert (used by _cancelDebt + cancelWithRefund)
  constants/paidViaVoucher.ts            # NEW leaf
  browser.ts, index.ts                   # export paidViaVoucher
  utils/cashFlow.ts                      # direction map
  utils/transactionText.ts               # TRANSACTION_TYPE_LABELS
  db/migrations/index.ts                 # v224
  validators/voucher.ts                  # payments/exchange_rate on create; voucherCancelSchema
  validators/transaction.ts              # paid_via_voucher on the type-filter tuple
  repositories/VoucherRepository.ts      # sellVoucher, cancelWithRefund, findSaleTotals, sessionId stamp
  repositories/TransactionRepository.ts  # voucherLinkedSql, filter + row flag; _cancelDebt calls insertDebtRefundReversal
  repositories/ProfitRepository.ts       # (assert only; types stay absent) — test file only
  services/VoucherService.ts             # createVoucher → sellVoucher; cancelVoucher(id, input, by)
  services/SessionPaymentService.ts      # pass sessionId to redeemByCode
electron-app/create_db.sql               # redeemed_session_id + index
electron-app/handlers/voucherHandlers.ts # cancel takes payload; create forwards payments
electron-app/schemas/index.ts            # re-export VoucherCancelSchema
electron-app/preload.ts                  # vouchers.create/cancel data types
backend/src/api/vouchers.ts              # create forwards payments; cancel body validated
frontend/src/api/backendApi.ts, frontend/src/api/ElectronApiAdapter.ts, packages/ui/src/api/types.ts, frontend/src/types/electron.d.ts
frontend/src/features/vouchers/pages/Vouchers/index.tsx   # payment form on create; refund picker on cancel
frontend/src/features/audit/{auditConstants.ts,transactionPresentation.ts,typeTitleText.ts,nonReversibleReasons.ts}
frontend/src/features/audit/hooks/useTransactionRows.ts
frontend/tests/e2e-web/lira-web-079-voucher-transactions.spec.ts  # NEW
docs/FEATURE_GUIDE.md, docs/release-notes/UNRELEASED.md, current_sprint.md
frontend/public/whats-new/<next version>/voucher-sale.png
```

## Complexity Tracking

None. Every mechanism reuses an existing precedent: Hold Money postings and `paid_via_account`.
