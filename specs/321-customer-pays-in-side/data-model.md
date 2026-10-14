# Data model: LIRA-321

No new tables. One column, one debt type, and new uses of existing rows.

## Schema change — migration v215

| Table | Change | Notes |
| --- | --- | --- |
| `exchange_transactions` | `client_id INTEGER NULL REFERENCES clients(id)` + index `idx_exchange_transactions_client_id (tenant_id, client_id)` | Set when the cashier links a client (required only when something is owed). `client_name` stays and is filled from the client. Both `migrations/index.ts` (v215, with `down()`) and `electron-app/create_db.sql`. |

The unified `transactions.client_id` already exists; the exchange write now fills it (rule 11).

## Entities and how they are written

### Customer line (`customerPayments[]` entry)
| Field | Type | Rule |
| --- | --- | --- |
| `method` | payment-method code | `CASH`, wallet methods, `CUSTOMER_ACCOUNT`; Exchange IN accepts every drawer method + `CUSTOMER_ACCOUNT` |
| `currencyCode` | string | Exchange: must equal `fromCurrency` (locked). App receive: USD/LBP for cash and wallets. Binance: USDT for the Binance line, USD/LBP for cash |
| `amount` | number > 0 | Lines summing to 0 are dropped by the page |

Section-level rules (enforced by `bookCustomerLegs`, R4): total ≤ expected (no overpay); total = expected, or shortfall covered by `CUSTOMER_ACCOUNT` lines (client required) or by a forgiven amount within $5 / 450,000 LBP.

### Payment rows (`payments` table, existing)
One row per non-account customer line, positive amount, in the line's drawer and currency. A line paid into the provider's own wallet on an app/Binance receive is stored with `method` = provider code (`WHISH_APP` / `OMT_APP` / `BINANCE`) so it stays an internal leg. Exchange lines replace today's single `CASH`/General lump.

### Client debt (`debt_ledger`, existing)
| Screen | `transaction_type` | Amount columns | Linked by |
| --- | --- | --- | --- |
| Exchange | `'Exchange Debt'` (new, added to `MODULE_DEBT_TRANSACTION_TYPES`) | `amount_usd` or `amount_lbp`, only when the customer pays in USD or LBP; owing/forgiving on a EUR/other `fromCurrency` is refused for now (owner 2026-10-14 — the lot would oversell) | `transaction_id` = unified transaction id |
| App receive / Binance | `'Service Debt'` (existing) | USD/LBP; a USDT shortfall counts 1:1 as USD | same |

Written once per transaction per currency by `bookClientDebtCharge` (30-day due date). Reversal owner: generic `_cancelDebt` on void and refund.

### Forgiven shortfall
On screen it is "Forgive"; in code and payloads it is "waived" (`customer_waived_amount`, `WAIVED_SHORTFALL`) — same thing.
Recorded with the existing LIRA-310 `WAIVED_SHORTFALL` profit-only row (writer in `repositories/keptChange.ts`), amount = forgiven part, capped by `isWithinShortfallMax`. Reversal owner: the existing LIRA-310 path (confirm in tasks, rule 20).

### Exchange transaction (`exchange_transactions` + unified `transactions`)
Unchanged amounts and profit stamp. New: `client_id` on both rows; `metadata_json` unchanged.

## State: "Customer pays" section (UI only)

```
seeded(single) ──type less──▶ split(+leftover line, CUSTOMER_ACCOUNT if offered else CASH)
seeded(split, 2 lines when amount + fee) ──edit──▶ split
split ──Split toggle off──▶ single (one line = full amount, re-seeded)
any ──total > expected──▶ overpaid (Confirm disabled)
any ──account line, no client──▶ needs client (Confirm disabled)
```

## Ledger nets (create + refund), per currency

| Case | Create | Refund | Net |
| --- | --- | --- | --- |
| Exchange $1,000 @ 89,500, pays 87,600,000 + owes 1,900,000 | LBP cash +87,600,000 · USD cash −1,000 · Exchange Debt +1,900,000 LBP | −87,600,000 · +1,000 · −1,900,000 | 0 / 0 / 0 |
| Whish App $100, $5 fee: Whish $90 + Cash $5 + Account $10 | Whish_App +90 · USD cash −100 +5 · Service Debt +$10 | −90 · +95 · −$10 | 0 / 0 / 0 |
| Binance 100 USDT, $2 fee: Binance 80 + Cash $2 + Account $20 | Binance +80 USDT · USD cash −98 · Service Debt +$20 | −80 · +98 · −$20 | 0 / 0 / 0 |
