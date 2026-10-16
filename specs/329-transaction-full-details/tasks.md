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

- [ ] T001 Add LIRA-329 ticket to `current_sprint.md` with "What users will notice:" (coordinate: the file has another session's uncommitted edit, so add lines only)

## Phase 2: Foundation (blocks all stories)

- [ ] T002 [P] Test FIRST `packages/core/src/validators/__tests__/transactionDetails.test.ts`: each kind parses a full sample; an unknown key is stripped; a missing `kind`/`v` fails; `paymentSnapshotSchema` accepts IN/OUT lines and kept change
- [ ] T003 [P] `packages/core/src/validators/transactionDetails.ts`: zod discriminated union on `kind` for every kind in data-model.md + `paymentSnapshotSchema`; export the types and schemas from `validators/index.ts` and `browser.ts` (browser-safe, rule 29)
- [ ] T004 [P] Test FIRST `packages/core/src/utils/__tests__/paymentSnapshot.test.ts`: split two currencies + OUT change + kept change; uses `partitionLegs` classification
- [ ] T005 [P] `packages/core/src/utils/paymentSnapshot.ts`: `buildPaymentSnapshot` (pure)
- [ ] T006 Test FIRST `packages/core/src/repositories/__tests__/TransactionRepository.details.test.ts`: `createTransaction` with `details` + `payment_snapshot` merges them into `metadata_json`, keeps existing keys; invalid details throw under test; the client resolver fills `client_name`/`client_phone` from `client_id`; phone-only walk-in still satisfies the guard
- [ ] T007 `packages/core/src/repositories/TransactionRepository.ts`: optional `details` / `payment_snapshot` inputs; validation strict in test, logged and stripped in production (module logger); client resolver; the same merge for the void (~5745) and refund (~6317) inserts through one shared function
- [ ] T008 [P] `packages/core/src/__tests__/transactionDetailsCoverage.guard.test.ts`: lists every `createTransaction` call site (grep-style, like `moduleDebtTypes.guard`) and fails for any site in a delivered module that passes no `details`; starts with an allowlist of not-yet-delivered modules that shrinks per phase
- [ ] T009 Rebuild core and sync `node_modules/@liratek/core/dist`

## Phase 3: US1 — OMT / Whish system + Custom Services + Hold Money (P1) 🎯 MVP

- [ ] T010 [US1] Test FIRST `packages/core/src/repositories/__tests__/FinancialServiceRepository.details.test.ts`: OMT send and Whish receive with every Services-page field → every `omt_whish_transfer` field, client columns, payment snapshot equals inserted `payments` rows; amounts and profit unchanged against today's expectations
- [ ] T011 [US1] Builder `buildOmtWhishTransferDetails` + pass `details` / `payment_snapshot` / client fields in `FinancialServiceRepository` (`createTransaction` ~:2481)
- [ ] T012 [US1] Payload gaps on the Services page (`frontend/src/features/services/pages/Services/index.tsx`) and `validators/financial.ts`: `includingFees`, Online Brokerage fee value, client phone; frontend test that the payload carries them (names from the schema, rule 24)
- [ ] T013 [P] [US1] Test FIRST + builder `custom_service` in `CustomServiceRepository` (category, note, product, fulfilment, partner mode and id incl. Via)
- [ ] T014 [P] [US1] Test FIRST + builder `hold_money` in `HoldMoneyRepository` (notes on create; action on collect/void)
- [ ] T015 [US1] Remove these modules from the T008 allowlist; release-note line; web e2e `frontend/tests/e2e-web/lira-web-070-transaction-details.spec.ts` (OMT send over web, read details back over REST)

## Phase 4: US2a — Mobile Recharge (P1)

- [ ] T016 [US2] Test FIRST + `telecom_recharge` / `telecom_buyback` builders in `RechargeRepository` (sale ~:1177, buy-back ~:2027): carrier line, default price, typed Days USD, gift tier, payout method
- [ ] T017 [US2] Payload gaps: Alfa Gift tier key/label, client phone (`frontend/src/features/recharge/pages/Recharge/index.tsx`, `validators/recharge.ts`)
- [ ] T018 [US2] Test FIRST + `catalog_sale` / `provider_bill` / `wallet_transfer` / `crypto_transfer` builders in `FinancialServiceRepository` (Katsh/iPick items with key/category/only-days/returned credits; currency mode; provider fee; fee paid by; wallet/reference)
- [ ] T019 [US2] Payload gaps: Katsh/iPick item key and category on the combined call, typed discount (`KatshForm.tsx`, `FinancialForm.tsx`, `CryptoForm.tsx`, `OmtWhishAppTransferForm.tsx`, `utils/basketCheckout.ts`, `packages/core/src/utils/catalogSale.ts`, `walletTransfer.ts`)
- [ ] T020 [P] [US2] Test FIRST + `wallet_topup` builder for the top-up/cash-out paths in `RechargeRepository` (~:798, :2296, :2523, :2673, :3100) incl. including-fees on top-up from a client
- [ ] T021 [P] [US2] Test FIRST + `wrong_number` builder (`WrongNumberRepository` ~:440 and the expense row): right number, sale link
- [ ] T022 [US2] Basket + partner order: the same builders through `SessionCheckoutService` / `RechargeBasketService` / `RechargePartnerOrderService`; item rows get client name/phone from the session; `paid_in_session`
- [ ] T023 [US2] Shrink the allowlist; release-note line

## Phase 5: US2b — POS, Maintenance, Warranty (P1)

- [ ] T024 [P] [US2] Test FIRST + `pos_sale` builder in `SalesRepository` (~:1271): per-item product, price, cost, IMEI/unit, warranty; gift card codes; picked client's name/phone via the resolver
- [ ] T025 [P] [US2] Test FIRST + `maintenance_job` builder in `MaintenanceRepository` (~:860): full issue text, status, cost, gross price, warranty months, parts with ids and costs
- [ ] T026 [P] [US2] Test FIRST + `warranty_claim` details on `WarrantyService.bookCost` (~:781) and the warranty refund row
- [ ] T027 [US2] Shrink the allowlist; release-note line

## Phase 6: US2c — Exchange, Loto (P1)

- [ ] T028 [P] [US2] Test FIRST + `exchange` builder in `ExchangeRepository` (~:531): market rates, override flag (send it from `frontend/src/features/exchange/pages/Exchange/index.tsx`), per-leg profit, payout rate, client phone
- [ ] T029 [P] [US2] Test FIRST + `loto_sale` / `loto_prize` builders (`LotoTicketRepository` ~:473, `LotoCashPrizeRepository` ~:108): client name/phone when unresolved, prize date
- [ ] T030 [US2] Shrink the allowlist; release-note line

## Phase 7: US2d — Money & accounts (P1)

- [ ] T031 [P] [US2] Test FIRST + `expense` builder (`ExpenseRepository._bookExpense` ~:492): bill amount as typed, full description, stock use
- [ ] T032 [P] [US2] Test FIRST + `account_entry` builder (`DebtRepository` repayment ~:557, cash-out ~:1873, entries ~:2080, write-off ~:934): note, client name/phone
- [ ] T033 [P] [US2] Test FIRST + `supplier_entry` builder (`SupplierRepository` ~:7051, :1945, :2143, :3649, :6190): note, commission rate, unit count
- [ ] T034 [P] [US2] Test FIRST + `partner_entry` builder (`PartnerRepository` ~:603, :735, :809): notes, picked type, write-off/discount reason
- [ ] T035 [US2] Shrink the allowlist; release-note line

## Phase 8: US3 — Payment snapshot everywhere + session siblings + reversals (P2)

- [ ] T036 [US3] Test FIRST: every delivered module's details test also asserts `payment_snapshot` equals its `payments` rows (add where missing)
- [ ] T037 [US3] `session_sibling` details on the extra / kept-change / waived rows (`SessionCheckoutService` ~:832, :928, :989) incl. `paidByMethod` as sent; client phone
- [ ] T038 [US3] `reversal` details + client name/phone copied from the original on void/refund; refund unit flags
- [ ] T039 [US3] Guard allowlist is empty; release-note line

## Phase 9: US4 — Parity and polish (P2)

- [ ] T040 [US4] Extend `lira-web-070` with one Mobile Recharge and one POS case; run it on web only (owner asked first)
- [ ] T041 Gates: core/backend/electron/frontend typechecks with their own configs; eslint + prettier on touched files; check-tenant-scoping, check-bind-arity, check-transport-parity, check-schema-equivalence; affected test files only
- [ ] T042 Update `docs/plans/ongoing_plans/TRANSACTION_DETAIL_AUDIT.md` with each covered item ticked; mark the tasks done

## Dependencies

- Phase 2 blocks everything.
- Phases 3–7 are independent of each other once Phase 2 is done, but share `FinancialServiceRepository` (Phases 3 and 4), so run those two in order.
- Phase 8 runs after the modules it covers.
- Phase 9 runs last.

## MVP

Phases 1–3: the OMT/Whish system, Custom Services and Hold Money transactions keep every field. This proves the foundation before the rest.
