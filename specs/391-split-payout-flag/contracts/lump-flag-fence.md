# Contract — lump flag vs payment legs (LIRA-391)

No new endpoint. The existing create contract (`financial:create` IPC / `POST /api/services/...`,
schema in `packages/core/src/validators/financial.ts`) gains one server-side rule:

1. If `payments[]` holds at least one IN leg with a non-zero amount, `cashoutMethod` (and any other
   lump method flag) does NOT decide where money goes. Each leg is booked by its own method, and
   the legs must reconcile to the payout (an unbalanced split is refused).
2. A payload with no such leg keeps the flag path exactly as before.
3. A flag that disagrees with the legs is ignored, never refused.

Page-side contract: a page sends `cashoutMethod` only when every payout line shares one method
(`lumpMethodOf(lines)`); with a split, the key is absent (Binance) or omitted (OMT App / Whish App).

Read-back used by tests/e2e:
- `GET /api/services/transactions/:id/payments` — booked payment rows.
- `GET /api/debts/clients/:id/history` — client ledger rows.
