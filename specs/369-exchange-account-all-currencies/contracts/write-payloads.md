# Contract: exchange submit (IPC `exchange:add-transaction` + REST `POST /api/exchange/transactions`)

One schema: `exchangeSubmitSchema` (`packages/core/src/validators/exchange.ts`). Both transports validate with it; envelope unchanged (`{ success, data?, error? }`, HTTP 200 on failure).

## New / changed keys

| Key | Type | Rule |
|---|---|---|
| `payments[].method` | string | Now may be `CUSTOMER_ACCOUNT` (both modes). Native mode: only `CASH` / `CUSTOMER_ACCOUNT`. |
| `payments[].currencyCode` | string | USD/LBP mode: USD or LBP (as today). Native mode: must equal `toCurrency`. |
| `customerPayments[].method` | string | `CUSTOMER_ACCOUNT` now allowed for every `fromCurrency`. |
| `customer_account_usd_rate` | number > 0, optional | Required iff a customer-side account line is in a non-USD/LBP currency; refused otherwise. "1 fromCurrency = X USD". |
| `payout_account_usd_rate` | number > 0, optional | Required iff a payout account leg is in a non-USD/LBP currency; refused otherwise. "1 toCurrency = X USD". |
| `clientId` | int > 0 | Required when any account line exists on either side. |
| `kept_change_*`, round-up, added change, `tender_exchange_rate` | — | Refused in native mode. |

## Examples

USD → EUR, 100 EUR: 60 cash + 40 to account at 1.10
```json
{ "fromCurrency": "USD", "toCurrency": "EUR", "amountIn": 110, "amountOut": 100,
  "clientId": 42,
  "customerPayments": [{ "method": "CASH", "currencyCode": "USD", "amount": 110 }],
  "payments": [
    { "method": "CASH", "currencyCode": "EUR", "amount": 60 },
    { "method": "CUSTOMER_ACCOUNT", "currencyCode": "EUR", "amount": 40 }],
  "payout_account_usd_rate": 1.10 }
```
Result: drawer USD +110, drawer EUR −60, `CREDIT_DEPOSIT` −$44 note "40 EUR @ 1.10 = $44", EUR lot consumed 60.

Refused: same payload without `clientId` → `success:false`; without `payout_account_usd_rate` → `success:false`; `payout_account_usd_rate` on a USD target → `success:false`.
