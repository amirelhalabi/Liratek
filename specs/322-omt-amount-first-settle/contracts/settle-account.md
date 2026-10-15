# Contract: settle the OMT account by amount

Channels (unchanged names, one shared core schema, admin only):

- IPC `suppliers:settle-account` → `SupplierService.settleAccount`
- REST `POST /api/suppliers/:id/settle-account` → same service. `authenticateJWT`, `requireRole(["admin"])`, actor from the JWT. Envelope `{ success, id? , error? }`, HTTP 200 on failure.
- Adapter `settleSupplierAccount(payload: z.input<typeof supplierSettleAccountSchema>)`. The type is derived, never hand-written (rule 21). `preload.ts` binding typed the same way.

## `supplierSettleAccountSchema` — additive change

```ts
// existing keys, now optional when per_currency is present:
direction?: "PAY" | "COLLECT";          // legacy path only
selections?: { kind; id }[];            // amount-first: optional override (scope)
amount_usd?: number; amount_lbp?: number; // legacy path only
commission_usd?/commission_lbp?/entry_mode?/commission_rate?/commission_unit_count?
exchange_rate?, note?, covered_omt_service_types?, discount? (legacy), surplus_*? (legacy)

// NEW — presence selects the amount-first path
per_currency?: {
  USD?: CurrencySection;
  LBP?: CurrencySection;
};
expected_owed?: { usd: number; lbp: number }; // signed in-scope remaining the sheet previewed (FR-021)

type CurrencySection = {
  direction: "PAY" | "COLLECT";        // must match the sign of what is owed in this currency
                                       // after netting; when nothing is owed, the operator's choice
  payments: SupplierPaymentLeg[];      // IN legs in THIS currency; OUT (change) legs in any currency, CASH only
  commission?: number;                 // ≥ 0, this currency
  waive?: number;                      // ≥ 0, this currency, existing limits
};
```

Refinements (Zod `superRefine`, so the object stays a plain `ZodObject`):
- `per_currency` needs at least one section.
- An IN leg's `currency_code` equals its section's currency (the strict currency rule, FR-001).
- With `per_currency`, the legacy keys `direction`, `amount_*`, `surplus_*` and `discount` must be absent.

## Server behaviour (amount-first path)

All inside one `db.transaction`:

1. Read the queue fresh. Apply the scope: `selections` when given, else every row; the covered-types filter always applies.
2. Compute the in-scope signed remaining per currency. If it differs from `expected_owed`, refuse (stale).
3. Run `allocateAccountSettlement` (contracts/allocator.md) per currency. Refuse when:
   - a section's direction contradicts what is owed;
   - commission is entered but no model-1 row closes;
   - closed model-1 rows span two members with commission;
   - a waive is combined with an extra in the same currency;
   - change exceeds the extra (existing `_resolveSettlementLegs` rule, applied per section).
4. Write the transaction, anchor and member/currency ledger rows, netting pairs, coverage rows, `settlement_id` stamps on closed rows (`.changes` guard), drawers via payment legs, commission (closed rows only), cash-out commission (closed credits only), and the overpay rows.

Returns `{ success: true, id: <transaction id> }`.

## Void (existing generic path, `transactions:void` / refund)

Refused unless this settlement is the newest active one on every row it covered: "A later settlement (#id, date) paid the same transfers. Void it first." Otherwise the coverage rows are marked `is_reversed=1`, then the existing reversal runs.

## Read: `getSupplierAccountUnsettled` (IPC `suppliers:account-unsettled`, REST `GET /api/suppliers/:id/account-unsettled`)

Each row adds `covered_usd`, `covered_lbp`, `remaining_usd` and `remaining_lbp`. The settlement commission credit rows are no longer returned (F3). Add the fields to the `AccountUnsettledRow` type in `packages/ui/src/api/types.ts`, and drop the duplicate in `electron.d.ts` in favour of that one.

## Read: `getAllSupplierTransactions`

For account members, `fifo_status` and `fifo_paid_usd`/`fifo_paid_lbp` (new) come from coverage.
