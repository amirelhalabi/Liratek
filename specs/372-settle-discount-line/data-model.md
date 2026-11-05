# Data model: Settle discount (LIRA-372)

**No migration.** Every ledger already has a DISCOUNT type (research R11).

## Settlement discount (logical entity, no new table)

| Field | Where it lives | Rule |
|---|---|---|
| amount per currency | the counterparty ledger's DISCOUNT row (`debt_ledger` 'Debt Discount', `supplier_ledger` 'DISCOUNT', `partner_ledger` 'DISCOUNT'), plus a `COUNTERPARTY_DISCOUNT` transaction (amount 0, signed profit) | 0 < amount ≤ `SHORTFALL_MAX[c]` ($5 / 450,000 LBP), inclusive, compared in its own currency, and ≤ what stays owed after the payment in that currency |
| direction | `buildCounterpartyDiscountPosting.discountDirection` | `received` when the shop pays (profit +); `forgiven` / "given" when the shop receives (profit −) |
| reason | ledger `note`, transaction details `note` (and the `ACCOUNT_SETTLE` details on Settle Account) | optional, ≤ 500 characters. Rule 31: the copies are a **snapshot as at saving time**. No edit path for a settlement discount's reason exists, and T001 confirms that no LIRA-366 note-edit path reaches these rows. If one does, that edit path becomes the update owner of every copy. |
| link to its settlement | supplier: `source_ref_table='supplier_ledger'`, `source_ref_id=<parent row>` (+ `settlement_id` on settles); partner: `reference_table='partner_ledger'`, `reference_id=<anchor>`; debt: same repayment transaction scope | reversal owner (rule 20) |

## Per screen: booking and reversal owner

| Screen | Direction(s) | Booking | Reversal owner |
|---|---|---|---|
| Debts Repay | shop receives | `_postDebtDiscount` | existing debt repayment void/refund (DEBT_REPAYMENT reversal and its COUNTERPARTY_DISCOUNT) |
| Supplier Pay | shop pays | `postSupplierBundledDiscount` received, FIFO coverage | `_reverseSupplierBundledDiscount`, with give-back |
| Supplier Receive (**new**) | shop receives | `postSupplierBundledDiscount` forgiven, **no** coverage | `_reverseSupplierBundledDiscount`, **give-back skipped for forgiven** (R5) |
| Supplier batch Settle | shop pays only (FR-002 exception) | bundled received, self-stamped | `_reverseSupplierBundledDiscount` (SUPPLIER_SETTLEMENT) |
| Supplier Settle Account / OMT | both | one DISCOUNT on the waived member | `_reverseSupplierBundledDiscount` + `_reverseSupplierSettlement` coverage relief |
| Partner by day | both | DISCOUNT partner_ledger CREDIT/DEBIT + `recordDiscount` | partner settlement sweep + `_negateCounterpartyDiscountProfit` |
| Partner by amount | both | same | same |

## State

A discount has no state of its own. It is active while its parent settlement is active, and it is voided with that parent: the ledger row is soft-voided or reversed, and the profit is negated by a new compensating `COUNTERPARTY_DISCOUNT` row.
