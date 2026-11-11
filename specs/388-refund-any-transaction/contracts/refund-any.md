# Contract: one refund entry point (LIRA-388)

Unchanged wire shape — `transactionRefundSchema` (`packages/core/src/validators/transaction.ts`):

- IPC `transactions:refund` — `requireRole(["admin", "staff"])` (was admin), `validatePayload(TransactionRefundSchema)`.
- REST `POST /api/transactions/:id/refund` — `authenticateJWT` → `requireRole(["admin", "staff"])` (was admin); body `{ refundLegs?, refundUnitExtras?, exchangeRate?, keptChange?, addedChange? }`; HTTP 200 envelope.
- Adapter `refundTransaction(id, refundLegs?, …)` unchanged.

Behaviour by `refundPlanOf(row)`:

| plan              | server does                                                                               | body used                |
| ----------------- | ----------------------------------------------------------------------------------------- | ------------------------ |
| generic (window)  | `_refundTransactionInternal(id, { allowOwnedRefund })`                                    | all fields               |
| generic (confirm) | same, no legs                                                                             | none (legs refused)      |
| holdPickup        | `HoldMoneyService.voidPickup(pickupId, userId)`                                           | none                     |
| voucher           | `VoucherService.cancelVoucher(source_id, { payments: refundLegs mapped, exchange_rate })` | refundLegs, exchangeRate |
| warranty          | `WarrantyService.voidClaim({ claim_id: source_id }, actor)`                               | none                     |
| none              | `{ success: false, error: <reason> }`                                                     | —                        |

Response: `{ success: true, refundId }` (page-owned: the id of the row the owner wrote) | `{ success: false, error }`.

`transactions:void` is unchanged and keeps refusing every type in `NON_REVERSIBLE_TRANSACTION_TYPES`.
