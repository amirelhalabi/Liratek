# Data Model: Send the receipt on WhatsApp (LIRA-333)

**No schema change, no migration.** Everything below is either an in-memory shape or a read-only field added to an existing read.

## SaleDetail (read model, extended)

This is returned by `SalesService.getSale(id)` → `SalesRepository.getSaleWithCustomer(id)`, which serves both IPC `sales:get` and REST `GET /api/sales/:id`.

| Field | Source | New? | Notes |
|---|---|---|---|
| `id`, `status`, `created_at`, `total_amount_usd`, `discount_usd`, `final_amount_usd`, `paid_usd`, `paid_lbp`, `change_given_usd`, `change_given_lbp`, `exchange_rate_snapshot`, `note` | `sales` | no | `paid_*` = drawer tender, BUT later raised by debt repayment, so NOT used by the receipt (research R2) |
| `extra_usd` | `transactions` (SALE row) | no | LIRA-319 |
| `client_name`, `client_phone` | `COALESCE(c.…, t.…)` | no | **unchanged** display fields |
| `sale_phone` | `t.client_phone` | **yes** | phone saved with the sale (FR-012 #1) |
| `linked_client_phone` | `c.phone_number` | **yes** | linked client's phone (FR-012 #2) |
| `gift_card_usd` | `SUM(vouchers.amount) WHERE redeemed_transaction_id = SALE txn` | **yes** | 0 when none |
| `tender_usd`, `tender_lbp` | `SUM(payments.amount) WHERE transaction_id = SALE txn AND amount > 0`, per currency | **yes** | written once at sale time; unlike `paid_*`, never changed by a repayment |
| `on_account_usd` | `MAX(0, SUM(debt_ledger.amount_usd WHERE transaction_type='Sale Debt' AND transaction_id = SALE txn AND amount_usd > 0) − gift_card_usd)` | **yes** | original charge only; refund reversals (negative) excluded; never counted as paid (FR-008) |

Every added subquery is tenant-scoped (`tenant_id = ?`). The 'Sale Debt' and voucher predicates are named SQL fragments, defined once (rule 14).

## ReceiptData (frontend, extended)

`frontend/src/features/sales/utils/receiptFormatter.ts`: the existing interface gains one field.
- `gift_card_usd?: number`: printed as "Gift card" on paper and in WhatsApp; omitted when 0.

`on_account_usd`/`on_account_lbp` already exist. The saved-sale builder fills `on_account_usd` and leaves `on_account_lbp` at 0 (R3).

## buildSaleReceiptData(sale, items, shop) → ReceiptData

This is the one description (FR-006). It maps fields as follows:

| ReceiptData field | Value |
|---|---|
| `receipt_number` | `receiptNumberFor(sale.id)` |
| `timestamp` | `sale.created_at` |
| `exchange_rate` | `sale.exchange_rate_snapshot` |
| `items[].warranty_until` | stamped `sale_items.warranty_until` |
| `total` | `final_amount_usd + extra_usd` |
| `payment_*` | `tender_usd` / `tender_lbp` |
| `gift_card_usd` | the read field |
| `on_account_usd` | the read field |
| `change_*` | `change_given_*` |
| `client_name` | `sale.client_name \|\| "Walk-in Customer"` |
| `client_phone` | `recipientPhoneFor(sale) ?? ""` |
| shop fields | `useShopName()`/shop info, as today |

## Recipient number

`recipientPhoneFor(sale) = sale.sale_phone?.trim() || sale.linked_client_phone?.trim() || null`. When it is null, the cashier types a number.

`toWhatsAppNumber(raw)` (core, pure) returns `{ ok: true, digits } | { ok: false, reason: "empty" | "invalid" }` (rules in research R6). A typed number lives only in component state and is never persisted (FR-013).

## WhatsApp link

`https://wa.me/<digits>?text=<encodeURIComponent(formatReceiptWhatsApp(data))>`. This is built by one function, `buildWhatsAppLink(digits, text)`, next to the formatter.

## State: post-sale strip (POS screen)

```
hidden ──Complete Sale success(result.id)──▶ shown{saleId, data: loading}
shown{loading} ──getSale+getSaleItems ok──▶ shown{data: ready}   (Send enabled)
shown{loading} ──fetch fails──▶ shown{data: error}               (Send disabled + "Could not load receipt")
shown ──cart gets first item / draft resumed / checkout opens──▶ hidden
shown ──another Complete Sale──▶ shown{new saleId}
```

Nothing in this feature writes to any table (FR-023).
