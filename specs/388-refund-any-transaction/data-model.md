# Data model: Refund any transaction (LIRA-388)

## Migration v232 — `hold_money`

| Column      | Type                              | Meaning                                                                     |
| ----------- | --------------------------------- | --------------------------------------------------------------------------- |
| `voided_at` | DATETIME NULL                     | set when the drop-off is refunded from the Transactions page (requestNow()) |
| `voided_by` | INTEGER NULL REFERENCES users(id) | who refunded it                                                             |

A voided hold leaves `getActive()`, and `collectHold` refuses it. `down()` drops both columns. Same columns in `electron-app/create_db.sql`.

## `transactions` (no column change)

- REFUND row (generic owner): `reverses_id` → original; `metadata_json.refundType = "standalone"` for the 13 newly owned generic types (`"bookkeeping"` for confirm-kind rows), plus the existing `exchangeRate`/`reversal` details.
- Page-owned reversal rows keep their own types (HOLD_MONEY_COLLECT_VOID, VOUCHER_CANCEL, WARRANTY_COST reversal).
- CARRIER_LINE_ADJUSTMENT `metadata_json` gains `credits_before`, `credits_after` (numbers) from now on.

## Ledger effects per refund (each nets to 0 per currency with its original)

- `payments` / `drawer_balances`: mirrored legs on the REFUND row (or the override legs).
- `debt_ledger`: 'Refund Reversal' rows for CREDIT_DEPOSIT / CREDIT_USED / 'Manual Debt' linked to the original; 'Discount Reversal' for a client discount.
- `partner_ledger`: opposite-direction row referencing the original entry; coverage given back exactly.
- `supplier_ledger`: `is_refunded = 1` soft-void (adjustment, discount, loto CASH_PRIZE).
- `loto_cash_prizes.voided = 1`; open checkpoint totals −prize.
- `loto_monthly_fees.is_paid = 0, paid_date = NULL`.
- `exchange_lots`: lots of the drawer top-up voided.
- `carrier_lines.credits = credits_before`.
- `hold_money.voided_at` (drop-off); pickups via `voidPickup`; vouchers via `cancelVoucher`; warranty claims via `voidClaim`.

## Classification (core leaf `refundKinds.ts`)

```
RefundOwner = "generic" | "holdPickup" | "voucher" | "warranty"
RefundKind  = "window" | "confirm" | "none"
RefundPlan  = { kind, owner?, direction?: "to_customer" | "from_customer", reason?: NonRefundableReason }
```
