# Tasks: LIRA-366 — Optional note on money-in payment forms

**Input**: [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/write-payloads.md](contracts/write-payloads.md)

Tests are required: each behaviour gets a test that is seen failing first (rule 17). Field names in payload tests come from the schema (rule 24). Run affected tests with explicit paths only.

## Phase 1: Foundational (blocks everything)

- [x] T001 `typedNoteField` (trim, ≤ 500, blank → undefined) in `packages/core/src/validators/common.ts`
- [x] T002 `typedNote: typedNoteField` added to the create schemas in `validators/{sale (saleProcessSchema), exchange (createExchangeSchema + exchangeSubmitSchema), financial, recharge, loto, customService, debt (addRepaymentSchema)}.ts`. Voucher is left to T030.
- [x] T003 `withTypedNote` / `noteOfDetails` / `TYPED_NOTE_SEPARATOR` in `packages/core/src/utils/typedNote.ts`, exported from `index.ts` and `browser.ts`
- [x] T004 `syncTypedNote` (the rule 31 update owner) in `packages/core/src/repositories/moneyPosting.ts`
- [x] T005 `PaymentNoteField` in `packages/ui/src/components/ui/PaymentNoteField.tsx`, plus the en/ar `payment.json` `note.*` keys
- [x] T006 Test `syncTypedNote`: suffix swap, clear, a charge row only (refund row untouched), a hand-edited row left alone. File: `packages/core/src/repositories/__tests__/moneyPosting.lira366SyncTypedNote.test.ts`

## Phase 2: User Story 1 — core (two parallel groups)

For each repository:
- the create path writes `details.note = typedNote`
- the module `note` column is written from `typedNote ?? note`
- every `bookClientDebtCharge` note is wrapped in `withTypedNote(…, typedNote)`
- `updateMetadata` calls `syncTypedNote` when `note` changes

Each task also checks three key sets for its channel (rule 23): the schema, the `preload.ts` `data` type, and the fields the IPC handler and REST route forward.

**Group A**
- [x] T010 [P] [US1] `SalesRepository` (POS checkout and session basket)
- [x] T011 [P] [US1] `ExchangeRepository`
- [x] T012 [P] [US1] `LotoTicketRepository`
- [x] T013 [P] [US1] `RechargeRepository`

**Group B**
- [x] T020 [P] [US1] `FinancialServiceRepository` (system send, App, Binance, bills, Katsh; `serviceDebtNote` reads `typedNote ?? note`)
- [x] T021 [P] [US1] `CustomServiceRepository`
- [x] T022 [P] [US1] `DebtRepository` addRepayment (`details.note` and the ledger note)
- [x] T023 [P] [US1] `MaintenanceRepository`: the existing `note` becomes the typed note in `details.note`, is added to the repair debt note, and is synced on edit
- [x] T024 [P] [US1] `HoldMoneyRepository`: no change; `details.notes` is read by `noteOfDetails`. Pin this with a test.

**Voucher** (after LIRA-365 Story 3 has landed in the same files)
- [x] T030 [US1] `voucherCreateSchema.typedNote` and `VoucherRepository` write `details.note`, debt `withTypedNote`. The note is a snapshot taken when saved.

## Phase 3: User Story 1 — UI (two parallel groups)

Each form keeps note state and renders `PaymentNoteField` under its payment box. It sends `typedNote` from its one payload builder (rule 22: every mode, so walk-in, session, partner and offline). A form that already has a note box switches that box to send `typedNote` and gets no second box.

**Group A**
- [x] T040 [P] [US1] POS `CheckoutModal.tsx`
- [x] T041 [P] [US1] Exchange page
- [x] T042 [P] [US1] Services page (OMT/Whish system send)
- [x] T043 [P] [US1] `OmtWhishAppTransferForm.tsx`
- [x] T044 [P] [US1] `CryptoForm.tsx` (key switch) and `Recharge/index.tsx` `handleCryptoSubmit`
  - Built 2026-11-01. POS shows the box via `showNote` (Maintenance renders the same modal without it). Exchange, Services and App forms put the box on the page, so walk-in, session and partner all send it; the App form's walk-in body goes through core `buildWalletTransferPayload({ typedNote })`. Binance keeps its existing Notes box: `buildCryptoServiceFields` sends it as `typedNote` and still as `referenceNumber` (History unchanged); the partner submit sends it too. Tests: `*lira366Note*` (POS 3, Exchange 3, Services 2, App 3, crypto builder 2), each seen failing first.

**Group B**
- [x] T050 [P] [US1] `FinancialForm.tsx`, `KatshForm.tsx`, `TelecomForm.tsx`
- [x] T051 [P] [US1] Loto page
- [x] T052 [P] [US1] CustomServices page (key switch)
- [x] T053 [P] [US1] Debts repayment (key switch)
- [x] T054 [US1] Vouchers page (key switch, after LIRA-365 Story 3)

## Phase 4: Transactions list, e2e, notes

- [x] T060 [US1] Note mark on the row (built in the Summary cell, `frontend/src/features/audit/components/TransactionCells.tsx`, which renders TransactionsViewer's rows), using `noteOfDetails`. The tooltip shows the note. Absent or bad metadata means no mark.
- [ ] T061 [US1] Web e2e `frontend/tests/e2e-web/lira-web-*-payment-note.spec.ts`. Covers the quickstart scenario, the edit sync, and saving the screenshot.
- [x] T062 Release note in the Payment window section of `docs/release-notes/UNRELEASED.md`, plus a What's new card with the screenshot. Also add a "What users will notice" line in `current_sprint.md` (LIRA-366 block only).
- [ ] T063 Gates:
  - typecheck for frontend and core (confirm the elapsed time)
  - eslint for each workspace
  - transport parity
  - `build-release-notes --check`
  - the guard `browserEntryIsNodeFree`

## Dependencies

Phase 1 comes first. Then Phase 2 groups A and B and Phase 3 groups A and B run in parallel. T030 and T054 wait for LIRA-365 Story 3. Phase 4 comes last.
