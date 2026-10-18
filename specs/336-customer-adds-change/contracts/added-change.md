# Contract: added change

| Channel | REST | Schema change |
| --- | --- | --- |
| `omt:add-transaction` | `POST /api/services/transactions` | `addedChangeFields`; `customerPayments` allowed on OMT/WHISH system RECEIVE with a claim; `feePayments` may carry the added change |
| `exchange:add-transaction` | `POST /api/exchange/transactions` | `addedChangeFields` |
| `recharge:process` (CREDIT_BUYBACK) | `POST /api/recharge/process` | `addedChangeFields` + `customerPayments` |
| `recharge:top-up-from-client` | `POST /api/recharge/top-up-from-client` | `addedChangeFields` + `customerPayments` |
| `hold-money:collect` | `POST /api/hold-money/:id/collect` | `addedChangeFields` + `customerPayments` |

**Refusal messages** (validators/common.ts):

- `ADDED_CHANGE_OVER_CAP_MESSAGE`: "The customer can add at most $5 / 450,000 LBP of change — use the Exchange page for more."
- `ADDED_CHANGE_NOT_ALLOWED_MESSAGE`
- `ADDED_CHANGE_MISMATCH_MESSAGE`: the claim does not match the customer's lines.
- `ADDED_CHANGE_ACCOUNT_MESSAGE`: added change can't come from the customer's account or a forgiven amount.

**UI** (MultiPaymentInput):

- `counterFlow.allowAddedChange?: boolean`
- `counterFlow.optional?: boolean`
- `onAddedChange?: (a: {usd:number; lbp:number} | null) => void`

**Test ids:** `counter-flow-add-change`, `counter-flow-remove-change`, `payout-added-change-summary`.
