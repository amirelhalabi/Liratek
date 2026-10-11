# Data model: Waive on every payment page (LIRA-310)

No migration. No new table and no new column. Everything below is a new **payload field**, a new **transaction type value**, or a new use of an existing ledger `entry_type`.

## Constants

| Name | Value | Where | Used by |
| --- | --- | --- | --- |
| `SHORTFALL_MAX` | `{ USD: 5, LBP: 450_000 }` | `packages/core/src/validators/exchange.ts` | MPI Waive, `resolveKeptChange` (payout kept, customer reduction), session waive, supplier/LOTO settle discount |
| `PAYOUT_KEEP_CHANGE_MAX` | `= SHORTFALL_MAX` (alias, kept for existing imports) | same | unchanged callers |
| `isWithinShortfallMax(amount, currency)` | `amount <= SHORTFALL_MAX[currency] + KEPT_CHANGE_ROUNDING_TOLERANCE[currency]`; false for any other currency | same | every check above |

## Payload fields

| Schema | New field(s) | Rule |
| --- | --- | --- |
| `lotoSellSchema` (`validators/loto.ts`) | `discount_usd?`, `discount_lbp?` (≥ 0) | ≤ commission (tender rate); refused with `deferPayment`, `partnerMode: "FOR"`, or kept change > 0 |
| `sessionCheckoutSchema` (`validators/session.ts`) | `waived_usd?`, `waived_lbp?` (≥ 0) | each ≤ `SHORTFALL_MAX`; equal to the real basket gap; needs `tender_exchange_rate` |
| `supplierSettleAccountSchema` (`validators/supplier.ts`) | `discount?` = `counterpartyDiscountInputSchema` | no surplus; cash must be owed; ≤ `SHORTFALL_MAX` per currency |
| `supplierSettleSchema` (`validators/supplier.ts`) | `discount?` = `counterpartyDiscountInputSchema` | not bills-only; not OTHER_PAYMENT; cash owed; ≤ `SHORTFALL_MAX` |
| `lotoCheckpointSettleSchema`, `lotoCheckpointsSettleBatchSchema` (`validators/loto.ts`) | `discount_lbp?` (≥ 0) | ≤ `SHORTFALL_MAX.LBP`; < \|net\| |

Custom Services, Expenses, Debts, Partners, Suppliers Pay, recharge and POS/Maintenance send **no new field**. They lower an amount or a discount that the page already sends.

## Transaction rows

### Loto ticket (`LOTO`, existing type)
- `amount_lbp` = face value (unchanged).
- `profit_usd` = `kept_usd − discount_usd`.
- `profit_lbp` = `commission + kept_lbp − discount_lbp`.
- `metadata_json.discount_usd/lbp` added.
- Supplier TOP_UP = `sale − commission` (unchanged).

### `WAIVED_SHORTFALL` (new type, session basket sibling)
- Same shape as `KEPT_CHANGE`:
  - `source_table = customer_sessions`; amount 0/0;
  - `profit_usd/lbp = −waived_usd/−waived_lbp`;
  - `exchange_rate` = cashier rate; `client_name` = session name;
  - `metadata_json.waived_usd/lbp`.
- Linked through `customer_session_transactions` (`kind = "waived_shortfall"`).
- Non-reversible on its own. It is swept by `voidSessionBasket` / `refundSessionBasket`.
- Badge: none (`no-money`). It is visible in the Transactions table, like KEPT_CHANGE.

### Supplier/LOTO settlement discount (existing `COUNTERPARTY_DISCOUNT` + supplier_ledger `DISCOUNT`)

| Flow | Direction | supplier_ledger DISCOUNT | COUNTERPARTY_DISCOUNT profit | Linked to |
| --- | --- | --- | --- | --- |
| Account settle PAY | received | −x | +x | anchor member ledger row; `settlement_id` = settlement |
| Account settle COLLECT | forgiven | +x | −x | same |
| Batch settle | received | −x | +x | SETTLEMENT ledger row; self-stamped |
| LOTO settle, shop pays | received | −x | +x | LOTO SETTLEMENT ledger row |
| LOTO settle, LOTO pays | forgiven | +x | −x | same |

The settlement's own ledger row books the **cash actually paid**. Its row plus the DISCOUNT row = the full amount owed, so the supplier balance ends at exactly 0.

## Invariants (each one gets a test)

1. **Customer reduction**: `IN − OUT − kept = expected − reduction` per USD-equivalent (ε 0.05). The claimed reduction equals the real gap within rounding tolerance. Reduction ≤ cap.
2. **Customer reduction leaves counterparties alone**: the owed amount (LOTO TOP_UP, partner, supplier) is identical with or without the reduction.
3. **Settlement discount closes the balance**: Δsupplier balance = −owed exactly when the discount is applied.
4. **Reversal**: create + void (or refund), per currency, nets to 0 for every drawer, supplier_ledger, debt_ledger and profit. LOTO settlement is excluded (non-reversible by design).
5. **Payout kept change**: accepted up to and including $5 / 450,000 LBP; refused above.
