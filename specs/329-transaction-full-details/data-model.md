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

### Vouchers: `voucher` (added by LIRA-339)

`action`_ (SALE | CANCEL), `code`_, `note`, `legacy` (a cancel of a voucher made before sales took money).

### MTC / Alfa: `telecom_recharge`

`carrier`_ (MTC | ALFA), `type`_ (CREDIT_TRANSFER | DAYS | SHOP_LINE_USE | ALFA_GIFT), `phone`, `amount`, `days`, `carrierLineId`, `defaultPrice`, `typed {costUsd, priceUsd}` (Days), `giftTier {key, label}` (Alfa Gift), `smsExpenseTxnId`.

### Credit buy-back: `telecom_buyback`

`carrier`\*, `credits`, `phone`, `payoutMethod`, `carrierLineId`.

### Katsh / iPick / Whish App / OMT App catalog sale: `catalog_sale`

`provider`\*, `items[] { key, category, label, quantity, unitPrice, onlyDays?, returnedCreditsUsd? }`, `currencyMode` (LBP | USD).

A single unit (a basket unit, a Whish App grid item, a partner order line) sends only `itemKey` / `itemCategory`; its `label` is read back from the key (`catalogItemLabelFromKey`: the key is `provider/category/subcategory/label`). A key in another format leaves `label` out.

### Katsh / iPick bill: `provider_bill`

`provider`\*, `amount`, `currency`.

### Whish App / OMT App transfer: `wallet_transfer`

`provider`_, `direction`_, `counterparty {name, phone}`, `providerFee`, `feePaidBy` (SENDER | DEDUCTED | SEPARATELY), `cashoutMethod`.

### Binance: `crypto_transfer`

`direction`\*, `amountUsdt`, `fee`, `feePaidBy`, `walletOrReference`, `cashoutMethod`.

### Top-ups and cash-outs: `wallet_topup`

`provider`\*, `source` (DRAWER | SUPPLIER | PARTNER | CLIENT), `includingFees`, `fee`, `amount`, `currency`, `sourceDrawer` (the shop drawer the money left: a drawer top-up's source, a cash-out's wallet), `destDrawer` (the wallet topped up).

Payment snapshot: a DRAWER top-up keeps both lines as booked — OUT of the source drawer, IN to the wallet (the methods are the drawer names). A SUPPLIER or PARTNER top-up and a cash-out to OMT have none: no shop cash changes hands, the other side is the supplier's or partner's account. A CLIENT top-up keeps the payout lines (OUT).

### Wrong number: `wrong_number`

`cardId`, `itemId`, `wrongNumber`, `rightNumber`, `saleTransactionId`.

### POS sale: `pos_sale`

`items[] { productId, name, quantity, unitPrice, unitCost, imei?, unitId?, warrantyMonths? }`, `giftCardCodes[]`, `paymentCurrency`.

### Maintenance: `maintenance_job`

`jobId`\*, `device`, `issue` (full), `status`, `repairCost {usd, lbp}`, `price {usd, lbp}` (before discount), `warrantyMonths`, `warrantyUntil`, `parts[] { productId, name, quantity, unitPrice, unitCost }`.

### Warranty claim: `warranty_claim`

`claimId`\*, `action`, `unitId`, `replacementUnitId`, `notes`, `overrideReason`, `saleItemId` or `maintenanceId`.

Written on every WARRANTY_COST row of the claim and on the warranty REFUND row (`refundSaleItem` with a claim). That REFUND row keeps these details instead of `reversal` ones (phase 8 decision: explicit details win). It still copies the sale's client, and it reaches its sale through `saleItemId` and the row's `originalSaleId` metadata.

### Exchange: `exchange`

`from`_, `to`_, `via`, `amountIn`, `amountOut`, `legs[] { rate, marketRate, overridden, profitUsd }`, `payoutRate`.

`legs[].profitUsd` is the profit as BOOKED on `exchange_transactions`, after lot tracking — not the figure the screen sent. A leg that buys a lot-tracked currency (EUR and other non-USD/LBP currencies) books 0: a buy earns nothing until the lot is sold (EXCHANGE_LOT_SETTLEMENT Q8), and the profit lands on the sell later. So a cross EUR → LBP exchange shows leg 1 `profitUsd: 0` by design (shop-day check, 2026-10-16). The unified row's `amount_usd` on a cross exchange still carries the screen's leg-1 spread as an informational proxy (unchanged, see `ExchangeRepository`).

### Loto ticket: `loto_sale`

`saleAmount`, `commissionRate`, `ticketNumber`.

### Loto cash prize: `loto_prize`

`ticketNumber`, `prizeDate`.

### Expense: `expense`

`category`, `description` (full), `billAmount {amount, currency}` (as typed, before change kept), `expenseDate` (as stored: an ISO instant from the Expenses page, a day from internal writers), `stockUse {source, itemId, quantity}`.

### Debts / accounts: `account_entry`

`action`\* (REPAYMENT | CREDIT_CASH_OUT | CREDIT_CASH_IN | DEBT_CASH_OUT | ADJUSTMENT | WRITE_OFF), `targets[]`.

### Supplier: `supplier_entry`

`supplierId`_, `action`_ (PAY | RECEIVE | ADJUSTMENT | RECORDED_DEBT | BATCH_SETTLE | ACCOUNT_SETTLE | DISCOUNT), `commissionRate`, `unitCount`. Automatic sibling ledger rows (`is_auto`) carry no details; their parent transaction holds them.

### Partner: `partner_entry`

`partnerId`_, `action`_ (SETTLE | PAYMENT | ADJUSTMENT | WRITE_OFF), `pickedType`, `reason`.

### Session siblings: `session_sibling`

`sessionId`\*, `role` (EXTRA | KEPT_CHANGE | WAIVED), `paidByMethod`.

On the basket's own rows (EXTRA_CHARGE, KEPT_CHANGE, WAIVED_SHORTFALL). `paidByMethod` is the method exactly as the checkout window sent it; it is informational only, and the money still goes by the basket's payment lines. The rows carry the session customer's name and phone. Their payment snapshot is `{ lines: [], session_id }`, plus `kept` on the KEPT_CHANGE row: the basket owns the lines. The LIRA-321 forgiven-leftover WAIVED_SHORTFALL row on an exchange or cash-out belongs to no session. It is an automatic sibling (`is_auto`) and carries no details, because its parent holds them.

### Void / refund: `reversal`

`originalTransactionId`\*, `reason` (when a field exists later), `refundUnits[] { unitId, flags }`.

- **Rows that get it:** voids, refunds and refund undos (an undo names the refund it undoes), and the COUNTERPARTY_DISCOUNT reversal (it names the discount row).
- **Flags:** `DEFECTIVE`, `NOT_DEFECTIVE`, `WARRANTY_UNTIL:<YYYY-MM-DD>` and `WARRANTY_OVERRIDE_CLEARED`, from the refund's per-unit choices (`REFUND_UNIT_FLAGS`).
- **Client:** the row's `client_name` / `client_phone` are copied from the original transaction (`reversalClientOf`).
- **Payment snapshot:** none. The reversal's legs are written by `_reversePayments` after the row exists.
- **Warranty refund:** it keeps its `warranty_claim` details, because explicit details win. It is still linked to its sale through `warranty_claim.saleItemId` and the row's `originalSaleId` metadata, and it copies the client like any refund.

## Payment snapshot

See contracts/transaction-details.md. It is built by `buildPaymentSnapshot` from the legs the repository books. Each call names the flow (`IN` or `PAYOUT`), and every line records the way the money actually moved for the shop's drawer (contract, "Line direction"): a payout line is OUT, change on a sale is OUT, change coming back on a payout is IN, fees and customer-pays lines are IN. The T036 test hook (`paymentSnapshotAssert.ts`) checks each line's direction against the sign of the matching `payments` row.
