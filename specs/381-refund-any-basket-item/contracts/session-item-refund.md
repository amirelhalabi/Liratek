# Contract: session item refund (both transports)

Unchanged surfaces:

- IPC `transactions:refund-session-basket-item` / REST `POST /api/transactions/session-basket/:sessionId/items/refund` — input `sessionItemRefundSchema` (`packages/core/src/validators/transaction.ts`). **No key added or removed** (rule 23 three-way diff: schema = preload `data` type = REST body pick = handler forward).
- IPC `transactions:session-basket-item-refund-preview` / REST `GET …/items/refund-preview` — input `sessionItemRefundPreviewSchema`, output forwarded verbatim from `TransactionService.getSessionItemRefundPreview`.

## Meaning changes

| Field                                                 | to_customer member (charge)                       | from_customer member (payout)                                                                           |
| ----------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `refundLegs`                                          | money handed back (drawer methods only, as today) | the customer's lines: drawer methods **or `CUSTOMER_ACCOUNT`**; total value = payout at the refund rate |
| `kept_change_*`, `added_change_*`, `customerPayments` | as today                                          | refused                                                                                                 |
| `unitExtras`, `saleItemId`/`quantity`                 | SALE only, as today                               | refused (saleItemId: not a SALE)                                                                        |

A member paid on its own (`paidOnItsOwn`) or of a swap type refuses `refundLegs`: it is refunded exactly as it was paid.

## Preview output (`SessionItemRefundPreview`, additions)

| Field          | Type                               | Meaning                                                          |
| -------------- | ---------------------------------- | ---------------------------------------------------------------- |
| `direction`    | `"to_customer" \| "from_customer"` | which way the money moves                                        |
| `paidOnItsOwn` | `boolean`                          | member carries its own customer legs; UI skips the method window |

On `from_customer`, `defaultLegs` are IN legs (`direction: "in"`, positive `signed_amount`) — cash in the payout's own currencies — and `accountReduction*` are 0.

## Result (`RefundSessionBasketItemResult`, addition)

`direction` as above (stored on the REFUND row as `metadata_json.refundDirection`).

## Refusals kept (same text)

waived-shortfall basket, settled loto ticket / prize, settled supplier sibling, sold exchange lot, already refunded member, fully refunded / whole-reversed basket, `saleItemId` on a non-SALE member. New refusal: a basket-level sibling (kept change, waived amount, extra, basket discount) — "… is part of the basket's checkout, not an item — refund the whole basket instead."
