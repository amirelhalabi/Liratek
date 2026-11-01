# Research: LIRA-366 — Optional note on money-in payment forms

Moved from LIRA-365 on 2026-10-31. Code read the same day; line numbers are approximate.

## R1. Note: a separate typed-note field

- **Decision**: A new optional key `typedNote` (max 500) on every money-in create schema. Only text the cashier typed goes in it. It is stored in the common `details.note`, which drives the details window and the Transactions list mark. The existing `note` key keeps carrying today's generated labels unchanged.
- **Rationale**:
  - Several pages send a generated label in `note` ("OMT - SEND", "Exchange USD → LBP"). The repository cannot tell those from typed text. `buildExchangeDetails` (~232-244) leaves the note out for exactly this reason.
  - A separate key makes "a note someone typed" unambiguous on both transports and on offline replay.
  - Forms that already send typed text in `note` (Vouchers, CustomServices, Debts repayment, CryptoForm) switch to `typedNote`, so there is one meaning per name. Each of those repositories must write its module `note` column from `typedNote ?? note`. Otherwise the typed text silently disappears from their History screens (rule 23). There is one task per module.
- **Alternatives rejected**: moving label generation to the server and making `note` typed-only. Old payloads (offline queue, a cached web build) would then show generated labels as typed notes.

## R2. Note on the debt entry, and edits

- **Decision**: `bookClientDebtCharge` (`moneyPosting.ts` ~599) gets the typed note appended to the system note: `"<system note> — <typed note>"`. One shared helper builds this, used by every money-in writer that books a CUSTOMER_ACCOUNT leg.
- **Edits (rule 31)**: the update owner is each module's `updateMetadata` (`FinancialServiceRepository.ts` ~6888, `ExchangeRepository.ts` ~1671, Recharge, CustomService, Loto, Sales). When the typed note changes, it calls one shared `syncDebtNoteForTransaction(transactionId, typedNote)`, which rewrites `details.note` and the `debt_ledger.note` of the **charge rows only** (`transaction_type` ending in `Debt`, never refund-reversal rows) linked by `transaction_id`. The system part is rebuilt from the same builder that wrote it, never by splitting the old text on " — " (a typed note may contain that dash). Vouchers have no edit path, so their note is a snapshot taken when saved, and the spec says so.
- **Rationale**: only `serviceDebtNote` copies a typed note today (`FinancialServiceRepository.ts` ~4201/4245). Every other debt note is built by the system.

## R3. Which forms need a new Note box

- **Already typed**: Vouchers, CustomServices, Debts repayment, CryptoForm. These switch the key only.
- **New box**: POS CheckoutModal, Exchange, Services (OMT/Whish; it has `note` state but no input), OmtWhishAppTransferForm, FinancialForm, KatshForm, TelecomForm, Loto.
- **Decision**: one shared `PaymentNoteField` component in `packages/ui` (label, 500-character limit, test id), placed under each form's payment box. One look per control.

## Plan-time verification (2026-11-01)

Checked against the code during `/speckit-plan`. These corrections replace the parts of R1–R3 above where they disagree.

- **Paths.** `bookClientDebtCharge` lives in `packages/core/src/repositories/moneyPosting.ts` (~599), not `utils/`. It is called from 20 places: FinancialService 8, CustomService 3, Voucher 2, moneyPosting 3, Loto 1, Maintenance 1, Recharge 1, Sales 1. `details.note` is already a common field (`validators/transactionDetails.ts` ~58). The details panel already shows any `details.note` word for word (the `note` key is in `VERBATIM_KEY_WORDS` in `transactionDetailsView.ts`). The Transactions list has no note mark today.

## R2 (revised). Debt note on edit: replace the suffix, don't rebuild

- **Decision**: one shared helper, `withTypedNote(systemNote, typed)`, returns `"<systemNote> — <typed>"`, or `systemNote` when nothing was typed. It wraps the `note` that each money-in writer passes to `bookClientDebtCharge`. On an edit, `syncTypedNote(db, {transactionId, oldTyped, newTyped})` does two things:
  1. It rewrites `details.note` on the transaction.
  2. For each **charge** row linked by `transaction_id` (`transaction_type` ends in ` Debt`, so refund or reversal rows are never touched), it removes the exact suffix `" — " + oldTyped` (when `oldTyped` is non-empty and the note ends with it), then appends `" — " + newTyped` (when non-empty).
  If the old suffix is missing, the debt note was edited by hand on the Debts page. The helper then leaves that row alone and logs a warning, so a hand edit is never overwritten or doubled.
- **Rationale**: rebuilding the system part needs each writer's original inputs at edit time. There are 20 writers, and several no longer have those inputs. Matching the exact old typed text as a suffix needs no parsing, and it is safe even when the note itself contains " — ".
- **Where it is called**: each module's `updateMetadata` (Sales, Exchange, FinancialService, Recharge, Loto, CustomService, Maintenance), when `note` changes. A History edit of `note` on those screens is treated as the new typed note.

## R4. Scope additions (owner, 2026-11-01)

- **Maintenance repair job**: it already has a typed `note` (≤ 1000). It now also writes `details.note`, gets the list mark, and adds the note to its repair debt note. The existing box is reused, so it gets no `PaymentNoteField`.
- **Hold money deposit**: it already has `notes`, and it already writes `details.notes` (`buildHoldMoneyDetails`). The list mark reads it through `noteOfDetails(details)` = `details.note ?? details.notes` (trimmed). The key is not renamed, so existing rows show the mark too. A hold has no debt leg.

## R5. Transactions list mark

- **Decision**: a small note icon on the row when `noteOfDetails(parsed metadata_json.details)` is non-empty. Its tooltip shows the note. Metadata that is absent or can't be parsed means no mark. `noteOfDetails` is pure and lives in `packages/core/src/utils/typedNote.ts`, which can be reached from `browser.ts` and imports no Node module (rule 29).
- **Session basket**: an item added to a session carries `typedNote` in its stored payload. The checkout replays that payload, so the note stays with the item. Verify this path in tasks (rule 22: one payload builder per mode).
