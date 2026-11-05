# Quickstart: validate LIRA-372

**Prerequisites**: Node ABI for core jest and web e2e (`yarn rebuild:node`). Run only explicit test paths, never full suites.

## Core

```bash
yarn workspace @liratek/core jest src/utils/__tests__/settleDiscount.test.ts \
  src/validators/__tests__/counterparty.settleDiscount.test.ts \
  src/repositories/__tests__/SupplierRepository.lira372ReceiveDiscount.test.ts \
  src/repositories/__tests__/SupplierRepository.lira372SettleAccountDiscount.test.ts \
  src/repositories/__tests__/PartnerSettlement.lira372ShopPaysForgive.test.ts \
  src/repositories/__tests__/DebtRepository.lira372Cap.test.ts \
  src/__tests__/lira372.settleDiscountVariants.test.ts
```

Expected:

- Every cap refusal fires at $5.01 and at 450,001 LBP, and $5.00 / 450,000 LBP are accepted.
- Create + void nets to 0 per ledger and per currency.
- OMT commission stays 4.20 with a discount.

## Frontend (jsdom)

```bash
yarn workspace @liratek/frontend jest src/features/debts/pages/Debts/__tests__/Debts.lira372Discount.test.tsx \
  src/features/partners/components/__tests__/PartnerSettleSheet.lira372.test.tsx \
  src/features/partners/pages/Partners/__tests__/Partners.lira372.test.tsx \
  src/features/suppliers/components/__tests__/AccountSettleSheet.lira372.test.tsx \
  src/features/suppliers/pages/Suppliers/__tests__/Suppliers.lira372.test.tsx \
  src/features/debts/pages/Debts/__tests__/Debts.lira318Forgive.test.tsx \
  src/features/debts/pages/Debts/__tests__/Debts.lira310Waive.test.tsx \
  src/features/debts/pages/Debts/__tests__/Debts.lira310WaiveTicked.test.tsx \
  src/features/partners/pages/Partners/__tests__/Partners.lira318ForgiveLine.test.tsx \
  src/features/partners/pages/Partners/__tests__/Partners.lira310Waive.test.tsx \
  src/features/partners/components/__tests__/PartnerSettleSheet.test.tsx \
  src/features/partners/utils/__tests__/settlementDiscount.test.ts \
  src/features/suppliers/pages/Suppliers/__tests__/Suppliers.lira310BatchWaive.test.tsx \
  src/shared/components/__tests__/MultiPaymentInput.lira372PerCurrencyFollow.test.tsx \
  src/shared/components/__tests__/SettleDiscountLine.test.tsx
```

The rewritten LIRA-318/310 suites must now assert that the payment line drops by the discount and that Waive is absent.

## Web e2e

```bash
cd frontend && npx playwright test --config playwright.web.config.ts tests/e2e-web/lira-web-093-settle-discount.spec.ts --reporter=list
```

Confirm the reported count is greater than 0 (rule 28a).

## Manual scenarios (test tenant)

1. **Supplier Settle Account**: owed $412.50, Discount 2.50 → pay line reads $410 → Confirm. Drawer −410, balance 0, Profits +2.50 "supplier discount".
2. **Partner by amount**: partner owes $500. Type Discount 5 and the pay line reads $495.00 by itself. Receive. Drawer +495, balance 0, profit −5.
2b. **Debts**: client owes $412.50 (ticked). Type Discount 2.50 and the pay line reads $410.00 by itself. Type the payment by hand first ($412.50), then a discount: the payment drops to $410.00 too (owner 2026-11-05, option B).
3. **OMT SMS**: expected 772.30, SMS 772.30, Discount 2.30, pay 770. Commission 4.20, OMT balance 0, profit 4.20 + 2.30.
4. **Void each of 1–3**: every figure returns to its earlier value.
5. **Cap**: type 6 → the line shows "Capped to max ($5.00)" and only 5 is sent. A hand-built payload with 6 → `{success:false, error:"The discount is more than $5."}`.
