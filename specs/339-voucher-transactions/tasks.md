# Tasks: Voucher transactions (LIRA-339)

**Input**: [spec.md](./spec.md), [plan.md](./plan.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/voucher-api.md](./contracts/voucher-api.md), [quickstart.md](./quickstart.md)

**Tests are REQUIRED and come FIRST** (CLAUDE.md rule 17). Each test task must be run against the unfixed code and its real failure recorded in the task note before the matching implementation task starts. Never revert or stash code to prove a test. Run affected test paths only: never full suites, never desktop e2e or Electron on this Mac, and ask the owner before running suites.

Format: `- [ ] Txxx [P] [USn] description (file)`. `[P]` means the task can run in parallel with other `[P]` tasks *in other lanes*, because the files do not overlap.

## Shared contract every lane codes against (fixed in Phase 1)

```ts
// VoucherService (core)
createVoucher(input: VoucherCreateInput /* + payments?, exchange_rate?, transaction_time? */, createdBy: number)
  : { success: boolean; voucher?: VoucherEntity; transactionId?: number; error?: string }
cancelVoucher(id: number, input: VoucherCancelInput /* payments?, exchange_rate?, client_day? */, cancelledBy: number)
  : { success: boolean; voucher?: VoucherEntity; transactionId?: number; refunded?: { cash: { usd: number; lbp: number }; toAccount: { usd: number; lbp: number } }; error?: string }
// VoucherEntity gains redeemed_session_id: number | null, sale_usd/sale_lbp, sale_account_usd/sale_account_lbp (T021)
// repositories/debtReversal.ts: insertDebtRefundReversal(db, {clientId, amountUsd, amountLbp, transactionId, createdBy, tenantId}) — the ONE 'Refund Reversal' insert
// getRecent rows gain paid_via_voucher: boolean; type-filter tuples accept paid_via_voucher?: boolean
```

---

## Phase 1: Setup / Foundational (Lane 0, SERIAL, one agent; blocks every other lane; also owns the e2e spec file)

- [x] T001 Add `VOUCHER_SALE` and `VOUCHER_CANCEL` to `TRANSACTION_TYPES`, each with a doc comment naming the reversal owner (`VoucherRepository.cancelWithRefund`). Add both to `NON_REVERSIBLE_TRANSACTION_TYPES` with a comment that follows the Hold Money precedent. Add `"Voucher Debt"` to `MODULE_DEBT_TRANSACTION_TYPES`, with a comment saying the generic `_cancelDebt` is unreachable for it (the sale is gated) and that the effective owner is `cancelWithRefund` (plan decision 12). Test first: in `constants/__tests__/moduleDebtTypes.guard.test.ts`, add a 'Voucher Debt' is-whitelisted case (the 'Exchange Debt' precedent). In a new `constants/__tests__/transactionTypes.voucher.test.ts`, assert both types are in `TRANSACTION_TYPES` and `NON_REVERSIBLE_TRANSACTION_TYPES`, and that `REPAYMENT_COVERABLE_DEBT_TYPES` includes 'Voucher Debt'. (packages/core/src/constants/transactionTypes.ts)
- [x] T002 Add `VOUCHER_SALE: "in"` and `VOUCHER_CANCEL: "out"` to the direction map. Add the labels "Voucher sold" and "Voucher cancelled" to `TRANSACTION_TYPE_LABELS`. (packages/core/src/utils/cashFlow.ts, packages/core/src/utils/transactionText.ts)
- [x] T003 Create the leaf module `PAID_VIA_VOUCHER_OWN_TUPLES = [{type:"VOUCHER_SALE"},{type:"VOUCHER_CANCEL"}]`, with type-only imports (rule 29). Export it from both entry points. (packages/core/src/constants/paidViaVoucher.ts, packages/core/src/browser.ts, packages/core/src/index.ts)
- [x] T004 Add migration v224 (verify that v223 is still the last entry first): `ALTER TABLE vouchers ADD COLUMN redeemed_session_id INTEGER` (nullable) and `CREATE INDEX idx_vouchers_redeemed_session ON vouchers(tenant_id, redeemed_session_id)`. Include `down()`. Mirror it in the fresh schema. Use the `add-migration` skill. (packages/core/src/db/migrations/index.ts, electron-app/create_db.sql)
- [x] T005 Schemas:
  - Add `voucherPaymentLegSchema` (method ∈ CASH | OMT | WHISH | BINANCE | CUSTOMER_ACCOUNT on create (never GIFT_CARD); the cancel schema's legs use the drawer-only subset; `currency_code` USD|LBP; `amount` number; `direction?` IN|OUT).
  - Extend `voucherCreateSchema` with `payments?`, `exchange_rate?` and `transaction_time?`.
  - Add `voucherCancelSchema {payments?, exchange_rate?, client_day? (YYYY-MM-DD)}`.
  - Export the `z.input` payload types `VoucherCreatePayload` and `VoucherCancelPayload` from both core entry points (rule 21).
  - Add `paid_via_voucher?: boolean` to the type-filter tuple schema.
  - Shared types the lanes compile against: add `paid_via_voucher?: boolean` to the filter-tuple and `paid_via_voucher: boolean` to the row type in `frontend/src/types/electron.d.ts` (next to `paid_via_account`), and `redeemed_session_id`/`sale_usd`/`sale_lbp`/`sale_account_usd`/`sale_account_lbp` to the voucher type there.
  (packages/core/src/validators/voucher.ts, packages/core/src/validators/transaction.ts, packages/core/src/validators/index.ts, frontend/src/types/electron.d.ts)
- [x] T008 Shared reversal helper, test first: `insertDebtRefundReversal` writes ONE `debt_ledger` row `transaction_type='Refund Reversal'`, negated amounts, the given `transaction_id`, note 'Debt cancelled by refund/void', `requestNow()` time, tenant-scoped; a charge plus its reversal sums to 0 per currency. Lane B (T032) refactors `_cancelDebt` to call it; Lane A's cancel calls it. (packages/core/src/repositories/debtReversal.ts, packages/core/src/repositories/__tests__/debtReversal.test.ts)
- [x] T006 Add `redeemed_session_id: number | null` to `VoucherEntity` and `VOUCHER_COLUMNS`. Build core and sync it (`cp -r packages/core/dist/. node_modules/@liratek/core/dist/`). (packages/core/src/repositories/VoucherRepository.ts, types/columns only)

- [x] T007 Write the web e2e spec `frontend/tests/e2e-web/lira-web-079-voucher-transactions.spec.ts` NOW (scenarios as in T070) and run it once against the pre-feature build: record the real failure (rule 17). Owned by Lane 0's agent; T070 only re-runs it green and adds the screenshot.

**Lane 0 result (2026-10-24)**:
- Red first: 5 new core suites ran 9 failing / 4 passing on the old code ("Cannot find module '../paidViaVoucher'", "'Voucher Debt' not in the whitelist", "latest migration is resale_line_give_backs", schema keys stripped). T007 web e2e ran red: drawer moved 0, expected +50.
- Green after: 6 suites, 23/23 passing (incl. `browserEntryIsNodeFree.guard`).
- Affected suites green: `LotoTicketRepository.legIntegrity`, `VoucherRepository.clientDay`, `VoucherRepository.requestNow`, `TransactionRepository.debtReversal`; frontend `actionGating.guard`, `walletCashout.presentation`, `cashFlow.customServicePayout`.
- `yarn typecheck` clean (~50 s) and `yarn lint` clean (0 errors). Core built and synced.
- Files Lane 0 had to touch beyond its plan, because the new types are a compile error until they are classified:
  - `frontend/src/features/audit/transactionPresentation.ts`: the presentation entries, moved here from T053
  - `mobile/src/utils/typeColors.ts`
  - the hand-rolled `vouchers` tables in `LotoTicketRepository.legIntegrity.test.ts` and `VoucherRepository.clientDay.test.ts` (+`redeemed_session_id`)

**Checkpoint**: core typechecks. Lanes A to D may start in parallel.

---

## Phase 2: US1 + US2 core money (Lane A: core voucher money)

**Lane A owns**: `packages/core/src/repositories/VoucherRepository.ts`, `packages/core/src/services/VoucherService.ts`, `packages/core/src/services/SessionPaymentService.ts`, `packages/core/src/repositories/__tests__/VoucherRepository.*.test.ts`, `packages/core/src/services/__tests__/VoucherService*.test.ts`, `packages/core/src/repositories/__tests__/ProfitRepository.voucher.test.ts`.

### Tests first (record failure on current code)
- [x] T010 [P] [US1] Sale guard. Selling a $50 USD voucher paid $60 CASH plus a $10 OUT change leg must produce:
  - exactly one `VOUCHER_SALE` row with `source_table='vouchers'`, `source_id=voucher.id`, `amount_usd=50`, profit 0/0, and the client's id, name and phone
  - payments rows +60/−10 (net +50) on the General USD drawer delta
  Mismatched legs are refused with nothing written. GIFT_CARD legs are refused. On-account case: $50 paid $20 CASH + $30 CUSTOMER_ACCOUNT gives a drawer +$20 and ONE `debt_ledger` 'Voucher Debt' row of +$30 with `transaction_id` = the sale id and the owner's client_id; no payments row for the account leg; an owner with no phone is refused for an account leg. A failure part-way rolls back the voucher row as well. (packages/core/src/repositories/__tests__/VoucherRepository.sale.test.ts)
- [x] T011 [P] [US1] Variant table (rule 28d) through the real `VoucherService.createVoucher`. Rows:
  - USD voucher paid {USD cash exact, LBP cash at the stamped rate, split CASH+WHISH, overpay with change}
  - LBP voucher paid {LBP exact, USD with LBP change}
  - no legs (fallback CASH leg in the voucher currency)
  - all on account (USD and LBP vouchers), and split cash + account
  For on-account rows, also assert the 'Voucher Debt' delta per currency.
  For each row, assert it is accepted and that the drawer deltas per currency equal the legs. (packages/core/src/services/__tests__/VoucherService.variants.test.ts)
- [x] T012 [P] [US2] Cancel guard:
  - Sell then cancel with a CASH payout in the sale's currency: each drawer nets 0 in every currency. Cross-currency case (USD voucher paid in LBP, refunded in USD cash): assert the USD-equivalent net across drawers is 0 at the stamped rates, not per-currency zero (SC-001). One `VOUCHER_CANCEL` row is written for the refund amount with profit 0. The voucher ends `cancelled`.
  - A legacy voucher (inserted with no sale row) cancels with 0 amount and no payments, and payout legs are refused.
  - A redeemed voucher is refused.
  - A second cancel is refused, and only one refund row exists.
  - An expired pending sold voucher refunds in full.
  - Payout legs that do not reconcile to the cash part are refused.
  - On-account sale ($20 cash + $30 account) then cancel with a $20 cash payout: drawer net 0 AND the owner's `debt_ledger` net 0 per currency (a 'Refund Reversal' of −$30 on the sale id); no cash leaves for the account part. Payout legs > $20 are refused.
  - All-on-account sale then cancel: no payments at all, debt net 0, any payout leg refused.
  - Partly repaid: sale $30 on account, a $20 DEBT_REPAYMENT, then cancel: the account drops $30, so the balance is −$20 (credit), and the drawer shows +$20 from the repayment only.
  (packages/core/src/repositories/__tests__/VoucherRepository.cancelRefund.test.ts)
- [x] T013 [P] [US2] Rule-20 gate: `TransactionRepository` void and refund of a `VOUCHER_SALE` (including an on-account one) or `VOUCHER_CANCEL` id return `success:false` matching `/cannot be voided/`, and the drawers AND debt_ledger are unchanged. (packages/core/src/repositories/__tests__/VoucherRepository.reversalGate.test.ts)
- [x] T014 [P] [US1] Profits: the profit summary and revenue are identical before and after a voucher sale and cancel. (packages/core/src/repositories/__tests__/ProfitRepository.voucher.test.ts)
- [x] T015 [P] [US3] Session stamp:
  - Redeeming at session checkout stamps `vouchers.redeemed_session_id = sessionId`.
  - `restoreRedeemedByTransaction` clears `redeemed_session_id` together with the other redeemed fields.
  (packages/core/src/repositories/__tests__/VoucherRepository.sessionLink.test.ts)

### Implementation
- [x] T016 [US1] `VoucherRepository.sellVoucher(data, legs, opts)` follows `HoldMoneyRepository.createHold`. Inside ONE `db.transaction()` it:
  1. inserts the voucher
  2. calls `createTransaction({type: VOUCHER_SALE, source_table:'vouchers', source_id, amount_usd|amount_lbp by currency, profit 0, exchange_rate: resolveStampedExchangeRate, client_id/name/phone, summary "Voucher sold <code>", metadata_json {code, currency_code, kind:"voucher_sale"}, payment_snapshot, transaction_time})`
  3. posts every leg in ONE loop: drawer legs go to `insertPaymentRow` + `applyDrawerDelta` (OUT → negative, "Change returned"); CUSTOMER_ACCOUNT legs are summed per currency and then booked once per currency with `bookClientDebtCharge(db, {transactionType: 'Voucher Debt', clientId, transactionId: saleTxnId, ...})` (the literal at the call site). Fallback: one CASH leg when there are no legs
  4. calls `resolveBackTimedDrawerMovement`

  Before the transaction it runs `reconcileLegs` over ALL IN legs (account included) against the face value, refuses GIFT_CARD, and refuses an account leg when the owner has no phone. (packages/core/src/repositories/VoucherRepository.ts)
- [x] T017 [US2] `VoucherRepository.cancelWithRefund(id, legs, opts)`. Inside ONE `db.transaction()`:
  1. Run the guarded `UPDATE … SET status='cancelled' … WHERE id=? AND status='pending' AND tenant_id=?`. Throw if `changes !== 1`.
  2. `findSaleTotals(voucherId)` (ONE named helper) returns `{saleTxnId, total, onAccount, cash}` per currency: `total` from the ACTIVE `VOUCHER_SALE` (`source_table='vouchers' AND source_id=?`, `reverses_id IS NULL`), `onAccount` = SUM of its 'Voucher Debt' rows (`transaction_id = saleTxnId`), `cash = total − onAccount`.
  3. With no sale row (legacy): refuse any legs and write a 0-amount `VOUCHER_CANCEL` with `metadata.legacy=true`.
  4. Otherwise:
     - for each 'Voucher Debt' row of the sale, call `insertDebtRefundReversal` (full amount, `transaction_id` = the sale id), whether or not it was repaid
     - run `reconcileLegs` with the payout legs against `cash` (no OUT legs; none allowed when `cash` is 0)
     - write `VOUCHER_CANCEL` (amounts = total, profit 0, client fields, summary "Voucher cancelled <code>", metadata `{refunded_cash, reversed_to_account}`)
     - post the payout legs as negative payments in ONE loop (fallback: one CASH leg for `cash` when `cash` > 0)

  Store the client's day in metadata (`expired_at_cancel`). (packages/core/src/repositories/VoucherRepository.ts)
- [x] T018 [US3] `redeemByCode` accepts `sessionId?: number | null` and stamps `redeemed_session_id`. `restoreRedeemedByTransaction` also sets `redeemed_session_id = NULL`. `SessionPaymentService` passes its `sessionId`. (packages/core/src/repositories/VoucherRepository.ts, packages/core/src/services/SessionPaymentService.ts)
- [x] T019 [US1][US2] `VoucherService.createVoucher` keeps its validation, then delegates to `sellVoucher` and returns `transactionId`. `cancelVoucher(id, input, cancelledBy)` delegates to `cancelWithRefund` and returns `refunded`. No SQL goes in the service (rule 13). (packages/core/src/services/VoucherService.ts)
- [x] T021 [US2] `getAll`/`getByCode` expose `sale_usd`/`sale_lbp` and `sale_account_usd`/`sale_account_lbp` (the same `findSaleTotals` fragment, never a second copy, rule 14) so the Vouchers page knows the refund amount and the legacy state; add `sale_usd`/`sale_lbp` to `VoucherEntity`. Test: extend T012 with the list-row figures. (packages/core/src/repositories/VoucherRepository.ts)
- [x] T022 [US1] Existing callers of voucher create now book a cash leg (fallback). Update every caller and fixture so its drawer expectations stay true: `packages/core/src/repositories/__tests__/VoucherRepository.clientDay.test.ts`, `VoucherRepository.requestNow.test.ts`, `SalesRepository.receiptRead.test.ts`, `backend/src/services/__tests__/VoucherService.test.ts` (Lane A owns these test files). Lane E updates `frontend/src/features/vouchers/pages/Vouchers/__tests__/Vouchers.i18n.test.tsx`; the final phase updates `frontend/tests/e2e-web/lira-web-009-vouchers.spec.ts`, `frontend/tests/e2e-electron/lira-session-allocation.spec.ts` and `frontend/tests/e2e-electron/helpers/webApiShim.ts`. Re-grep `createVoucher|vouchers.create|vouchersCreate` across packages/, backend/, scripts/ and frontend/ first.
- [x] T020 Build core and sync it, then run T010 to T015 (affected paths only). (packages/core)

**Lane A result (2026-10-24)** (T020's build/sync is left to the coordinator, as instructed):
- Red first, on the unchanged code: 6 new suites, 32 failing / 2 passing (34). Real failures: "Expected length: 1, Received length: 0" (no VOUCHER_SALE row), drawer delta `{}` instead of `{"General|USD": 50}`, old `cancelVoucher(id, by)` rejecting the input object (`success: false`), `redeemed_session_id` null (expected the session id / 77).
- Green after: the same 6 suites, 34/34. Affected neighbours also green: `VoucherRepository.clientDay`/`requestNow`, `SalesRepository.receiptRead`, `LotoTicketRepository.legIntegrity`, `moduleDebtTypes.guard`, `browserEntryIsNodeFree.guard`, `debtReversal`, `TransactionRepository.giftCardRefund`, both `SessionPaymentService.basket` suites (121/121 total). Backend `VoucherService.test.ts` 9/9.
- T013: the repository void/refund *throws* `/cannot be voided/` (the service wrapper turns that into `success:false`); the test asserts the throw, with the ledgers unchanged.
- T014 was green on the old code only because nothing was written. The row-exists preconditions make it red for the right reason.
- T022: the repository `createVoucher` stays the plain insert (no money). Only `VoucherService.createVoucher` → `sellVoucher` books the fallback CASH leg. `clientDay.test.ts` gained `transactions` in its hand-rolled schema, because the list reads now join the sale.
- `npx tsc --noEmit -p packages/core` is clean. electron-app and backend are clean against declarations emitted from the current core source; against the stale `dist` they still show the old signatures until the core build.
- `scripts/check-tenant-scoping.mjs` shows 0 violations and `check-bind-arity.mjs` is OK.

---

## Phase 3: US3 core filter (Lane B: core transactions query)

**Lane B owns**: `packages/core/src/repositories/TransactionRepository.ts`, `packages/core/src/repositories/__tests__/TransactionRepository.paidViaVoucher.test.ts`.

- [x] T030 [P] [US3] Test first. Seed:
  - a `VOUCHER_SALE` row
  - a POS sale whose id is a voucher's `redeemed_transaction_id`
  - a session basket whose session id is a voucher's `redeemed_session_id`
  - an unrelated cash sale

  Filter `typeFilters:[{type:"VOUCHER_SALE", paid_via_voucher:true}]`: it returns the first three and not the fourth. The row flag `paid_via_voucher` is true exactly on the linked rows. Own-tuple rows are not double-matched. (packages/core/src/repositories/__tests__/TransactionRepository.paidViaVoucher.test.ts)
- [x] T032 Refactor `_cancelDebt` so its 'Refund Reversal' insert calls `insertDebtRefundReversal` (rule 14), with no behaviour change. The existing `TransactionRepository.debtReversal.test.ts` must stay green. (packages/core/src/repositories/TransactionRepository.ts)
- [x] T033 [US3] Test, extending T030: an on-account `VOUCHER_SALE` also matches the Debts filter (`paid_via_account`), which is intended (owner 2026-10-24). (packages/core/src/repositories/__tests__/TransactionRepository.paidViaVoucher.test.ts)
- [x] T031 [US3] Add `voucherLinkedSql(tenantId, params)` (ONE fragment, rule 14, the same shape as `accountLinkedSql`) and `buildPaidViaVoucherCondition` (excluding `PAID_VIA_VOUCHER_OWN_TUPLES`). Wire them into the typeFilters loop and add the `paid_via_voucher` select column and row mapping. Keep param push order in SQL text order. (packages/core/src/repositories/TransactionRepository.ts)

---

## Phase 4: Transports (Lane C: IPC + REST + adapters)

**Lane C owns**: `electron-app/handlers/voucherHandlers.ts`, `electron-app/handlers/__tests__/voucherHandlers.test.ts`, `electron-app/schemas/index.ts`, `electron-app/preload.ts`, `frontend/src/types/electron.d.ts`, `backend/src/api/vouchers.ts`, `backend/src/api/__tests__/vouchers*.test.ts`, `frontend/src/api/backendApi.ts`, `frontend/src/api/ElectronApiAdapter.ts`, `packages/ui/src/api/types.ts`.

- [x] T040 [P] [US1][US2] Rule-23 three-way key diff (schema vs. preload `data` type vs. handler forwarding) for `voucher:create` and `voucher:cancel`. Record the result in the task note.
  - Result (2026-10-24): create — schema {clientId, amount, currency, expiryDate, note, payments, exchange_rate, transaction_time}; preload typed only the first 5 (now `VoucherCreatePayload`); handler forwarded only the first 5, so the 3 new keys would have been silently dropped — now forwards all 8. REST passes `req.body` whole. Cancel — schema {payments, exchange_rate, client_day}; preload and handler took none (bare id); now `cancel(id, data?: VoucherCancelPayload)`, validated and forwarded whole on both transports. No preload/handler key is missing from either schema.
- [x] T041 [P] [US1][US2] Tests first:
  - The IPC handler forwards `payments`, `exchange_rate` and `transaction_time` on create, and `payments`, `exchange_rate` and `client_day` on cancel, to the service.
  - Cancel is admin-only.
  - The REST route test checks the same, plus: the actor comes from the JWT, and a failure returns HTTP 200 with `success:false`.
  (electron-app/handlers/__tests__/voucherHandlers.test.ts, backend/src/api/__tests__/vouchers.cancel.test.ts)
- [x] T042 [US1][US2] IPC:
  - `voucher:create` forwards the new keys.
  - `voucher:cancel` becomes `(event, id, data?)` and validates with `VoucherCancelSchema`, re-exported with the zod-major cast.
  - Preload: `cancel: (id: number, data?: VoucherCancelPayload)`, and the create type comes from the schema.
  - Update `electron.d.ts` to match.
  (electron-app/handlers/voucherHandlers.ts, electron-app/schemas/index.ts, electron-app/preload.ts, frontend/src/types/electron.d.ts)
- [x] T043 [US1][US2] REST: `POST /` forwards the new keys. `POST /:id/cancel` runs `validateRequest(voucherCancelSchema)` and stays behind `adminGate`. (backend/src/api/vouchers.ts)
- [x] T044 [US1][US2] Adapters: `vouchersCancel(id, data?: VoucherCancelPayload)` via `ipcOrHttp`. Create stays `VoucherCreatePayload`. Type the `ApiAdapter.vouchers.cancel` signature from core (rule 21). (frontend/src/api/backendApi.ts, frontend/src/api/ElectronApiAdapter.ts, packages/ui/src/api/types.ts)

---

## Phase 5: US3 Transactions page (Lane D: audit UI)

**Lane D owns**: `packages/ui/src/i18n/locales/{en,ar}/audit.json` (type labels), `frontend/src/features/audit/auditConstants.ts`, `transactionPresentation.ts`, `typeTitleText.ts`, `nonReversibleReasons.ts`, `hooks/useTransactionRows.ts`, and their `__tests__` (`paidViaDrawerOptions.guard.test.ts`, `useTransactionRows.paidViaVoucher.test.ts`).

- [x] T050 [P] [US3] Tests first:
  - Extend the options guard so that FILTER_GROUPS options tagged `paid_via_voucher` equal `PAID_VIA_VOUCHER_OWN_TUPLES`.
  - The client twin shows linked rows under a Vouchers option and hides unrelated rows.
  - The presentation test: both types have a label, an arrow (in/out) and a non-reversible reason that mentions the Vouchers page.
  (frontend/src/features/audit/__tests__/paidViaDrawerOptions.guard.test.ts, frontend/src/features/audit/hooks/__tests__/useTransactionRows.paidViaVoucher.test.ts)
- [x] T051 [US3] Add the "Vouchers" group with options `{label:"Voucher Sold" /* filter key; row label is "Voucher sold" */, type:"VOUCHER_SALE", paid_via_voucher:true}` and `{label:"Voucher Cancelled", type:"VOUCHER_CANCEL", paid_via_voucher:true}`, and add the `paid_via_voucher` field to the option type. (frontend/src/features/audit/auditConstants.ts)
- [x] T052 [US3] Client twin reading the row's `paid_via_voucher` flag, mirroring `paid_via_account`. (frontend/src/features/audit/hooks/useTransactionRows.ts)
- [x] T053 [US1][US2] Title text and non-reversible reason (the presentation entries already landed in Lane 0) ("Cancel the voucher from the Vouchers page" / "A voucher cancel is final"). (frontend/src/features/audit/transactionPresentation.ts, typeTitleText.ts, nonReversibleReasons.ts)

---

## Phase 6: US1 + US2 Vouchers page (Lane E: Vouchers UI, starts after T044)

**Lane E owns**: `frontend/src/features/vouchers/**` and `packages/ui/src/i18n/locales/{en,ar}/vouchers.json` (payment / refund strings; the Arabic gate applies).

- [x] T060 [US1][US2] Tests first (component):
  - Create sends ONE payload (rule 22) containing `payments` from the payment form and `exchange_rate`.
  - The Save button stays disabled until the legs cover the face value.
  - Create offers "Customer account" only when the owner passes `canChargeToCustomerAccount` (name + phone); Gift card is never offered.
  - Cancel opens a refund picker (payout legs, drawer methods only) sized to the CASH part; the on-account part is shown as "$X back to the customer's account" and sends `cancel(id, {payments, exchange_rate, client_day: localDay()})`.
  - A legacy voucher (the list row has no sale) shows "No refund: this voucher was not sold" and sends no legs.
  - The `useApi` mock is a stable reference (rule 25).
  Also update the existing `Vouchers.i18n.test.tsx` for the new create payload (T022).
  (frontend/src/features/vouchers/pages/Vouchers/__tests__/Vouchers.sale.test.tsx)
- [x] T061 [US1] Create modal: embed the shared `MultiPaymentInput` in payment mode, with methods limited to drawer methods plus Customer account (gated by `canChargeToCustomerAccount`), no Gift card, and kept change, round-up and added change off. Copy the control exactly as Hold Money's drop-off uses it. (frontend/src/features/vouchers/pages/Vouchers/index.tsx)
- [x] T062 [US2] Cancel modal: a payout picker the way `HoldMoneyPickupSheet` uses it. The cash refund = `sale_* − sale_account_*` and the account part = `sale_account_*`, read from the list rows (T021). Show the "no refund" state for legacy vouchers. (frontend/src/features/vouchers/pages/Vouchers/index.tsx)

---

## Phase 7: Polish and cross-cutting (serial, after all lanes)

- [x] T070 [US1][US2][US3] Web e2e, written in T007 and run red there; here it is re-run green. It covers:
  - Sell a voucher for $60 cash with $10 change, and assert by **identity** (`source_table`/`source_id` from the create response) and **drawer delta** +$50 (rule 15).
  - Cancel with a cash refund: delta −$50, and the `VOUCHER_CANCEL` row is matched by voucher id.
  - Redeem a second voucher on a POS sale, then filter on Vouchers: the POS sale and the voucher rows show, and an unrelated sale does not.
  - Sell a voucher $20 cash + $30 on the client's account: the drawer is +$20, the client's balance is +$30, and the row shows under both the Vouchers and the Debts filters. Cancel it: the drawer is −$20 and the balance is −$30 (both net 0).
  - Void on a voucher row is refused.
  - Save the landscape screenshot `frontend/public/whats-new/<next version>/voucher-sale.png`.
  (frontend/tests/e2e-web/lira-web-079-voucher-transactions.spec.ts)
- [x] T075 Update the existing voucher e2e callers for the cash leg now booked at creation (T022 list): `frontend/tests/e2e-web/lira-web-009-vouchers.spec.ts`, `frontend/tests/e2e-electron/lira-session-allocation.spec.ts`, `frontend/tests/e2e-electron/helpers/webApiShim.ts` (desktop specs edited, not run on this Mac).
- [x] T071 Documentation:
  - FEATURE_GUIDE: add VOUCHER_SALE (in) and VOUCHER_CANCEL (out) to the §3 table, and a §9 bullet on the voucher lifecycle (reversal owner, legacy vouchers refund 0, gated types, redeemed_session_id, 'Voucher Debt' reversed leg by leg on cancel, a repaid part becomes credit), and add 'Voucher Debt' to the §5 CUSTOMER_ACCOUNT list.
  - `docs/plans/ongoing_plans/WEB_PARITY_ROADMAP.md`: add a voucher-cancel route note.
  (docs/FEATURE_GUIDE.md, docs/plans/ongoing_plans/WEB_PARITY_ROADMAP.md)
- [x] T072 Release notes (rule 30):
  - A Vouchers line: "Selling a gift card now takes payment (cash, wallet, or the customer's account) and puts the money in the drawer; cancelling an unused gift card refunds the customer. Both show in Transactions."
  - A Transactions line: "New Vouchers filter shows gift card sales, cancellations and purchases paid with a gift card."
  - A `### Gift cards are now paid for` Highlights card using the T070 screenshot.
  - Run `node scripts/build-release-notes.cjs --check`.
  (docs/release-notes/UNRELEASED.md)
- [x] T073 Update the LIRA-339 entry status to BUILT and fill in "What users will notice". (current_sprint.md)
- [x] T074 Gates: `yarn typecheck`, `yarn lint`, and affected jest paths only. Run the core guard `browserEntryIsNodeFree.guard.test.ts` (T003 added a browser export). Run `constants/__tests__/moduleDebtTypes.guard.test.ts` ('Voucher Debt' must be classified).

---

## Dependencies and lanes

```
Lane 0 (T001–T008, serial) ──► Lane A (T010–T020) ─┐
                            ├─► Lane B (T030–T033)  ├─► Lane E (T060–T062, needs T044 + T021) ─► Phase 7 (T070–T074)
                            ├─► Lane C (T040–T044) ─┘
                            └─► Lane D (T050–T053)
```

| Lane | Tasks | Owns (exclusive) | Depends on |
|---|---|---|---|
| 0 Foundation | T001–T008 | debtReversal.ts (+test), transactionTypes.voucher.test.ts, moduleDebtTypes.guard.test.ts, transactionTypes.ts, cashFlow.ts, transactionText.ts, paidViaVoucher.ts, browser.ts, index.ts (core), migrations/index.ts, create_db.sql, validators/voucher.ts, validators/transaction.ts, validators/index.ts, VoucherRepository.ts (types only, T006) | — |
| A Core money | T010–T022 | VoucherRepository.ts, VoucherService.ts, SessionPaymentService.ts + their tests, ProfitRepository.voucher.test.ts | 0 |
| B Core filter | T030–T033 | TransactionRepository.ts + paidViaVoucher test | 0 |
| C Transports | T040–T044 | voucherHandlers.ts, electron-app/schemas/index.ts, preload.ts, electron.d.ts (cancel/create signatures only; shared types land in T005), backend/src/api/vouchers.ts, backendApi.ts, ElectronApiAdapter.ts, packages/ui/src/api/types.ts + their tests | 0 (codes against the Shared contract; its tests need A's service) |
| D Audit UI | T050–T053 | frontend/src/features/audit/** listed above + ui locales audit.json | 0 |
| E Vouchers UI | T060–T062 | frontend/src/features/vouchers/** + ui locales vouchers.json | C (T044), A (T019, T021) |
| Final | T070–T075 | e2e spec, docs, UNRELEASED.md, current_sprint.md, whats-new PNG | all |

Lanes A, B, C and D run in parallel after Lane 0. `current_sprint.md` already gets its LIRA-339 entry during planning.

## Implementation strategy

MVP = Lane 0 + Lane A + Lane C + Lane E (US1 + US2: the money is correct on both transports). US3 (Lanes B + D) can ship in the same change because its files do not overlap. Everything ships together in one reviewed change (no commit without the owner's go).
