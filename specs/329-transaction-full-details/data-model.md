# Data model: transaction details

All fields are optional unless marked \*. Empty values are omitted. Amounts are numbers in their own currency, with a `currency` alongside where it is ambiguous. `partner` is always `{ id, name, mode: "FOR" | "VIA" | "THROUGH" }`. `client` data goes to the row's `client_name` / `client_phone` columns, not into `details`.

Source of each field: `docs/plans/ongoing_plans/TRANSACTION_DETAIL_AUDIT.md` §2. Every entry below corresponds to a field listed as missing there, unless it is marked "(kept today)". "(kept today)" means the field is already on the transaction and is repeated here so `details` is complete for that kind.

## Common

- `v`_ = 1, `kind`_
- `note` (full text)
- `discount`: `{ amount, currency }` as typed
- `partner`
- `paid_in_session`: session id when paid through a customer-session basket

## Kinds

### OMT / Whish system: `omt_whish_transfer`

`provider`_ (OMT | WHISH), `direction`_ (SEND | RECEIVE), `serviceType` (INTRA, WESTERN_UNION, CASH_TO_BUSINESS, CASH_TO_GOV, OMT_WALLET, OMT_CARD, OGERO_MECANIQUE, ONLINE_BROKERAGE), `reference`, `sender {name, phone}`, `receiver {name, phone}`, `omtFee`, `whishFee`, `includingFees`, `paymentMethodFee {amount, rate}`, `brokerage {payFee, supplierItemKey, fee}`.

### Custom Services: `custom_service`

`description` (kept today), `category`, `productId`, `fulfillmentStatus`, `direction` (IN | OUT pay-out), `cost {usd, lbp}`, `price {usd, lbp}`, plus `partner` (mode FOR or VIA).

### Hold Money: `hold_money`

`action` (CREATE | COLLECT | VOID_PICKUP), `notes`.

### MTC / Alfa: `telecom_recharge`

`carrier`_ (MTC | ALFA), `type`_ (CREDIT_TRANSFER | DAYS | SHOP_LINE_USE | ALFA_GIFT), `phone`, `amount`, `days`, `carrierLineId`, `defaultPrice`, `typed {costUsd, priceUsd}` (Days), `giftTier {key, label}` (Alfa Gift), `smsExpenseTxnId`.

### Credit buy-back: `telecom_buyback`

`carrier`\*, `credits`, `phone`, `payoutMethod`, `carrierLineId`.

### Katsh / iPick / Whish App / OMT App catalog sale: `catalog_sale`

`provider`\*, `items[] { key, category, label, quantity, unitPrice, onlyDays?, returnedCreditsUsd? }`, `currencyMode` (LBP | USD).

### Katsh / iPick bill: `provider_bill`

`provider`\*, `amount`, `currency`.

### Whish App / OMT App transfer: `wallet_transfer`

`provider`_, `direction`_, `counterparty {name, phone}`, `providerFee`, `feePaidBy` (SENDER | DEDUCTED | SEPARATELY), `cashoutMethod`.

### Binance: `crypto_transfer`

`direction`\*, `amountUsdt`, `fee`, `feePaidBy`, `walletOrReference`, `cashoutMethod`.

### Top-ups and cash-outs: `wallet_topup`

`provider`\*, `source` (DRAWER | SUPPLIER | PARTNER | CLIENT), `includingFees`, `fee`. Other fields are kept today.

### Wrong number: `wrong_number`

`cardId`, `itemId`, `wrongNumber`, `rightNumber`, `saleTransactionId`.

### POS sale: `pos_sale`

`items[] { productId, name, quantity, unitPrice, unitCost, imei?, unitId?, warrantyMonths? }`, `giftCardCodes[]`, `paymentCurrency`.

### Maintenance: `maintenance_job`

`jobId`\*, `device`, `issue` (full), `status`, `repairCost {usd, lbp}`, `price {usd, lbp}` (before discount), `warrantyMonths`, `warrantyUntil`, `parts[] { productId, name, quantity, unitPrice, unitCost }`.

### Warranty claim: `warranty_claim`

`claimId`\*, `action`, `unitId`, `replacementUnitId`, `notes`, `overrideReason`, `saleItemId` or `maintenanceId`.

### Exchange: `exchange`

`from`_, `to`_, `via`, `amountIn`, `amountOut`, `legs[] { rate, marketRate, overridden, profitUsd }`, `payoutRate`.

### Loto ticket: `loto_sale`

`saleAmount`, `commissionRate`, `ticketNumber`.

### Loto cash prize: `loto_prize`

`ticketNumber`, `prizeDate`.

### Expense: `expense`

`category`, `description` (full), `billAmount {amount, currency}` (as typed, before change kept), `expenseDate`, `stockUse {source, itemId, quantity}`.

### Debts / accounts: `account_entry`

`action`\* (REPAYMENT | CREDIT_CASH_OUT | CREDIT_CASH_IN | DEBT_CASH_OUT | ADJUSTMENT | WRITE_OFF), `targets[]`.

### Supplier: `supplier_entry`

`supplierId`_, `action`_ (PAY | RECEIVE | ADJUSTMENT | RECORDED_DEBT | BATCH_SETTLE | ACCOUNT_SETTLE), `commissionRate`, `unitCount`.

### Partner: `partner_entry`

`partnerId`_, `action`_ (SETTLE | PAYMENT | ADJUSTMENT | WRITE_OFF), `pickedType`, `reason`.

### Session siblings: `session_sibling`

`sessionId`\*, `role` (EXTRA | KEPT_CHANGE | WAIVED), `paidByMethod`.

### Void / refund: `reversal`

`originalTransactionId`\*, `reason` (when a field exists later), `refundUnits[] { unitId, flags }`.

## Payment snapshot

See contracts/transaction-details.md. It is built by `buildPaymentSnapshot` from the legs the repository books.
