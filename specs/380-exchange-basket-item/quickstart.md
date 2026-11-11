# Quickstart — validating LIRA-380

## Automated

```bash
# core (after: cd packages/core && npm run build && cp -r dist/. ../../node_modules/@liratek/core/dist/)
cd packages/core
npx jest src/utils/__tests__/sessionExchangeLine.test.ts --maxWorkers=2
npx jest src/services/__tests__/SessionCheckoutService.exchangeLine.test.ts --maxWorkers=2

# frontend (explicit paths only)
cd frontend
npx jest src/features/exchange/pages/Exchange/__tests__/Exchange.sessionBasketLine.test.tsx
npx jest src/features/sessions/utils/__tests__/binanceCart.exchangeLine.test.ts
npx jest src/features/sessions/components/__tests__/SessionCheckoutModal.exchangeLine.test.tsx

# web e2e (from repo root)
node scripts/run-e2e.mjs web view=off --min=1 lira-web-097 --reporter=list
```

## Manual (web app or desktop)

1. Start a session for a customer. Sell a $20 item.
2. Exchange page: $100 USD → LBP at 89,500. Press Confirm — no payment window
   opens; the basket shows "Exchange $100 → 8,950,000 LBP @ 89,500".
3. Transactions page: no exchange row; drawers unchanged.
4. Checkout: $120 to collect, 8,950,000 LBP to pay out. Change the checkout
   rate — the exchange line and its payout do not change.
5. Pay $120 cash, confirm. Transactions: the item and the EXCHANGE under the
   session group; General +$120 / −8,950,000 LBP.
