# Data Model: Voucher transactions

## vouchers (existing) — migration v224
| Column | Change | Notes |
|---|---|---|
| redeemed_session_id | NEW `INTEGER NULL` | Stamped by `redeemByCode` when the redemption happens at session checkout. Cleared by `restoreRedeemedByTransaction`. Index `idx_vouchers_redeemed_session (tenant_id, redeemed_session_id)`. |

`down()` drops the index and the column (table rebuild if the SQLite version requires it, following the existing `add-migration` template). `create_db.sql` is updated to match.

States (unchanged): `pending → redeemed | cancelled`; `redeemed → pending` (purchase refunded). `expired` is derived only.
New rule: `pending → cancelled` is allowed only through `cancelWithRefund`, guarded by `WHERE status='pending'`.

## transactions (existing) — new types
| Type | Direction | source_table/id | amounts | profit | client | Reversible |
|---|---|---|---|---|---|---|
| VOUCHER_SALE | in | vouchers / voucher.id | face value in its currency (`amount_usd` or `amount_lbp`) | 0 / 0 | owner id+name+phone | No. Owner: cancelWithRefund |
| VOUCHER_CANCEL | out | vouchers / voucher.id | refund = the sale's amounts, or 0 for legacy vouchers (stored positive; direction comes from the type) | 0 / 0 | owner | No (terminal) |

`metadata_json`: `{ code, currency_code, kind: "voucher_sale" | "voucher_cancel", legacy?: true }`. `summary`: `Voucher sold GIFT-XXXX-XXXX` / `Voucher cancelled …`.

## debt_ledger (existing) — new charge type
| transaction_type | When | amounts | transaction_id | Reversal |
|---|---|---|---|---|
| 'Voucher Debt' | sale with CUSTOMER_ACCOUNT legs, one row per currency | + the on-account part | the VOUCHER_SALE id | cancel writes 'Refund Reversal' (negated, same transaction_id) through the shared helper; listed in MODULE_DEBT_TRANSACTION_TYPES |

## payments (existing)
- Sale: one row per IN leg (+amount, its drawer) and per OUT change leg (−amount, "Change returned"). All are posted by one loop.
- Cancel: one row per payout leg (−amount).
- Invariant per currency: Σ sale legs + Σ cancel legs = 0 for each drawer when the cash part goes back through the same method, and Σ debt_ledger(client) over 'Voucher Debt' + 'Refund Reversal' for the sale = 0.

## Type-filter tuple (validators/transaction.ts)
`paid_via_voucher?: boolean`. A row from `getRecent` gains `paid_via_voucher: boolean`.

## Read-only additions
`VoucherEntity.sale_usd` / `sale_lbp` (computed by `findSaleTotals`; 0/0 = legacy voucher, cancel refunds nothing).
