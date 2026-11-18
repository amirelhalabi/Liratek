# Data model: Payment method fee

## `payments` (existing table, one new column — v233)

| Column | Type | Meaning |
| --- | --- | --- |
| `amount` | REAL | unchanged meaning: the whole signed drawer movement of this leg. For a fee-carrying IN leg = price part + fee. |
| `fee_amount` | REAL NOT NULL DEFAULT 0 | NEW. The payment-method fee inside `amount`, same currency, same sign. 0 on every existing row and every leg without a fee. Void mirror rows carry `-fee_amount`; refund mirror rows carry 0. |

Price part of a leg = `amount − fee_amount` (`priceOnlyLegRow`).

## Payment line (request legs)

| Schema | New key | Rules |
| --- | --- | --- |
| `salePaymentLegSchema` | `fee_amount?: number` | ≥ 0, ≤ amount, not on `direction: "OUT"`, not CUSTOMER_ACCOUNT / GIFT_CARD |
| `createRechargeSchema.payments[]` | `feeAmount?: number` | same |
| `addRepaymentSchema.payments[]` | `feeAmount?: number` | same |

Server (repository, needs the method table): method must be drawer-affecting with a drawer other than General.

## Profit
`PM_FEE` source = old `financial_services.payment_method_fee` rows ∪ `payments.fee_amount > 0` rows whose transaction is ACTIVE and not a reversal. Bucketed LBP / USD (USDT → USD).
