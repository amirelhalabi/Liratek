# Data model: LIRA-336

No migration.

| Wire field | Type | Rule |
| --- | --- | --- |
| `added_change_usd` / `added_change_lbp` | number ≥ 0, optional, no default | payout currency only; ≤ $5 / 450,000 LBP; = (customer drawer lines − what the customer owes), converted at the payout rate |
| `customerPayments` | existing `customerLegSchema[]` | newly accepted on credit buy-back, top-up from client, Hold Money collect, and OMT/WHISH system RECEIVE (the last only with a claim) |

**Rows written:** the customer's lines are written as `payments` rows (+, into their drawer) on the payout's own transaction, and the payout legs as `payments` rows (−). No expense, no debt and no profit change. The payment snapshot lists both.

**Lifecycle:** void or refund of the payout. `_reversePayments` (or Hold Money's `voidPickup`) mirrors every row, so each drawer nets to 0.
