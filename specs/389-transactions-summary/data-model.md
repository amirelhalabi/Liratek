# Data model — LIRA-389

No table changes. All shapes are request/response types (core `validators/transactionSummary.ts`
and `utils/transactionListFilter.ts`).

## TransactionListOption (one selected Type-filter option, as the server needs it)

| Field | Type | Notes |
| --- | --- | --- |
| type | TransactionType? | absent = untyped option (Cash only) |
| provider, service_type | string? | tuple match |
| has_item_key | boolean? | tuple match |
| paid_via_drawer | PaidViaDrawer? | wallet options |
| paid_via_account, paid_via_voucher | boolean? | Debts / Vouchers options |
| cash_only | boolean? | Cash only (till) |
| supplier_credit_only | boolean? | Supplier Credit |

The frontend's `FilterOption` = `TransactionListOption & { label }`.

## TransactionSummaryRequest (`transactionSummarySchema`, input type `TransactionSummaryInput`)

| Field | Type | Rule |
| --- | --- | --- |
| group_by | "type" \| "service" \| "product" \| "category" | required |
| include_refunded | boolean | default false |
| options | TransactionListOption[] (≤ 50) | empty = All types |
| search | string? (≤ 200) | the list's search text |
| day_from, day_to | `YYYY-MM-DD`? | the operator's days (rule 27) |

## TransactionSummaryResult

| Field | Type | Notes |
| --- | --- | --- |
| group_by | as requested | |
| rows | TransactionSummaryRow[] | sorted by Count desc, then label |
| total | { count, units?, volume_usd, volume_lbp } | count per research R3 |
| truncated | boolean | true when the 100,000-row cap was hit |

### TransactionSummaryRow

| Field | Type | Notes |
| --- | --- | --- |
| key | string | module key / service title / `product:<id>` / `category:<name>` or `category:` |
| label | string | English; translated in the page (modules via `audit:summary.modules.*`, service titles via `translateTitle`) |
| count | number | transactions (product/category: sales containing it) |
| units | number \| null | product/category only |
| volume_usd, volume_lbp | number | 0 shown as "—" |
| product_id | number? | product rows (drill) |
| category | string \| null? | category rows (drill; null = no category) |
| deleted | boolean? | product rows: product is deleted |

## Drill (list)

`{ dimension: "type", key }` | `{ dimension: "service", key }` |
`{ dimension: "product", productId, label }` | `{ dimension: "category", category, label }`.
Product/category reach SQL as `getRecent` filters `sale_product_id` / `sale_category`.
