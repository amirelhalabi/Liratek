# Data model: LIRA-381

No table or column change.

## REFUND transaction (`transactions`, existing)

`metadata_json` keys written by a session item refund (existing unless marked):

| Key                                                                                                    | Meaning                                                                                                                    |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `refundType: "sessionItem"`, `sessionId`, `memberTransactionId`                                        | existing                                                                                                                   |
| `refundDirection` **(new)**                                                                            | `"to_customer"` (member was a charge) or `"from_customer"` (member was a payout)                                           |
| `accountAttributedUsd/Lbp`, `poolSplitUsd/Lbp`, `restoredFromPreexistingCreditUsd/Lbp`, `exchangeRate` | existing; 0 on a from_customer refund                                                                                      |
| `collectedUsd/Lbp` **(new)**                                                                           | from_customer only: value the customer gave back, per currency (drawer + account lines), read by the whole-basket residual |

## `customer_session_transactions` link row (existing)

`transaction_type = 'session_item_refund'`; `amount_usd/lbp` = exact negation of the member's own signed cst amounts (positive for a payout member).

## `debt_ledger` (existing table)

- `Session Item Refund` credit — existing (to_customer account-first).
- `Session Refund Debt` **(new value)** — from_customer account line: the customer owes the payout back. `transaction_id` = REFUND id. Classified in `MODULE_DEBT_TRANSACTION_TYPES` (repayment FIFO, aging). Reversal owner: the generic `_cancelDebt` keyed on the REFUND id; a REFUND row is final, so in practice none runs.

## `payments` (existing)

- to_customer: OUT rows on the REFUND id (existing).
- from_customer: IN rows on the REFUND id, one per drawer line (customer-pays writer).
- whole-basket reversal residual: one extra pooled row (`session_id` set, `transaction_id` NULL, note = basket reversal note) when needed.

## State

Member: live → reversed (REFUND row exists). Basket: closes as fully refunded when every member is reversed, no pending account marker, and the residual is ≤ 0 in every currency.
