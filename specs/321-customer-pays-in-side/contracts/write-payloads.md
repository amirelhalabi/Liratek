# Contract: write payloads (desktop IPC and web REST, same schema)

Both transports validate with the same core schema (rule 19); adapter payload types are `z.input<typeof schema>` (rule 21). Envelope unchanged: `{ success, data?, error? }`, HTTP 200 on failure.

## Shared fragment — `packages/core/src/validators/` (legs module)

```ts
export const customerLegSchema = z.object({
  method: z.string().min(1),
  currencyCode: z.string().min(1),
  amount: z.number().positive(),
});
export const customerPaymentsField = {
  customerPayments: z.array(customerLegSchema).min(1).optional(),
  customer_waived_amount: z.number().min(0).optional(), // forgiven part, in the expected currency
};
```

## Exchange — `createExchangeSchema` and `exchangeSubmitSchema`

| Field | New | Rule |
| --- | --- | --- |
| `clientId` | yes | positive int, optional; required by refine when any `customerPayments` line is `CUSTOMER_ACCOUNT` |
| `customerPayments`, `customer_waived_amount` | yes | refuse with `partnerMode === "FOR"`; every line's `currencyCode === fromCurrency` |
| `payments` (payout legs) | — | unchanged; still refuses non-drawer methods |

Channels: IPC `exchange:add-transaction` (`exchangeHandlers.ts:33-50`), REST `POST /api/exchange/transactions` (`backend/src/api/exchange.ts`), offline binding `offline/bindings/exchange.ts`. Rule-23 key diff before wiring: schema ↔ `preload.ts:505-535` `data` type ↔ `CreateExchangeData` (`ExchangeRepository.ts:79-148`) — add `clientId`, `customerPayments`, `customer_waived_amount` to all three.

Server errors (exact wording in tasks): overpaid; short with no account line or forgive; account line with no client; forgive above cap.

## Financial services — `createFinancialServiceSchema`

| Field | New | Rule |
| --- | --- | --- |
| `customerPayments`, `customer_waived_amount` | yes | RECEIVE on `WHISH_APP`, `OMT_APP`, `BINANCE` only; not with `feePayments`; not For-Partner; OMT_APP: expected = transfer only (D1 still refuses any fee) |
| `feePayments` | — | unchanged (old clients, offline replay) |
| `payments`, `cashoutMethod`, kept change | — | unchanged (payout side) |

Channels: IPC via `omtHandlers.ts:38` (`FinancialServiceSchema` re-export), REST `POST /api/services/transactions` (`backend/src/api/services.ts:107-110`), offline binding `offline/bindings/financial`. Frontend builders: `buildWalletTransferPayload` (`utils/walletTransfer.ts:256-300`) and `Recharge/index.tsx` `addOMTTransaction` (1572-1636).

Expected total the server checks against: `transfer + fee` when the fee is paid separately (Whish App, Binance), else `transfer`; in the cash currency, USDT counted 1:1 as USD.
