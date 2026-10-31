# Contracts: LIRA-365 write payloads

All keys are optional and additive, so existing callers are unchanged. Schemas live in `packages/core/src/validators/` and are shared by the IPC handler and the REST route (rules 14, 19). Adapter types derive from `z.input<…>` (rule 21).

## financial (`createFinancialServiceSchema`) — channel `financial:create`, `POST /api/financial`

```ts
discount_amount?: number   // ≥ 0, in `currency`
```

Refused, with one shared message per rule, in both the schema and the repository:
- `discount_amount > 0` unless provider is OMT/WHISH and serviceType is SEND
- `discount_amount > 0` with `partnerMode: "FOR"` or `deferPayment: true`
- `discount_amount + customer_waived_amount > SHORTFALL_MAX[currency]`
- `discount_amount ≥ amount + fee` (or `≥ amount` when `includingFees`)

Example: `{ provider:"OMT", serviceType:"SEND", omtServiceType:"WESTERN_UNION", amount:400, currency:"USD", omtFee:15, discount_amount:2, payments:[{method:"CASH",currencyCode:"USD",amount:413}] }` is accepted. Drawer +413, OMT owed 415, expense Discount_Given $2 (books-only).

## exchange — existing channel

No new key: the Discount line feeds the existing `customer_waived_amount`.

## voucher sell (`voucher.ts`)

```ts
discount_amount?: number // ≥ 0, in the sale currency; ≤ cap; < face value
```

## Errors

The envelope is unchanged: `{ success:false, error }`, and REST returns HTTP 200 on failure.
