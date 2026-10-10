# Data model: Phone Katsh / iPick catalog sales (LIRA-302)

No schema change, no migration. All data already exists.

## Catalog item (existing table `mobile_service_items`, read-only here)

| Field           | Used for                                   | Rule on the phone                                    |
| --------------- | ------------------------------------------ | ---------------------------------------------------- |
| `id`            | list key                                   | —                                                    |
| `provider`      | `Katsh` or `iPick`                         | filter                                               |
| `category`      | grouping header, item name                 | —                                                    |
| `subcategory`   | item name suffix "(sub)"                   | optional                                             |
| `label`         | item name                                  | —                                                    |
| `cost_lbp`      | cart cost                                  | must be > 0, else the item is not offered            |
| `sell_lbp`      | cart price                                 | must be > 0, else the item is not offered            |
| `is_active`     | the route returns active items only        | —                                                    |
| Only-Days fields (`sell_days_lbp`, `sell_credit_lbp`, `max_returned_credits_usd`, `credits`, `validity_days`) | — | never read on the phone (FR-011) |

Display name = `formatCatalogItemName(item)` = `"<category>: <label>"` + `" (<subcategory>)"` when present (moved to
core, same text as the web).

## Cart (phone memory only)

- `lines: { item, quantity }[]`, quantity an integer ≥ 1; one line per item (adding again raises its quantity).
- Totals: `price = Σ sell_lbp × qty`, `cost = Σ cost_lbp × qty` (LBP).
- Survives a tab switch (LIRA-300); cleared after a successful save; kept on failure.
- Re-checked on Save (spec edge case): the catalog is re-fetched; every line must still exist with the same
  `cost_lbp` and `sell_lbp`, else Save is blocked and the line is flagged. The booked sale carries no item ids, so
  the server cannot catch a stale line — this check is the only guard.

## Payment

- `method ∈ { CUSTOMER_ACCOUNT, WHISH, OMT }`, `currency ∈ { LBP, USD }`.
- LBP: leg amount = `price`.
- USD: leg amount = `round2(price ÷ buyRate)` (rule confirmed against the web in tasks), `tender_exchange_rate =
  buyRate`. Unavailable without a loaded rate.
- Client: required for `CUSTOMER_ACCOUNT`, optional otherwise.

## Booked sale (existing `financial_services` + `transactions`, written by the existing repository)

Built by `buildCatalogSalePayload` → `CreateFinancialServicePayload`:

| Field                  | Value                                                                    |
| ---------------------- | ------------------------------------------------------------------------ |
| `provider`             | `Katsh` \| `iPick`                                                       |
| `serviceType`          | `"SEND"`                                                                 |
| `currency`             | `"LBP"`                                                                  |
| `amount`               | `price`                                                                  |
| `cost`                 | `cost`                                                                   |
| `commission`           | `max(0, price − cost)`                                                   |
| `note`                 | display names, `" xN"` when qty > 1, joined by `", "`                     |
| `paidByMethod`         | the method                                                               |
| `payments`             | `[{ method, currencyCode, amount }]`                                     |
| `checkoutTotal`        | `{ usd: 0, lbp: price }`                                                 |
| `tender_exchange_rate` | `buyRate` (USD payments only)                                            |
| `clientId`/`clientName`| when a client is chosen                                                  |

Web extras layered on top in `KatshForm` only: discount (lowers `amount`), `telecomCreditReturns` (Only-Days),
`split_group`/`split_role`/`split_units`, `kept_change_*`, `deferPayment`, For-Partner fields, `transaction_time`.

## Money effects (per sale; asserted as deltas in the money test)

| Ledger                    | LBP payment                     | USD payment                          |
| ------------------------- | ------------------------------- | ------------------------------------ |
| Provider drawer (Katsh/iPick, LBP) | −cost                  | −cost                                |
| Whish_App / OMT_App drawer | +price LBP (wallet payment)    | +USD amount (wallet payment)         |
| Customer debt             | +price LBP (on account)         | +USD amount (verified 2026-10-10 by T012: the debt is booked in the leg's currency) |
| Profit                    | price − cost                    | price − cost                         |
| Void / refund             | every line above back to 0      | every line above back to 0           |
