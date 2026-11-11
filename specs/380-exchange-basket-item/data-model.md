# Data model — LIRA-380

No migration. Existing tables, new usage:

## session_cart_items (basket line)

| column | value for an exchange line |
|---|---|
| module | `exchange` |
| ipc_channel | `exchange:add-transaction` |
| label | "Exchange $100 → 8,950,000 LBP @ 89,500" (rate shown, read-only) |
| amount / currency | the customer's USD/LBP **given** side (+); if that side is another currency, the USD/LBP received side (−); 0 USD if neither side is USD/LBP — `sessionExchangeCartAmount` |
| form_data | `ExchangeSubmitPayload` without any payment-side field (see contracts/basket-line.md) |

## customer_session_transactions (written at checkout)

| column | value |
|---|---|
| transaction_type | `exchange` |
| amount_usd / amount_lbp | `sessionExchangeLineLink`: given side +, received side −, per currency (USD/LBP sides only) |
| profit_usd | the exchange's booked margin (`bookedProfitUsd`, lot-adjusted) |
| profit_lbp | 0 |

## transactions (EXCHANGE row, written at checkout)

- `exchange_rate` = the line's `leg1Rate` (never the checkout rate)
- `details_json.paid_in_session` = session id; `payment_snapshot_json.session_id` = session id
- no `payments` rows with its `transaction_id` for USD/LBP sides; an exotic side keeps its single CASH lump

## State

```
Exchange page Confirm (session)  ->  basket line (nothing booked)
   remove line / cancel session  ->  nothing ever booked
   checkout                      ->  EXCHANGE booked + linked + pooled legs + lots consumed
   whole-basket void/refund      ->  generic EXCHANGE reversal + pooled legs reversed once
```
