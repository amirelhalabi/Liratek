# Contract: transaction details

## On the row

`metadata_json` keeps every existing key and may add:

```ts
details?: { v: 1; kind: TransactionDetailsKind } & KindFields   // see data-model.md
payment_snapshot?: {
  lines: Array<{ method: string; currency: string; amount: number; direction: "IN" | "OUT"; note?: string }>;
  change_returned?: Array<{ method: string; currency: string; amount: number }>;
  kept?: { usd?: number; lbp?: number };
  session_id?: number;           // paid as part of a customer-session payment
}
```

Columns: `client_name`, `client_phone` filled when known (client_phone still requires client_name).

### Line direction (owner decision Q1, shop-day 2026-10-16)

Each line's `direction` is the way the money actually moved for the shop's drawer — the sign of the `payments` row the leg books:

| Line                                                                                                                                                                                          | Direction |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| The customer (or counterparty) pays the shop — a sale, a service, a deposit, a repayment, a partner/supplier paying the shop                                                                  | IN        |
| The shop pays out — a prize, a Hold Money pickup, an expense, a supplier or partner payment, a debt / credit cash-out, a transfer or crypto payout, a credit buy-back, a top-up from a client | OUT       |
| Change handed back to the customer on a sale                                                                                                                                                  | OUT       |
| Change a vendor / supplier / partner hands back on a payout                                                                                                                                   | IN        |
| A fee collected (`note: "fee"`) and what the customer hands over on a cash-out (`note: "customer pays"`)                                                                                      | IN        |
| A drawer-to-drawer top-up: the source drawer / the wallet                                                                                                                                     | OUT / IN  |

`change_returned` lists the change legs either way (on a payout, the change that came back to the shop). Rows saved before this rule keep the old labels (a payout line there reads IN); stored snapshots are not rewritten.

## Writer API (core)

```ts
createTransaction({
  ...existing,
  details?: TransactionDetails,           // z.infer of the kind's schema
  payment_snapshot?: PaymentSnapshot,     // from buildPaymentSnapshot()
})
buildPaymentSnapshot(input:
  | { flow: "IN" | "PAYOUT";           // required whenever lines are recorded
      payments?: Array<PaymentLeg & { flow?: "IN" | "PAYOUT" }>;  // per-leg flow for a two-direction settlement
      feePayments?: PaymentLeg[]; customerPayments?: PaymentLeg[];
      keptChange?: { usd?: number; lbp?: number }; sessionId?: number }
  | { keptChange?: { usd?: number; lbp?: number }; sessionId?: number }   // no lines (session item / sibling)
): PaymentSnapshot | undefined
// direction = snapshotLineDirection(flow, leg): the flow's own leg moves the flow's way
// (IN → IN, PAYOUT → OUT); a change leg (direction "OUT") moves the other way.
```

## Readers

- A missing `details` or `payment_snapshot` means "not recorded" (rows saved before LIRA-329); never an error.
- Unknown `kind` or a newer `v`: show raw values, never fail.
- No REST or IPC contract changes: transactions are read through the existing endpoints, which already return `metadata_json`.
