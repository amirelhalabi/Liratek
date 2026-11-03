# Contract — settle the OMT account from the SMS amount

Channel `suppliers:settle-account` / `POST /api/suppliers/:id/settle-account`. Both already exist. Schema: `supplierSettleAccountSchema` (core `validators/supplier.ts`). Admin only. Actor comes from session / JWT. HTTP 200 envelope `{ success, error? }` on failure too.

## Payload additions

```ts
per_currency: {
  USD?: {
    direction: "PAY" | "COLLECT";
    payments: Leg[];            // IN legs total = |sms_amount| by default
    sms_amount?: number;        // NEW — OMT's sign: + we pay, − OMT pays us
    commission?: number;        // when sms_amount is present: must equal the server's derived figure, else refused as stale
    waive?: number;
  };
  LBP?: { … same … };
};
owed_shares_only?: boolean;     // NEW — settle only owed shares (no selections in scope)
covered_omt_service_types?: OmtCoveredType[]; // unchanged key; NEW meaning on the amount-first OMT path: commission scope only, never a row filter
```

Types: the adapter / preload take `z.input<typeof supplierSettleAccountSchema>` (rule 21). No hand-written copy.

## Server rules (amount-first path, OMT account: `commissionCoversOwed` true, **and** at least one section carries `sms_amount`)

SMS mode is opt-in by the payload (decided in T013, 2026-11-03). An OMT payload in the old shape (typed `commission`, no `sms_amount`) keeps the LIRA-322 meaning: the commission becomes an open credit, and the ticked types filter rows. Offline desktop entries queued before the update therefore replay unchanged, and the LIRA-322 guard suites stay valid.

1. Rebuild scope from `selections` (existing). No `_assertRowsCoveredByStatement` refusal on this path.
2. Per currency with `sms_amount`: `expectedSmsFigure` + `deriveSmsCommission` over the server's own rows and live owed shares. If the client sent a different `commission`, refuse: `settleStaleMessage("OMT")`.
3. Allocator with `commission_covers: true`. Coverage sources: NETTING, WAIVE, COMMISSION, PAYMENT.
4. Profit = commission. Allocations per R2. Owed shares cleared or created per R5. No commission credit ledger row.
5. Extra money (OMT asked more): overpay credit (existing LIRA-315). Short money: newest row part-paid (existing).
6. Refusals (verbatim, both transports):
   - `"Tick “All types” to settle an old-style OMT transfer of another type"`: scope has an open model-0 OMT row of an unticked type.
   - `"Nothing to settle"`: `owed_shares_only` with no live owed shares of the ticked types.
   - The existing stale and direction refusals are unchanged.

Other suppliers (`commissionCoversOwed` false): byte-identical to today.

## New read: owed shares

`suppliers:account-owed-shares` / `GET /api/suppliers/:id/account-owed-shares`. The read returns the raw object (reads return the raw IPC shape, CLAUDE.md):

```ts
{ total_usd: number; total_lbp: number;
  by_type: Array<{ omt_service_type: OmtCoveredType; usd: number; lbp: number; count: number }>;
  rows: Array<{ id; financial_service_id; omt_service_type; currency; amount; created_settlement_txn_id; created_at }> }
```

`account-expected-statement` adds `owed_shares_usd`, `owed_shares_lbp` (ticked types), and its `expected_*` subtracts them. Rule 14: computed by `expectedSmsFigure`.

## Void / undo

`transactions:void` / `POST /api/transactions/:id/void` (existing). `_reverseSupplierSettlement` gains the owed-share step (R6). It is never refused for owed-share reasons.
