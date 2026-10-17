# Contract: sale read additions (both transports)

These are additions only to the existing reads; no request shape changes, and no new REST route.

| Transport | Call | Change |
|---|---|---|
| IPC | `sales:get` (id) | response object gains `sale_phone`, `linked_client_phone`, `tender_usd`, `tender_lbp`, `gift_card_usd`, `on_account_usd` |
| REST | `GET /api/sales/:id` → `{ success, sale }` | `sale` gains the same six fields |

Both transports call `SalesService.getSale` → `SalesRepository.getSaleWithCustomer`, so the fields are identical by construction.

The frontend `SaleDetail` interface (`SaleDetailModal.tsx`, ~L91) and any shared sale type gain the six fields as optional numbers or strings. A missing value (an older server during a deploy window) is read as 0 or null.

The existing `client_phone`/`client_name` semantics are unchanged.
