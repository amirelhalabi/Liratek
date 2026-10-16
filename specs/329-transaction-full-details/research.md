# Research: Full transaction details

## R1. Where to store the details

- **Decision**: `transactions.metadata_json.details` (typed per kind) plus `metadata_json.payment_snapshot`; fill the existing `client_name` / `client_phone` columns.
- **Rationale**: owner decision (2026-10-16). No migration on desktop or web. Fields differ per type, so columns would be mostly empty. SQLite `json_extract` still allows filtering later.
- **Alternatives**: new columns per field (rejected: sparse, needs migrations on both schemas); a separate `transaction_details` table (rejected: a join on every read for no gain).

## R2. Old rows

- **Decision**: new transactions only.
- **Rationale**: owner decision. Readers must treat a missing `details` as "not recorded", never as an error (FR-009).

## R3. Payment lines

- **Decision**: copy them into `payment_snapshot` at save time; the `payments` table stays the source of truth for drawers.
- **Rationale**: owner decision. The transaction becomes self-contained.
- **Risk**: drift between the copy and `payments`. Mitigation: one helper builds the copy from the same legs the repository books, and a test compares the copy with the inserted `payments` rows per module.

## R4. Validation strictness

- **Decision**: in tests, an invalid `details` throws. In production it logs a warning and saves the object stripped of unknown keys; the transaction is never refused.
- **Rationale**: details are informational. Refusing a sale over a details typo would be worse than a missing field. Tests catch drift before release.

## R5. Client name/phone resolver

- **Decision**: in `createTransaction`, when `client_id` is set and the name or phone is missing, read them from `clients`; when only a typed name/phone exists (walk-in), pass it through.
- **Constraint**: the existing guard "client_phone requires client_name" stays. A phone-only walk-in gets the name the screen shows (or the phone itself as the name, e.g. "Walk-in"). Final choice is left to the implementation, but it must satisfy the guard.

## R6. Where builders live

- **Decision**: next to the repository that writes the row; the session, basket and partner-order paths reuse the same builders.
- **Rationale**: rule 14 (one definition) and FR-002 (same details whichever path saved it).

## R7. Fields not sent today

- From the audit: Alfa Gift tier; including-fees (OMT/Whish App transfer, Whish top-up from a client); Katsh/iPick item key/category on the combined call; typed discount (Katsh/iPick, Whish/OMT App, Binance, basket); client phone on most recharge/OMT forms; Online Brokerage fee.
- **Decision**: add the keys to the core schemas after a three-way diff (rule 23), send them from the forms, and carry them to the builders.
