# Research: Voucher transactions (LIRA-339)

## R1. Which precedent does the money flow follow?
- **Decision**: Hold Money (`HoldMoneyRepository.createHold` / collect). Like a voucher, it is a liability: it is paid in through legs, carries profit 0, has a module-owned lifecycle, and is gated non-reversible.
- **Rationale**: It already has the single posting loop, `reconcileLegs`, the fallback CASH leg, `payment_snapshot`, `resolveBackTimedDrawerMovement` and the client stamping. All of these have tests.
- **Alternatives**: Reuse `CREDIT_CASH_IN`, i.e. book the voucher as account credit at sale time. Rejected: the value is not usable credit until it is redeemed, and redemption already deposits it. Booking it at sale would double the credit.

## R2. Reversal owner (rule 20)
- **Decision**: `VoucherRepository.cancelWithRefund` is the only path that undoes a sale. `VOUCHER_SALE` and `VOUCHER_CANCEL` go into `NON_REVERSIBLE_TRANSACTION_TYPES`.
- **Rationale**: A generic void of the sale would leave the voucher pending (it is not in `_markSourceRefunded`). That would allow a double refund, or a refund of a voucher that was already spent.
- **Alternatives**: Make the sale voidable and have the void cancel the voucher. Rejected: there would be two owners for one obligation, and the void would need a redeemed-check hook in the generic path.

## R3. How much does a cancel refund?
- **Decision**: What the ACTIVE `VOUCHER_SALE` row for `source_table='vouchers' AND source_id=?` recorded. A legacy voucher with no row refunds 0.
- **Rationale**: This prevents paying out cash for vouchers that were given away before this feature (owner context: until now every voucher was created free).

## R4. "Paid with a voucher" detection
- **Decision**: Use the voucher's own link columns: `redeemed_transaction_id`, plus the new `redeemed_session_id`.
- **Rationale**: The session redemption passes `transactionId: null`, and the CREDIT_DEPOSIT carries no session id (`SessionPaymentService.ts:650`). So neither the debt-ledger nor the transaction link can see baskets. A column stamped from now on is the smallest reliable fix.
- **Known limit**: Refunding the purchase restores the voucher and clears both columns. The refunded purchase then drops out of the voucher tag (accepted in the spec's edge cases). Session redemptions made before v224 cannot be detected.
- **Alternatives**: Parse `payment_snapshot` for GIFT_CARD legs. Rejected: older rows lack a snapshot, and JSON scans over all transactions are expensive.

## R5. Profits
- **Decision**: Keep both types OUT of `PROFIT_TXN_TYPES` (ProfitRepository) and stamp profit 0.
- **Rationale**: Counting the sale as revenue would double revenue when the voucher-paid purchase books its own.

## R6. Tender restrictions
- **Decision (revised by owner 2026-10-24)**: Refuse GIFT_CARD legs. ACCEPT CUSTOMER_ACCOUNT legs, booked as a 'Voucher Debt' charge linked to the sale. Refuse kept, added and rounding change. `reconcileLegs` counts every IN leg, account legs included. The posting loop uses `isDrawerAffectingMethod` to route each leg to a drawer or to the account, so the guard and the loop agree (FEATURE_GUIDE §13 item 15).

## R7. Why the no-legs fallback stays
- **Decision**: When no legs are sent, create books ONE CASH leg for the face value in the voucher's currency. This is the same fallback as Hold Money.
- **Rationale**: The owner decided every voucher is sold (2026-10-24), so an old caller that sends no legs is still taking cash. A refusal would break the existing callers listed in T022 for no money-safety gain. The UI always sends legs.

## R8. Closing and checkpoints
- Verified: closing reads `drawer_balances` (ClosingRepository.ts:283), which `applyDrawerDelta` keeps current. No type list needs voucher types added.

## R9. Partly repaid on-account voucher, then cancelled
- **Decision**: Reverse the FULL 'Voucher Debt' with a 'Refund Reversal' row linked to the sale. A repaid part becomes account credit.
- **Rationale**: This is exactly what the generic `_cancelDebt` does for every other on-account charge (TransactionRepository.ts:9227), so customers see one rule everywhere. The per-currency net across `debt_ledger` is 0 for the sale and cancel pair, and the repayment stays a separate, already-banked movement.
- **Alternatives**: Pay the repaid part out as cash at cancel. Rejected: the shop would have to choose a payout for money that is sitting as a repayment, and it would diverge from the generic refund rule.

## R10. Where 'Voucher Debt' is classified
- **Decision**: Put it in `MODULE_DEBT_TRANSACTION_TYPES` (see plan decision 12).
