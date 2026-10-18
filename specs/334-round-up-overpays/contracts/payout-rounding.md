# Contract: payout round-up fields

These fields are added to each schema in `packages/core/src/validators/`. The IPC handler and the REST route share the schema.

| Channel (IPC) | REST | Schema |
| --- | --- | --- |
| `omt:add-transaction` | `POST /api/services/transactions` | `createFinancialServiceSchema` |
| `exchange:add-transaction` | `POST /api/exchange/transactions` | `exchangeSubmitSchema` / `createExchangeSchema` (via `keptChangeFields`) |
| `recharge:process` (CREDIT_BUYBACK) | `POST /api/recharge/process` | `createRechargeSchema` |
| `recharge:top-up-from-client` | `POST /api/recharge/top-up-from-client` | `topUpFromClientSchema` |
| `hold-money:collect` | `POST /api/hold-money/:id/collect` | `holdMoneyCollectSchema` |

```ts
rounding_given_usd: z.number().nonnegative().optional(),
rounding_given_lbp: z.number().nonnegative().optional(),
```

**Refusals** (the response is `{ success: false, error }`):

- `ROUNDING_GIVEN_OVER_CAP_MESSAGE`: the round-up is more than $5 / 450,000 LBP.
- `ROUNDING_GIVEN_WITH_KEPT_MESSAGE`: a payout cannot both keep change and round up.
- `ROUNDING_GIVEN_NOT_ALLOWED_MESSAGE`: the round-up does not apply here (partner, session basket, account or wallet payout, or no cash legs).
- `ROUNDING_GIVEN_CURRENCY_MESSAGE`: the round-up must be in the payout's currency.
- When the legs do not match owed + rounding, the existing `reconcileLegs` message applies.

## UI contract (MultiPaymentInput)

```ts
/** LIRA-334: payout only. Opts in to accepting an overpay up to the cap as a round-up. */
onRoundUpChange?: (roundUp: { usd: number; lbp: number } | null) => void;
```

- Ignored when `payoutExcessToAccount` is set.
- Note test id: `payout-roundup-summary`.
- Autofill of the built-in extra needs no new prop. It is active whenever `onExtraChange` is passed and Extra is allowed.
