# Implementation Plan: Optional note on money-in payment forms

**Branch**: `366-payment-note` (work happens on `main`; ticket LIRA-366) | **Date**: 2026-11-01 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/366-payment-note/spec.md`

## Summary

Money-in payment forms get one optional Note box. The cashier's text is sent under a new key, `typedNote`. Generated labels stay in the old `note` key, so they are never mistaken for a typed note. The note goes to `details.note` on the transaction. The details window shows it, and a note mark shows on the row in the Transactions list. When part of the payment is charged to the customer's account, the note is added at the end of the debt entry's note. When the note is edited later, one shared helper updates the transaction and its debt charge rows together (rule 31). There is no migration.

Scope is 12 forms. These are the 10 in the spec, plus two the owner added on 2026-11-01: the Maintenance repair job and the Hold money deposit. Both already have a note box, so they reuse it.

## Technical Context

**Language/Version**: TypeScript (strict), React 19, Node (Electron 31 main and the Fly backend)

**Primary Dependencies**: Zod validators in `packages/core/src/validators/`, `@liratek/ui` payment components, TanStack Query

**Storage**: SQLite. Uses existing columns only: `transactions.metadata_json` (`details.note`), the module `note` columns and `debt_ledger.note`. No migration.

**Testing**: core jest (repository tests with ledger deltas), frontend jest (forms and payload builders, field names taken from schemas), web e2e (`frontend/tests/e2e-web/lira-web-*`). No desktop e2e on the Mac.

**Target Platform**: desktop (Electron IPC) and web (REST on Fly), the same core.

**Project Type**: desktop and web app, monorepo.

**Performance Goals**: none. One extra short string per save.

**Constraints**: the note is at most 500 characters on new boxes. Maintenance keeps its existing 1000. A note of only spaces counts as empty. Old payloads without `typedNote` (offline queue, cached web build) behave as they do today.

**Scale/Scope**: 12 forms, about 9 repositories, the Transactions list, the details window, the debt note and the edit paths.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| I. One core, two transports | `typedNote` is added to each shared core schema. IPC and REST forward it unchanged. Payloads are built once, through the existing builders (rule 22). The web e2e proves it. |
| II. Layer boundaries | Debt-note sync lives in a repository helper (`moneyPosting.ts`). Services never touch SQL. |
| III. Contracts defined once | One `typedNoteField` schema fragment in `validators/common.ts`, reused by every money-in schema. Adapter types stay derived (rule 21). A three-way key diff is done per channel (rule 23). Each schema key is read by its service (rule 23, reverse). |
| IV. Money integrity | No money moves. The debt note only changes text. Reversal rows (refund or void) are never rewritten. |
| V. Data and security | Parameterized SQL. Every UPDATE includes `tenant_id`. |
| Rule 31 (copies) | The update owner is `syncTypedNote(...)`, called from each module's `updateMetadata`. Vouchers have no edit path, so their note is a snapshot taken when saved. |
| Rule 30 (release notes) | One Payment window line, plus a What's new card with a real screenshot of the Note box. |

Result: PASS. No violations.

## Project Structure

### Documentation (this feature)

```text
specs/366-payment-note/
├── spec.md
├── plan.md          # this file
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/write-payloads.md
├── checklists/requirements.md
└── tasks.md         # /speckit-tasks
```

### Source Code (repository root)

```text
packages/core/src/
├── validators/common.ts                 # typedNoteField (trim, ≤500, empty → undefined)
├── validators/{sale,exchange,financial,recharge,loto,customService,voucher,debt,maintenance,holdMoney}.ts
├── repositories/moneyPosting.ts         # withTypedNote(systemNote, typed), syncTypedNote(...)
├── repositories/{Sales,Exchange,FinancialService,Recharge,LotoTicket,CustomService,Voucher,Debt,Maintenance,HoldMoney}Repository.ts
└── utils/typedNote.ts                   # browser-safe: noteOfDetails(details) used by the list mark
packages/ui/src/components/ui/PaymentNoteField.tsx   # one shared Note box
frontend/src/features/
├── sales/pages/POS/components/CheckoutModal.tsx
├── exchange/pages/Exchange/…            # Exchange form
├── services/pages/Services/…            # OMT/Whish system send
├── recharge/components/{OmtWhishAppTransferForm,CryptoForm,FinancialForm,KatshForm,TelecomForm}.tsx
├── loto/pages/Loto/…
├── custom-services/pages/CustomServices/…, vouchers/pages/Vouchers/…, debts/pages/Debts/…
├── maintenance/pages/Maintenance/…, hold money form
└── audit/pages/TransactionsViewer.tsx   # note mark; details panel already shows details.note
electron-app/handlers/*, backend/src/api/*   # forward-only: verify typedNote is not stripped
```

**Structure Decision**: this uses the existing monorepo layers and adds no new module. The core holds every rule. The UI adds one shared component.

## Delivery order

1. **Core**: the `typedNoteField` fragment, then `details.note` on each create path, then the debt-note suffix and `syncTypedNote`. Each step has a failing-first test (rule 17).
2. **UI**: `PaymentNoteField`, then the 8 new boxes, then the 4 forms that switch keys (Vouchers, CustomServices, Debts repayment, CryptoForm), then reuse on Maintenance and Hold.
3. **Transactions list**: the note mark, then the edit path (the Transactions and History edit windows).
4. **Web e2e and screenshot**, then the release note, then the gates.

## Complexity Tracking

None.
