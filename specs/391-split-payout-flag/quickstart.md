# Quickstart — validating LIRA-391

## Core (real DB)

```bash
cd packages/core
npx jest src/repositories/__tests__/splitPayoutFlag.sweep.test.ts
npx jest --maxWorkers=2        # full suite before push
npm run build && cp -r dist/. ../../node_modules/@liratek/core/dist/
```

Expected: every sweep row passes — account line → client ledger credit, other line → its drawer,
per currency; unbalanced split throws; refund nets every touched ledger to 0.

## Frontend (affected files only)

```bash
cd frontend
npx jest src/utils/__tests__/lumpMethodSetter.guard.test.ts src/utils/__tests__/lumpMethodOf.test.ts \
  src/features/recharge/pages/Recharge/__tests__/Recharge.splitPayoutFlag.test.tsx \
  src/features/recharge/components/__tests__/OmtWhishAppTransferForm.splitPayoutFlag.test.tsx
```

## Web e2e (fresh DB)

```bash
rm -f frontend/test-results/e2e-web/phone_shop.web.db*
node scripts/run-e2e.mjs web view=off --min=1 lira-web-NNN-binance-split-payout.spec.ts
node scripts/run-e2e.mjs web view=off --min=1 lira-web-NNN-app-wallet-split-payout.spec.ts
```

Expected: booked payment rows show the non-account leg leaving its drawer; the client ledger shows
a credit equal to the account line only.
