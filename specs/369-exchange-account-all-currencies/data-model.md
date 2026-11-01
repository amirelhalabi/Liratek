# Data model: LIRA-369

**No migration.** All changes are to existing tables and JSON details.

| Store | Change |
|---|---|
| `debt_ledger` | A new use of the existing `'Exchange Debt'` (customer side, any currency) and `CREDIT_DEPOSIT` (payout side) rows. They are linked by `transaction_id` = exchange transaction id. `amount_usd` / `amount_lbp` only; a converted line is stored in USD. The `note` carries the snapshot `"<amount> <CUR> @ <rate> = $<usd>"`. |
| `payments` | No row for an account leg (no drawer moves). CASH legs are written as today, in their own currency. |
| `transactions.metadata_json` / exchange details | `account_conversion?: Array<{ side: "customer" \| "payout", currency, amount, rate, usd }>`. This is a snapshot taken when saving (R7). |
| `exchange_lots` | Acquire/consume quantity = physically moved quantity only (R6). Unit cost and proceeds are unchanged. |
| `exchange_transactions` / `transactions` profit | The margin includes the typed-rate gap `±q·(t − r)` (0 with the seeded rate). Profits reports it as pending while an `'Exchange Debt'` on the exchange is open (R6b). |
| `drawer_balances` | Moved only by drawer legs. |

## Invariant (per currency, per exchange) — proven create + void = 0

```
Σ drawer deltas  +  Σ client account deltas (debt +, credit −)
   = amountIn (customer side, at its own currency or USD for converted lines)
   − amountOut (payout side, same rule)
   + typed-rate gap (USD, part of the margin)
lot qty change(cur) = drawer delta(cur)   for every tracked cur
```

## Validation rules

- An account line on either side requires `clientId` (UI and server).
- `*_account_usd_rate` > 0. It is required if and only if that side has a non-USD/LBP account line.
- Native payout mode: legs are in `toCurrency` only; methods are CASH and CUSTOMER_ACCOUNT only; no keep/round/added/tender rate.
- Partner mode refuses every one of these keys (unchanged).
