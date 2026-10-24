# Contracts: Voucher sell / cancel (both transports, ONE schema each)

## voucherCreateSchema (extended) — `voucher:create` / `POST /api/vouchers`
```
{ clientId: int>0, amount: >0, currency: "USD"|"LBP" = "USD", expiryDate?: string|null, note?: string|null,
  payments?: VoucherPaymentLeg[]  // NEW voucherPaymentLegSchema: same shape as holdMoneyPaymentLegSchema (method, currency_code, amount, direction?); method enum = drawer methods + CUSTOMER_ACCOUNT on create (no GIFT_CARD); drawer methods only on cancel
  exchange_rate?: number    // tender rate, same meaning as Hold Money's
  transaction_time?: string // optional back-time, same rule as Hold Money
}
```
Response (unchanged envelope): `{ success, voucher?, transactionId?, error? }`.

## voucherCancelSchema (NEW) — `voucher:cancel(id, data)` / `POST /api/vouchers/:id/cancel` (admin)
```
{ payments?: VoucherPaymentLeg[]  // payout legs, direction absent; must be empty for a legacy voucher
  exchange_rate?: number
  client_day?: string      // YYYY-MM-DD, rule 27 (logged in metadata as expired-at-cancel)
}
```
Response: `{ success, voucher?, transactionId?, refunded?: { cash: {usd, lbp}, toAccount: {usd, lbp} }, error? }`. Payout legs cover the cash part only.
The IPC signature becomes `cancel(id, data?)`. Omitting `data` behaves as a cash refund in the voucher currency (fallback leg), for backward compatibility.
The REST route takes the actor from the JWT. On failure it returns HTTP 200 with `success:false`.

## Transactions type filter
A `typeFilters[]` tuple accepts `paid_via_voucher: true`. A row returns `paid_via_voucher`.
