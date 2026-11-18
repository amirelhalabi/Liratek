# Data model — LIRA-396

No schema change and no migration. These read-model values change:

| Read model | Field | Before | After |
|---|---|---|---|
| `FinancialServiceDetailRow` (transfer) | `detail` | `fs.service_type` | `transactions.summary`, falling back to `service_type` |
| `FinancialServiceDetailRow` (transfer) | `cost_usd`/`cost_lbp` | `fs.cost` | the same, except for a row with a `CREDIT_RETURN` leg: `revenue − stamped profit` |
| `FinancialServiceDetailRow` (allocation) | `detail` | `fs.service_type` | the transfer's summary, falling back to `service_type` |
| `MaintenanceDetailRow` | `device_name` (used as the detail) | raw, may be blank | device → summary → "Repair job #id" |
| `CustomServiceDetailRow` | `description` (used as the detail) | raw, may be blank | description → summary → "Custom service #id" |
| `LotoDetailRow` | new `summary` | — | `transactions.summary` |
| `ProfitOnlyDetailRow` (TOPUP_BUYBACK) | `counterpart_name`/`_phone` | `recharges` only | `recharges`, falling back to `transactions` |
| `ModuleTransactionDetail` KEPT_CHANGE / TOPUP_BUYBACK | rows | every row | rows with 0 profit in both currencies are not listed |

Stored data that is deliberately NOT changed: `financial_services.cost` (gross, which supplier views and the drawer leg read), `commission`, `transactions.profit_*`, payments, `supplier_ledger`, `carrier_line_movements`.
