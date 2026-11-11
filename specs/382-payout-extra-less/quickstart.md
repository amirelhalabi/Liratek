# Quickstart: validate LIRA-382

## Unit / screen tests (frontend jest, explicit paths)

```bash
cd frontend
npx jest src/shared/components/__tests__/MultiPaymentInput.payoutExtraLess.test.tsx \
  src/features/services/pages/Services/__tests__/Services.payoutExtraLess.test.tsx \
  src/features/exchange/pages/Exchange/__tests__/Exchange.payoutExtraLess.test.tsx \
  src/features/recharge/components/__tests__/TopUpModal.payoutExtraLess.test.tsx \
  src/features/recharge/components/__tests__/OmtWhishAppTransferForm.payoutExtraLess.test.tsx
```

Expected: all pass; the payload carries `rounding_given_*` for "+ Extra" and `kept_change_*` for "− Less"; legs = owed ± value.

Regression: the existing `*.roundUp.test.tsx`, `MultiPaymentInput.payoutRoundUp.test.tsx`, `*.addedChange*.test.tsx` stay green.

## Web e2e

```bash
node scripts/run-e2e.mjs web view=off --min=1 -- -g "LIRA-382" --reporter=list
```

Expected: OMT receive $102.90 with "+ Extra" 0.10 → drawer delta −103.00, Expenses shows "Change rounding" 0.10; screenshot `frontend/public/whats-new/1.35.0/payout-extra-less.png`.

## Gates

`yarn typecheck`, `yarn lint`, `yarn check:i18n`, `node scripts/build-release-notes.cjs --check`.
