# Data model: Loto on Settle Account (LIRA-351)

No new tables or columns. The feature reuses the settle calendar's model and changes data once (backfill).

## Existing rows, as the calendar reads them

| Row | Table / type | Sign | Calendar scope | Shop day |
|---|---|---|---|---|
| Ticket sale | `supplier_ledger` `TOP_UP`, link-mode to the LOTO transaction | `+ (sale − commission)` LBP — shop owes Loto | DAY | the sale's day |
| Cash prize | `supplier_ledger` `CASH_PRIZE`, link-mode to the LOTO_CASH_PRIZE transaction | `− prize` LBP — Loto owes shop | DAY | the payout's day |
| Old checkpoint settlement | `supplier_ledger` `SETTLEMENT` | net of the checkpoint | hidden (settlement's own row) | — |
| Old checkpoint waive | `supplier_ledger` `DISCOUNT` | − waived | ACCOUNT (until backfill stamps it) | — |
| Old Pay / Receive | `supplier_ledger` `PAYMENT` / `SUPPLIER_PAYS_US` | ∓ paid | ACCOUNT = Loto credit / debt | — |
| New settlement | Settle Account (amount-first) anchor + `supplier_settlement_coverage` | as for every supplier | — | — |

## Backfill (migration v226, data only)

For each tenant, for the Loto supplier (`provider = 'LOTO'`):

1. `TOP_UP` rows whose LOTO transaction's ticket (`loto_tickets.checkpoint_id`) is in a checkpoint with `is_settled = 1`, not refunded, `settlement_id IS NULL` → `settlement_id` = the checkpoint settlement's `SETTLEMENT` ledger row id when resolvable, else the row's own id.
2. `CASH_PRIZE` rows, same rule through `loto_cash_prizes.checkpoint_id`.
3. `DISCOUNT` rows posted by checkpoint-settlement waives (identified by their LOTO_SETTLEMENT-era transaction / note) → stamped the same way.
4. Nothing else changes: no inserts, no deletes, no amount changes.

`down()`: clear `settlement_id` on exactly the rows the up step stamped (recorded by a migration marker in the row's existing columns is not available, so the down step re-derives the same set with the same predicate and sets them back to NULL).

## State after the feature

- **Ticket / prize**: open (no stamp, no coverage) → partly / fully covered by a Settle Account settlement (coverage rows) → back to open if that settlement is voided. History rows: stamped (closed) permanently.
- **Checkpoint**: report only (created and totalled as today; never settled again).
- **Loto credit**: overpay, untied old payments, voided paid tickets (↺) — used by the next settlement.

## Validation rules

- A ticket in a settled checkpoint stays non-voidable (unchanged guard).
- A calendar-covered ticket may be voided; its covered share becomes Loto credit (house rule, LIRA-343).
- Waive ≤ 450,000 LBP (`SHORTFALL_MAX`), refused above.
- Loto settlement takes no commission.
