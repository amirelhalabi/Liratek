# Quickstart: verify LIRA-334

Run only the affected tests, with explicit paths. Never run the full suites (they use too much RAM).

## Core (Node ABI)

```bash
cd packages/core && npx jest src/repositories/__tests__/roundingGiven.test.ts src/repositories/__tests__/lira334.payoutRounding.test.ts
```

Expected for each payout flow: a round-up within the cap saves, books one "Change rounding" expense and moves the drawer by the full paid amount. Voiding the payout nets the drawer, expenses and profit to 0 in each currency. Over the cap, the payout is refused.

## Frontend / ui

```bash
cd frontend && npx jest src/shared/components/__tests__/MultiPaymentInput.payoutRoundUp.test.tsx src/shared/components/__tests__/MultiPaymentInput.autoExtra.test.tsx src/features/sales/pages/POS/components/__tests__/CheckoutModal.autoExtra.test.tsx
```

## Manual (test tenant, web)

1. On Services, do an OMT receive of $102.90 and pay out $103 cash. It saves, and Expenses shows "Change rounding $0.10".
2. Void it from Audit & Transactions. The expense is voided too.
3. On POS, take a $102.90 cart and pay $103. "+ Extra 0.10" fills in. Clear it and the change box appears.
