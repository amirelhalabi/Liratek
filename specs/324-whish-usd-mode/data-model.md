# Data model — LIRA-324 Whish App USD mode

## `mobile_service_items` (changed — migration v218)

| column | type | new? | rule |
|---|---|---|---|
| `cost_lbp` | REAL NOT NULL DEFAULT 0 | — | unchanged; `0` on USD-only items |
| `sell_lbp` | REAL NOT NULL DEFAULT 0 | — | unchanged; `0` on USD-only items |
| `cost_usd` | REAL NULL | **yes** | USD price Whish charges the shop; `NULL` = not sold in USD |
| `sell_usd` | REAL NULL | **yes** | shop's USD selling price; starts = `cost_usd` (owner rule) |

All other columns unchanged. No index or unique-key change (`UNIQUE(tenant_id, provider, category, subcategory, label)` stays).

**Validation** (core create/update schemas, shared by IPC + REST):
- `cost_usd`, `sell_usd`: `number ≥ 0`, nullable, optional (update: `null` clears).
- Either both set or both cleared is NOT enforced in the schema; an item with only one is simply not USD-sellable (spec edge case).

## Sellability (one definition, core, browser-safe)

```
isUsdSellable(item) = cost_usd > 0 AND sell_usd > 0
                      AND NOT (category IN ('alfa','mtc') AND subcategory = 'Prepaid')
isLbpSellable(item) = NOT (cost_lbp = 0 AND sell_lbp = 0 AND cost_usd > 0)
```

LBP mode shows `isLbpSellable` (= everything shown today minus USD-only rows); USD mode shows `isUsdSellable`. Only the WHISH_APP grid uses USD mode in this release.

## Frontend `ServiceItem` (changed)

Adds `catalogCostUsd?: number`, `catalogSellPriceUsd?: number` (from `cost_usd`/`sell_usd`). Existing `catalogCost`/`catalogSellPrice` remain the LBP pair.

## Starting catalog `ItemPricing` / `SeedItem` (changed)

`ItemPricing` gains optional `cost_usd?: string`, `sell_usd?: string`; `SeedItem` gains `cost_usd?: number | null`, `sell_usd?: number | null`. USD-only WHISH_APP items are written with `cost: "0", sell: "0"`.

## Sale record (unchanged shape)

A USD-mode sale is an ordinary cost/price `financial_services` + `transactions` row with `currency = 'USD'`:

| effect | where | currency |
|---|---|---|
| cost out | `payments` row on drawer `Whish_App`, amount `−cost_usd × qty` | USD |
| price in | customer legs per their own currency (cash, LBP at rate, split) | per leg |
| profit | `transactions.profit_usd = sell − cost` | USD |
| partner (For Partner) | `partner_ledger` delta = price | USD |
| session basket | cart entry `currency = 'USD'`, sub-items `currency = 'USD'` | USD |

**Invariant (per sale, Feature Guide §13 item 14):** `Δ Whish_App(USD) = −cost`, `Σ customer-leg drawer deltas (converted) = price + extra − change`, `profit_usd = price − cost` (+ kept change/extra as today). Sale + void ⇒ every one of these nets to 0 per currency.

## Per-device preference

`localStorage['liratek:whish-bills-currency'] ∈ {"LBP","USD"}`; absent/invalid/unreadable → `"LBP"`.

## Migration v218 — `whish_app_usd_prices`

- **up**: add `cost_usd`, `sell_usd` (if missing). For each tenant that already has catalog rows: set `cost_usd = X, sell_usd = X` on WHISH_APP rows matching `(category, subcategory, label)` from the frozen list **where `cost_usd IS NULL`**; insert missing USD-only items (`cost_lbp = 0, sell_lbp = 0`, `sort_order` after the category's max). Tenants with no catalog rows are skipped.
- **down**: null the USD pair on rows still equal to what v218 wrote; delete USD-only rows still unchanged and not referenced by `wrong_number_cards` / `resale_line_recharges`; drop the two columns.
- `create_db.sql`: the two columns in the table + the `(218, 'whish_app_usd_prices')` seed row.
