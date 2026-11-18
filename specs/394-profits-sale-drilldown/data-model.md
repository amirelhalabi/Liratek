# Data model — LIRA-394

No schema change. `SaleDetailRow` (repository → service, internal):

| Field | Change |
|---|---|
| `paid_total_usd` | removed (was `saleTotalPaidUsdEquiv`, net of the extra — display misuse) |
| `paid_usd_equiv` | new — `salePaidUsdEquiv("s")`, gross paid in USD-equivalent |
| `owed_usd_equiv` | new — `saleOwedUsdEquiv("s")`, final + net extra |
| `refunded_arm` | new — 1 for rows from `getRefundedSalesDetail`, 0 otherwise |
| `items_summary` | refunded arm: original line names `name xqty` (was `NULL`) |

`ProfitModuleDetailRow` (sent to the UI) shape unchanged; only `detail`/`reason` text differs.
