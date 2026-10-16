# Data Model: LIRA-326

No schema change.

| Entity | Storage | Notes |
|---|---|---|
| Unpaid basket | frontend memory (`RechargeBasketContext`) | groups `catalog` (iPick+Katsh) and `whish` (Whish App); lines keyed by item key; lost on reload (FR-014) |
| PricedLine | frontend memory | `{ key, provider, sheetItem, currency, amount, commission, cost, subItem }` — `subItem` is the session `_batch` sub-item formData |
| Basket payment / link | `customer_sessions` (+ `session_transactions`) | one session per paid mixed basket; `customer_notes = "Mobile Recharge basket"` |
| Provider sale | `financial_services` + `transactions` | one row per sub-item as today's batch session checkout writes; provider = the line's own provider |
