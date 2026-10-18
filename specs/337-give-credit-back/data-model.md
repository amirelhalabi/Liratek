# Data Model: Give credit back (LIRA-337)

## New table `resale_line_give_backs` (migration v223)

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| tenant_id | INTEGER | tenants(id) |
| transaction_id | INTEGER NOT NULL UNIQUE | transactions(id), type `LINE_CREDIT_GIVE_BACK` |
| resale_line_id | INTEGER NOT NULL | resale_lines(id) |
| product_id | INTEGER NOT NULL | products(id) |
| carrier_line_id | INTEGER NOT NULL | carrier_lines(id): the shop line that received the credit |
| credits_sent | REAL NOT NULL CHECK > 0 | X, the credit received by the shop line |
| sms_fee_usd | REAL NOT NULL CHECK >= 0 | F |
| credit_sell_price_lbp | REAL NOT NULL CHECK > 0 | as typed |
| credit_cost_rate_lbp | REAL NOT NULL CHECK > 0 | server setting at the time |
| exchange_rate | REAL NOT NULL CHECK > 0 | |
| price_drop_usd | REAL NOT NULL CHECK >= 0 | |
| cost_drop_usd | REAL NOT NULL CHECK >= 0 | |
| prev_credits | REAL NOT NULL | restored on void |
| batch_id | INTEGER NULL | product_stock_batches(id) |
| is_reversed | INTEGER NOT NULL DEFAULT 0 | |
| created_at, updated_at | DATETIME | |

Index: `(tenant_id, resale_line_id, is_reversed, id)`.

## Changed rows per give-back

| Row | Change | Reversed by |
|---|---|---|
| transactions | +1 `LINE_CREDIT_GIVE_BACK` (amount_usd +X, profit 0) | status VOIDED |
| payments | +1 USD leg +X on carrier drawer | `_reversePayments` |
| drawer balance (MTC/Alfa) | +X | `_reversePayments` |
| carrier_lines.credits | +X | `_reverseCarrierLineMovements` |
| carrier_line_movements | +1 (reason `RESALE_GIVE_BACK`) | same |
| products.selling_price_usd | −price_drop | `_reverseResaleLineGiveBack` (+price_drop) |
| products.cost_price_usd | −cost_drop | same (+cost_drop) |
| product_stock_batches.unit_cost_usd | −cost_drop | same (+cost_drop) |
| resale_lines.credits | → prev − X − F | same (→ prev_credits) |
| resale_line_give_backs | +1 | same (is_reversed = 1) |

## State

`resale_line_give_backs.is_reversed`: 0 → 1 on void. A reversed row is never reopened.
