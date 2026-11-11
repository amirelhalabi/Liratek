# Quickstart: validating LIRA-381

## Core (money)

```bash
cd packages/core
npx jest src/repositories/__tests__/lira381.refundAnyBasketItem.test.ts --maxWorkers=2
npx jest src/repositories/__tests__/TransactionRepository.refundSessionBasketItem.test.ts --maxWorkers=2
```

Expected: one row per member type; each row's item refund moves only the expected ledgers, stamps `direction`, and item refund + whole-basket refund nets every ledger (drawers, supplier, partner, debt) to 0 per currency. Story 1's basket hands back 300,000 LBP (not USD).

Then rebuild + sync core: `cd packages/core && npm run build && cd ../.. && cp -r packages/core/dist/. node_modules/@liratek/core/dist/`.

## Frontend

```bash
cd frontend
npx jest src/features/audit/components/__tests__/ActionsCell.sessionItemRefund.test.tsx
npx jest src/features/audit/hooks/__tests__/useSessionItemRefund.direction.test.ts
```

## Web e2e (stories 1 and 2)

```bash
node scripts/run-e2e.mjs web view=off --min=1 -- lira-web-096 --reporter=list
```

Expected: ticket refund → General LBP −300,000; prize refund in "customer pays back" direction → General LBP +500,000; screenshot at `frontend/public/whats-new/1.35.0/refund-basket-item.png`.

## Gates

`yarn typecheck`, `yarn lint`, `yarn check:i18n` (measure elapsed time).
