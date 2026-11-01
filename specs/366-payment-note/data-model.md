# Data model: LIRA-366

**No migration.**

## Typed note

| Where | Field |
|---|---|
| Every money-in create payload | `typedNote?: string`. Trimmed, ≤ 500; empty or only spaces means undefined. |
| Transaction | `details.note` = `typedNote` (left out when empty). Hold keeps `details.notes`. |
| Module `note` column | `typedNote ?? note`, so forms that switch keys lose nothing. |
| Debt charge row (CUSTOMER_ACCOUNT leg) | `debt_ledger.note` = `withTypedNote(systemNote, typedNote)` = `"<systemNote> — <typedNote>"` |

Maintenance keeps its existing `note` (≤ 1000) as the typed note.

## Update owner (rule 31)

Each module's `updateMetadata` calls `syncTypedNote(db, { transactionId, oldTyped, newTyped })` when the note changes. It does two things:
- It rewrites `details.note`.
- On each charge row (`… Debt`), it swaps the exact suffix `" — " + oldTyped` for `" — " + newTyped`. If the suffix is missing (the debt note was edited by hand), it leaves the row unchanged and logs a warning.

Reversal rows are never touched. A voucher note is a snapshot taken when saved, because vouchers have no edit path.

## List mark

`noteOfDetails(details)` = trimmed `details.note ?? details.notes`. The mark shows when that is non-empty. Absent or unparsable metadata means no mark.
