# Quickstart: validate the payment method fee

1. Core guards: `cd packages/core && npx jest src/repositories/__tests__/paymentMethodFee --maxWorkers=2`
   - create→void nets 0 per drawer/currency and in profit; create→refund keeps the fee; server refusals.
2. Variant tests (rule 28d): POS / recharge / debt repayment — cash only, Whish + fee, split USD+LBP with fees, Whish + fee with change in the other currency.
3. Web e2e: `cd frontend && npx playwright test --config playwright.web.config.ts --project=web tests/e2e-web/lira-web-103-payment-method-fee.spec.ts --reporter=list`
   - POS Whish $10 + $1 fee → Whish +$11; Profits fee line $1; void → 0; refund → Whish +$1 and fee kept; screenshot saved.
4. Manual: POS → Whish line → "+ fee" → type 1 → summary "Payment method fee $1", Paid $11.
