# Contract: payment-leg fee

Unchanged channels/routes; each leg gains an optional fee key.

- `sales:process` / `POST /api/sales/process` — `payments[i].fee_amount`
- `recharge:process` / `POST /api/recharge/process` — `payments[i].feeAmount`
- `debt:add-repayment` / `POST /api/debts/repayments` — `payments[i].feeAmount`

Refusal (envelope `{ success: false, error }`, HTTP 200 on REST):
- fee < 0 or fee > line amount → "Payment method fee must be between 0 and the line's amount"
- fee on OUT/change line → "A fee can only be charged on money the customer pays in"
- fee on CASH-family / CUSTOMER_ACCOUNT / GIFT_CARD → "A fee can only be charged on a wallet payment line (not cash, account or gift card)"

Read side: `TransactionPaymentLeg.fee_amount?` (Transactions page legs); profit summary `financial_services.pm_fee_by_method: { method, currency_code, total, count }[]`.
