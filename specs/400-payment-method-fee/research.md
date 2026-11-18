# Research: Payment method fee

Facts read from the code on 2026-11-18 (file:line at that date).

## R1 — Migration number
- Last entry: v232 `hold_money_voided` (`packages/core/src/db/migrations/index.ts` ~:15404). **Decision**: v233 `payments_fee_amount`.

## R2 — Leg table and reversal
- Every phase-1 repo writes legs through the single `insertPaymentRow` (`moneyPosting.ts` ~:504) and `applyDrawerDelta`. Sales in-leg loop ~:1680; Recharge in-leg loop after `partitionLegs` ~:1587; Debt repayment ~:1039.
- `_reversePayments` (`TransactionRepository.ts` ~:10943) reads `method, drawer_name, currency_code, amount, note` and mirrors `-amount` on BOTH void and refund. **A fee outside `amount` would survive a void** (rule 20) — and a fee inside `amount` would be handed back on a refund. **Decision**: fee inside `amount`, `fee_amount` part; void mirrors both, refund mirrors the price part.
- Refund also goes through `overridableNetByCurrency` (~:680), `paymentRowsToLegs` (~:597), `SalesRepository._itemRefundLegRows` (~:2391), `_applySaleItemMoneyBack` (~:3797). All switched to the price part via `priceOnlyLegRow`.
- `_refundTransactionInternal` never sets the original to VOIDED (only `_voidTransactionInternal` ~:6929 does) — the profit gate relies on that.
- Drawer readers that sum `payments.amount`: `ClosingRepository` ~:319, ~:367 (rebuild), ~:1342; `checkpointResolution.ts` ~:280. **Alternative rejected**: amount = price only.

## R3 — Schemas (rule 23 three-way diff)
| Channel | Schema (casing) | Preload `data` leg type | Handler → service |
| --- | --- | --- | --- |
| `sales:process` | `salePaymentLegSchema` `method, currency_code, amount, voucher_code?, direction?` (snake) | preload `sales.process` | passes parsed payload whole to `SalesService.processSale` |
| `recharge:process` | inline `payments[]` in `createRechargeSchema` `method, currencyCode, amount, voucherCode?, direction?` (camel) | preload `recharge.process` | passes parsed payload whole |
| `debt:add-repayment` | `repaymentPaymentLineSchema` `method, currencyCode, amount(min 0), direction?` (camel) | preload `debt.addRepayment` | passes parsed payload to `DebtService.addRepayment` |
**Decision**: `fee_amount` / `feeAmount` / `feeAmount`; preload and electron.d.ts leg types gain the same key. Repos receive the legs as parsed (no re-mapping that drops keys — verified in the implementation step).

## R4 — Profit derivation
- Summary/By Module/By Date/By User/By Client/drill-down each have a PM_FEE (old rate fee) source from `financial_services.payment_method_fee` (`getPmFeeTotals` ~:5880, `daily_pmfee` ~:7792, `pmFeeRecognized` ~:2804, `getPmFeeDetail` ~:7155). Module rows read the `transactions.profit_*` stamp; a refund writes a REFUND row with the negated stamp.
- **Decision**: fee NOT stamped; one fragment over `payments` gated on the leg's transaction `status='ACTIVE' AND reverses_id IS NULL AND fee_amount > 0`, dated by `t.created_at`, folded into PM_FEE everywhere. Totals add up because the new rows enter every view through the same PM_FEE source. KPI snapshot reads no profit (balances only).
- **Alternative rejected**: stamp + subtract per module — refund would negate it (FR-008 violated) and every module query would need a subtraction.

## R5 — Refund vs void on profit
- Refund negates the stamp (fee not in it → kept). Void marks VOIDED (fee row's txn excluded → removed).

## R6 — Old rate-based fee
- Only `frontend/src/features/services/pages/Services/index.tsx` passes `showPmFee` (`multiPmFeeApplies` = SEND && split && provider≠WHISH). `PaymentSheet` forwards `showPmFee` but no caller sets it — no recharge flow uses the old fee. Stored by `FinancialServiceRepository` (~:5221, ~:5408) as `financial_services.payment_method_fee` + PM_FEE audit leg. **Decision**: untouched; `lineFees` mutually exclusive with `showPmFee`.

## R7 — Currency
- `postingCurrency` maps Binance USD legs to `USDT`. Profit buckets `USDT` as USD (same as every Binance figure, LIRA-268). LBP fee → LBP profit; no phase-1 repo converts the fee.
