# Data Model: Phone Lines Management (LIRA-309)

Migration **v211**: re-check the last entry in
`packages/core/src/db/migrations/index.ts` at build time. Both tables also go
into `electron-app/create_db.sql`, each with a `down()`. Every table has
`id`, `tenant_id`, `created_at` and `updated_at`.

## resale_lines (new)

The details of one for-sale phone line, one-to-one with its inventory product.

| Column | Type | Rule |
|---|---|---|
| id | INTEGER PK | |
| tenant_id | INTEGER FK tenants | every query filters on it |
| product_id | INTEGER NOT NULL FK products | UNIQUE per tenant |
| carrier | TEXT NOT NULL | CHECK IN ('mtc','alfa') |
| credits | REAL NOT NULL DEFAULT 0 | ≥ 0; informational, never summed into drawers |
| validity_expires_at | TEXT NULL | `YYYY-MM-DD`; NULL means "No expiry set" |
| created_at / updated_at | DATETIME | |

Index: UNIQUE (`tenant_id`, `product_id`). The number is `products.barcode`,
stored normalised for a lines category by LIRA-207. It is not copied here
(rule 14).

**Validation**:
- The product's category passes `isPhoneLineCategoryName`.
- the product's barcode does not match an **active** `carrier_lines.phone_number`
  of the same tenant, compared by `normalizeLebanesePhone` (FR-005), and the
  reverse check runs on carrier-line create/update.
- Expiry, if given, is a real calendar date.

**Unsold**: the product has `is_active = 1` and `stock_quantity > 0`. Sold or
deleted lines drop out of the For sale list, alerts and detection.

**Backfill**: none is created automatically. Line products from before this
feature show "No expiry set" until the owner saves details. The details row
is created on first save. The owner picks the carrier. It is not guessed from
the prefix, because no prefix map exists and 03 numbers are on both carriers.

## resale_line_recharges (new)

One internal recharge of a for-sale line. This is the reversal record for
`LINE_RECHARGE`.

| Column | Type | Rule |
|---|---|---|
| id | INTEGER PK | |
| tenant_id | INTEGER FK | |
| transaction_id | INTEGER NOT NULL FK transactions | UNIQUE; the `LINE_RECHARGE` row |
| resale_line_id | INTEGER NOT NULL FK resale_lines | |
| product_id | INTEGER NOT NULL FK products | denormalised for the sold-check |
| source | TEXT NOT NULL | CHECK IN ('CARD','SHOP_LINE_CREDIT','DAYS') |
| days_added | INTEGER NOT NULL DEFAULT 0 | ≥ 0 |
| credits_added | REAL NOT NULL DEFAULT 0 | ≥ 0; at least one of days/credits > 0 |
| cost_usd | REAL NOT NULL | > 0; the capitalized amount *c* |
| source_carrier_line_id | INTEGER NULL FK carrier_lines | set for SHOP_LINE_CREDIT and DAYS |
| mobile_service_item_id | INTEGER NULL FK mobile_service_items | set for CARD |
| prev_cost_usd / prev_price_usd | REAL NOT NULL | audit only (reversal uses the delta) |
| prev_validity_expires_at | TEXT NULL | restored on void |
| prev_credits | REAL NOT NULL | restored on void |
| batch_id | INTEGER NULL FK product_stock_batches | the batch whose `unit_cost_usd` was raised; NULL for legacy |
| is_reversed | INTEGER NOT NULL DEFAULT 0 | set by the void step |
| created_at / updated_at | DATETIME | |

Index: (`tenant_id`, `resale_line_id`, `is_reversed`, `id`), for the LIFO check.

## Changed: existing rows touched per recharge (no schema change)

| Row | Change | Reversed by |
|---|---|---|
| `products.cost_price_usd`, `selling_price_usd` | `+ c` | `_reverseResaleLineRecharge` (`- c`) |
| `product_stock_batches.unit_cost_usd` (the one open batch) | `+ c` | same |
| `resale_lines.validity_expires_at` / `credits` | projected / `+ credits_added` | same (restore `prev_*`) |
| `carrier_lines` (source shop line), plus a `carrier_line_movements` row | SHOP_LINE_CREDIT: credits `-(amount+sms)`; DAYS: validity `-days`, credits `-daysCost`, `days_owed` as today | existing `_reverseCarrierLineMovements` |
| MTC/Alfa drawer leg | SHOP_LINE_CREDIT / DAYS: same amount as the line credit move | existing `_reversePayments` |
| iPick/Katsh drawer leg | CARD: `-cost_lbp` | `_reversePayments` |
| `transactions` | one `LINE_RECHARGE` row, `profit_usd = 0`, `exchange_rate` stamped | generic void/refund |

**Ledger invariant per recharge** (FEATURE_GUIDE §13 item 14):

`Δ inventory value (+c) = Σ source decrease at cost`

Per source:
- CARD: provider drawer −cost.
- SHOP_LINE_CREDIT: credit at cost rate + SMS fee.
- DAYS: days cost.

There is no supplier or partner ledger row, and no expense row. Proven
net-zero after void in one test per source.

## Derived (not stored)

**LineStatus**: `classifyLineStatus(validity_expires_at, today)` in
`packages/core/src/utils/lineStatus.ts`. It is a thin layer over the existing
`classifyLineValidity`, so the grace boundary lives in one place:

| Days to expiry *d* | Status |
|---|---|
| no expiry | NO_EXPIRY |
| d > window | OK |
| 0 ≤ d ≤ window | EXPIRING |
| −5 ≤ d < 0 | IN_GRACE (days left to save it = 5 + d) |
| d < −5 | LOST |

The window is `RESALE_LINE_EXPIRY_WARNING_DAYS = 3` for for-sale lines and
`SHOP_LINE_EXPIRY_WARNING_DAYS = 7` for shop lines; grace is
`LINE_REVIVAL_GRACE_DAYS = 5` (existing). `today` is the client's
`localDay()`.

**LineExpiryAlert**: lines with status EXPIRING or IN_GRACE, plus unsold
for-sale lines in LOST (write-off prompt). Recomputed on the Dashboard and in
TopBar from the two line lists; never stored.

## State transitions (for-sale line)

```
          create details           recharge (days)          sold at POS
 NO_EXPIRY ───────────────▶ OK ◀──────────────────── EXPIRING / IN_GRACE ──▶ (leaves list)
                            │  time passes                 ▲
                            ▼                              │ recharge
                         EXPIRING ──▶ IN_GRACE ──▶ LOST ───┘ (refused once LOST)
                                                     │
                                                     └─ Write off (EXPENSE_INVENTORY) ─▶ stock 0, loss booked
```
