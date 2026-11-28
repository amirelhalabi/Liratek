# Contracts: Whish App Only Days payloads (LIRA-406)

No new endpoint, schema or key. Existing keys of `createFinancialServiceSchema` (`packages/core/src/validators/financial.ts`) carry Only Days for Whish App, exactly as for Katsh / iPick.

## Per-unit fields (walk-in unit, session sub-item, partner sale)
| Key | When sent |
| --- | --- |
| `itemCategory` | always for a card (already sent today) |
| `mobileServiceItemId` | Only Days AND split complete AND item has an id |
| `returnedCreditsUsd` | Only Days AND (operator edited it OR split incomplete) |
| `amount` | the Only Days unit price (after the basket discount share) |
| `cost` | the GROSS card cost (unchanged) |
| `note` | item name + ` [Only Days]` |

## Server acceptance rule
`FinancialServiceRepository.createTransaction` resolves credit returns when
`provider ∈ {Katsh, iPick}` OR (`provider = WHISH_APP` AND `currency = LBP`).
Otherwise any credit-return field is ignored.

## Channels (unchanged, both transports)
- walk-in: `addOMTTransaction` (IPC `omt:add-transaction` / REST `POST /api/services/transactions`)
- session basket: session checkout `_batch`
- basket checkout: `rechargeBasketCheckout`
- partner order: `rechargePartnerOrder`
