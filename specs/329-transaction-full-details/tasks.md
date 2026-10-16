# Tasks: Full transaction details (LIRA-329)

**Input**: spec.md, plan.md, data-model.md, contracts/transaction-details.md, research.md, `docs/plans/ongoing_plans/TRANSACTION_DETAIL_AUDIT.md`.

**Tests**: required by the constitution (rule 17). Each module's completeness guard is written first and seen failing.

**Rules for every task**:

- Run only affected test files. Never a full suite.
- Before adding a key to an existing schema, do a three-way diff (rule 23).
- Each form builds its payload once, typed from the schema (rules 21/22).
- No amount, profit, ledger or drawer change (FR-008).
- One release-note line per user-visible step.

## Phase 1: Setup

- [X] T001 Add LIRA-329 ticket to `current_sprint.md` with "What users will notice:" (coordinate: the file has another session's uncommitted edit, so add lines only)

## Phase 2: Foundation (blocks all stories)

- [X] T002 [P] Test FIRST `packages/core/src/validators/__tests__/transactionDetails.test.ts`: each kind parses a full sample; an unknown key is stripped; a missing `kind`/`v` fails; `paymentSnapshotSchema` accepts IN/OUT lines and kept change
- [X] T003 [P] `packages/core/src/validators/transactionDetails.ts`: zod discriminated union on `kind` for every kind in data-model.md + `paymentSnapshotSchema`; export the types and schemas from `validators/index.ts` and `browser.ts` (browser-safe, rule 29)
- [X] T004 [P] Test FIRST `packages/core/src/utils/__tests__/paymentSnapshot.test.ts`: split two currencies + OUT change + kept change; uses `partitionLegs` classification
- [X] T005 [P] `packages/core/src/utils/paymentSnapshot.ts`: `buildPaymentSnapshot` (pure)
- [X] T006 Test FIRST `packages/core/src/repositories/__tests__/TransactionRepository.details.test.ts`: `createTransaction` with `details` + `payment_snapshot` merges them into `metadata_json`, keeps existing keys; invalid details throw under test; the client resolver fills `client_name`/`client_phone` from `client_id`; phone-only walk-in still satisfies the guard
- [X] T007 `packages/core/src/repositories/TransactionRepository.ts`: optional `details` / `payment_snapshot` inputs; validation strict in test, logged and stripped in production (module logger); client resolver; the same merge for the void (~5745) and refund (~6317) inserts through one shared function
- [X] T008 [P] `packages/core/src/__tests__/transactionDetailsCoverage.guard.test.ts`: lists every `createTransaction` call site (grep-style, like `moduleDebtTypes.guard`) and fails for any site in a delivered module that passes no `details`; starts with an allowlist of not-yet-delivered modules that shrinks per phase
- [X] T009 Rebuild core and sync `node_modules/@liratek/core/dist`

## Phase 3: US1 — OMT / Whish system + Custom Services + Hold Money (P1) 🎯 MVP

- [X] T010 [US1] Test FIRST `packages/core/src/repositories/__tests__/FinancialServiceRepository.details.test.ts`: OMT send and Whish receive with every Services-page field → every `omt_whish_transfer` field, client columns, payment snapshot equals inserted `payments` rows; amounts and profit unchanged against today's expectations
- [X] T011 [US1] Builder `buildOmtWhishTransferDetails` + pass `details` / `payment_snapshot` / client fields in `FinancialServiceRepository` (`createTransaction` ~:2481)
- [X] T012 [US1] Payload gaps on the Services page (`frontend/src/features/services/pages/Services/index.tsx`) and `validators/financial.ts`: `includingFees`, Online Brokerage fee value, client phone; frontend test that the payload carries them (names from the schema, rule 24)
- [X] T013 [P] [US1] Test FIRST + builder `custom_service` in `CustomServiceRepository` (category, note, product, fulfilment, partner mode and id incl. Via)
- [X] T014 [P] [US1] Test FIRST + builder `hold_money` in `HoldMoneyRepository` (notes on create; action on collect/void)
- [X] T015 [US1] Remove these modules from the T008 allowlist; release-note line; web e2e `frontend/tests/e2e-web/lira-web-070-transaction-details.spec.ts` (OMT send over web, read details back over REST)

## Phase 4: US2a — Mobile Recharge (P1)

- [X] T016 [US2] Test FIRST + `telecom_recharge` / `telecom_buyback` builders in `RechargeRepository` (sale ~:1177, buy-back ~:2027): carrier line, default price, typed Days USD, gift tier, payout method
- [X] T017 [US2] Payload gaps: Alfa Gift tier key/label, client phone (`frontend/src/features/recharge/pages/Recharge/index.tsx`, `validators/recharge.ts`)
- [X] T018 [US2] Test FIRST + `catalog_sale` / `provider_bill` / `wallet_transfer` / `crypto_transfer` builders in `FinancialServiceRepository` (Katsh/iPick items with key/category/only-days/returned credits; currency mode; provider fee; fee paid by; wallet/reference)
- [X] T019 [US2] Payload gaps: Katsh/iPick item key and category on the combined call, typed discount (`KatshForm.tsx`, `FinancialForm.tsx`, `CryptoForm.tsx`, `OmtWhishAppTransferForm.tsx`, `utils/basketCheckout.ts`, `packages/core/src/utils/catalogSale.ts`, `walletTransfer.ts`)
- [X] T020 [P] [US2] Test FIRST + `wallet_topup` builder for the top-up/cash-out paths in `RechargeRepository` (~:798, :2296, :2523, :2673, :3100) incl. including-fees on top-up from a client
- [X] T021 [P] [US2] Test FIRST + `wrong_number` builder (`WrongNumberRepository` ~:440 and the expense row): right number, sale link
- [X] T022 [US2] Basket + partner order: the same builders through `SessionCheckoutService` / `RechargeBasketService` / `RechargePartnerOrderService`; item rows get client name/phone from the session; `paid_in_session` — done; one existing test (`RechargeBasketService.test` bill-parity row compare) red on the new session marker only, edit pending owner OK
- [X] T023 [US2] Shrink the allowlist; release-note line

## Phase 5: US2b — POS, Maintenance, Warranty (P1)

- [X] T024 [P] [US2] Test FIRST + `pos_sale` builder in `SalesRepository` (~:1271): per-item product, price, cost, IMEI/unit, warranty; gift card codes; picked client's name/phone via the resolver
- [X] T025 [P] [US2] Test FIRST + `maintenance_job` builder in `MaintenanceRepository` (~:860): full issue text, status, cost, gross price, warranty months, parts with ids and costs
- [X] T026 [P] [US2] Test FIRST + `warranty_claim` details on `WarrantyService.bookCost` (~:781) and the warranty refund row
- [X] T027 [US2] Shrink the allowlist; release-note line

## Phase 6: US2c — Exchange, Loto (P1)

- [X] T028 [P] [US2] Test FIRST + `exchange` builder in `ExchangeRepository` (~:531): market rates, override flag (send it from `frontend/src/features/exchange/pages/Exchange/index.tsx`), per-leg profit, payout rate, client phone — done; two existing exact-metadata assertions (`ExchangeRepository.lotSettlement.test` :848/:881, "no new keys" on a USD↔LBP row) red on the new `details`/`payment_snapshot` keys only, edit pending owner OK
- [X] T029 [P] [US2] Test FIRST + `loto_sale` / `loto_prize` builders (`LotoTicketRepository` ~:473, `LotoCashPrizeRepository` ~:108): client name/phone when unresolved, prize date — done; a Loto basket ticket/prize does not get `paid_in_session` yet (the session marker is injected for Mobile Recharge channels only — phase 8)
- [X] T030 [US2] Shrink the allowlist; release-note line

## Phase 7: US2d — Money & accounts (P1)

- [X] T031 [P] [US2] Test FIRST + `expense` builder (`ExpenseRepository._bookExpense` ~:492): bill amount as typed, full description, stock use
- [X] T032 [P] [US2] Test FIRST + `account_entry` builder (`DebtRepository` repayment ~:557, cash-out ~:1873, entries ~:2080, write-off ~:934): note, client name/phone
- [X] T033 [P] [US2] Test FIRST + `supplier_entry` builder (`SupplierRepository` ~:7051, :1945, :2143, :3649, :6190): note, commission rate, unit count
- [X] T034 [P] [US2] Test FIRST + `partner_entry` builder (`PartnerRepository` ~:603, :735, :809): notes, picked type, write-off/discount reason
- [X] T035 [US2] Shrink the allowlist; release-note line

## Phase 8: US3 — Payment snapshot everywhere + session siblings + reversals (P2)

- [X] T036 [US3] Test FIRST: every delivered module's details test also asserts `payment_snapshot` equals its `payments` rows (add where missing) — done: one shared `afterEach` check (`repositories/testHelpers/paymentSnapshotAssert.ts`) in all 16 details tests (the 15 `*.details.test.ts` files plus `FinancialServiceRepository.mobileDetails`) compares every snapshotted row with its `payments` rows as a multiset of {method, currency, amount, direction} (OUT = "Change returned"/"Change given" note); each file names what it leaves out (provider bookkeeping rows; GIFT_CARD / CUSTOMER_ACCOUNT lines, which write no `payments` row). It caught a real bug: a Custom Services pay-out listed the recipient's cash as OUT / change returned (fixed). Supplier drawer payment (`addLedgerEntry` with a drawer) now saves its snapshot. No snapshot, by design: For-Partner rows and paper entries (no counter money), automatic sibling rows (their parent holds it), reversals (their legs are written after the row, by `_reversePayments`); session items and session siblings carry `{ lines: [], session_id }`
- [X] T037 [US3] `session_sibling` details on the extra / kept-change / waived rows (`SessionCheckoutService` ~:832, :928, :989) incl. `paidByMethod` as sent; client phone — done; `paid_in_session` is now injected for EVERY cart channel (POS, Maintenance, Custom Services, Loto ticket/prize too) and carried by each repository the Phase 4 way. The money still goes by the payment lines (bug #5: only the record changes)
- [X] T038 [US3] `reversal` details + client name/phone copied from the original on void/refund; refund unit flags — done (`utils/reversalDetails.ts`, used by the void and whole-refund INSERTs and every REFUND / REFUND_UNDO / COUNTERPARTY_DISCOUNT-reversal writer); the resolver's REFUND exclusion is gone. A warranty refund keeps its `warranty_claim` details (explicit details win). One existing money test's premise changes: `ProfitRepository.refundKeptChangeRefundDay` :766 expects the item refund row's `client_name` null, now "Ali" — left red, edit pending owner OK
- [X] T039 [US3] Guard allowlist is empty; release-note line — done: NOT_YET_DELIVERED, PARTLY_DELIVERED and PENDING_KINDS are empty; the LIRA-321 forgiven-leftover WAIVED_SHORTFALL sibling (`forgivenShortfall.ts`) moved to NO_DETAILS_KIND (automatic sibling, rule 26 — owner to confirm)

## Phase 9: US4 — Parity and polish (P2)

- [X] T040 [US4] Extend `lira-web-070` with one Mobile Recharge and one POS case; run it on web only (owner asked first)
- [X] T041 Gates: core/backend/electron/frontend typechecks with their own configs; eslint + prettier on touched files; check-tenant-scoping, check-bind-arity, check-transport-parity, check-schema-equivalence; affected test files only
- [X] T042 Update `docs/plans/ongoing_plans/TRANSACTION_DETAIL_AUDIT.md` with each covered item ticked; mark the tasks done

## Dependencies

- Phase 2 blocks everything.
- Phases 3–7 are independent of each other once Phase 2 is done, but share `FinancialServiceRepository` (Phases 3 and 4), so run those two in order.
- Phase 8 runs after the modules it covers.
- Phase 9 runs last.

## MVP

Phases 1–3: the OMT/Whish system, Custom Services and Hold Money transactions keep every field. This proves the foundation before the rest.
