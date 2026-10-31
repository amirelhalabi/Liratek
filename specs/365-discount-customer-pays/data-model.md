# Data model: LIRA-365

**No migration.** All new data lives in existing columns: `expenses.category` (free text), `transactions.metadata_json` (details), and the module columns. The Note part moved to `specs/366-payment-note/`.

## Discount (on one transaction)

| Where | Field | Rule |
|---|---|---|
| Financial create payload | `discount_amount` number ≥ 0, in the send's `currency` | OMT/WHISH, SEND, not FOR, not `deferPayment`. `discount_amount + customer_waived_amount ≤ SHORTFALL_MAX[currency]`, and `< amount + fee` |
| Exchange create payload | the existing `customer_waived_amount` | Unchanged rules; the Discount line feeds it |
| Voucher sell payload | `discount_amount` number ≥ 0, in the sale currency | `≤ SHORTFALL_MAX[currency]`, `< face value`. The VOUCHER_SALE transaction amount = face value − discount; the voucher keeps its face value |
| `details.discount` | `{ amount, currency }` | Written for all three (common field) |

## "Discount given" expense (OMT/Whish send, voucher sale)

An existing `expenses` row:
- `category = "Discount_Given"` (constant `DISCOUNT_GIVEN_EXPENSE_CATEGORY`)
- amount in the discount's currency
- `books_only` (no payment row, no drawer movement)
- `source_ref_table` / `source_ref_id` point at the parent: `financial_services` or `vouchers`
- `is_auto = true`, derived from that link by `createExpense`
- date and time = the parent's (backdated parents included)

**Lifecycle**: created in the parent's DB transaction and voided with the parent.

| Parent | Reversal owner |
|---|---|
| OMT/Whish send | `TransactionRepository._cascadeExpenseSiblingVoid` |
| Voucher | `VoucherRepository.cancelWithRefund` → `voidLinkedExpenses` |

