# Contract — two new `getRecent` filter keys (list drill-down)

| Key | Type | Meaning |
| --- | --- | --- |
| `sale_product_id` | positive int | only SALE rows whose sale has a line of this product |
| `sale_category` | string \| null | only SALE rows whose sale has a line whose display category (`COALESCE(pc.name, p.category)`) equals it; `null` = no category |

- Schema: core `transactionSaleDrillFiltersSchema` (both transports).
- IPC `transactions:get-recent`: validated and merged like the LIRA-348 paging keys; malformed → thrown error (refused, never dropped).
- REST `GET /api/transactions/recent`: `sale_product_id` (number text) and `sale_category` (JSON: a string or `null`) parsed through the same schema; malformed → `{ success: false, error }`, HTTP 200.
- Web adapter: `sale_category` JSON-encoded (so `null` survives a query string).
