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

## Writer API (core)

```ts
createTransaction({
  ...existing,
  details?: TransactionDetails,           // z.infer of the kind's schema
  payment_snapshot?: PaymentSnapshot,     // from buildPaymentSnapshot()
})
buildPaymentSnapshot(input: { payments?: PaymentLeg[]; keptChange?: { usd?: number; lbp?: number }; sessionId?: number }): PaymentSnapshot
```

## Readers

- A missing `details` or `payment_snapshot` means "not recorded" (rows saved before LIRA-329); never an error.
- Unknown `kind` or a newer `v`: show raw values, never fail.
- No REST or IPC contract changes: transactions are read through the existing endpoints, which already return `metadata_json`.
