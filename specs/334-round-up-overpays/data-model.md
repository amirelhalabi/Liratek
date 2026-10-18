# Data model: Round-up overpays (LIRA-334)

No migration. Nothing new is stored beyond rows that already exist.

## Payout round-up claim (wire only)

| Field | Type | Rule |
| --- | --- | --- |
| `rounding_given_usd` | number ≥ 0, optional, no default | non-zero only when the payout is in USD |
| `rounding_given_lbp` | number ≥ 0, optional, no default | non-zero only when the payout is in LBP |

- At most one side is non-zero, and it must be the owed currency.
- It is refused together with `kept_change_*`.
- It is capped at $5 / 450,000 LBP by `isWithinShortfallMax`.
- It must equal (legs at the tender rate − owed) within the reconciliation tolerance.

## "Change rounding" expense (existing row, new writer)

- `expenses`:
  - `category = 'Change rounding'`;
  - `amount_usd` or `amount_lbp` = the rounding (in the owed currency);
  - `paid_by_method = 'CASH'`;
  - `source_ref_table` / `source_ref_id` = the parent link (see research R5);
  - `expense_date` = the parent's day.
- Unified `transactions` row of type `EXPENSE`:
  - `metadata_json.is_auto = true`, derived from the link;
  - `extra_metadata.payout_rounding_usd` / `payout_rounding_lbp`.
- No `payments` row and no drawer movement (books-only).

## Lifecycle

```
payout saved ──► expense ACTIVE (Expenses page, Expenses Deducted, hidden in Transactions by default)
payout voided/refunded ──► expense voided (generic cascade; Hold Money: voidPickup → voidLinkedExpenses)
```

## Customer-pays extra

There is no change to the data model. A filled-in extra is saved exactly like a typed LIRA-319 extra (`extra_usd` / `extra_lbp`).
