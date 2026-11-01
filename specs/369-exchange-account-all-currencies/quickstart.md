# Quickstart: validating LIRA-369

No Electron on this Mac: validate in core jest + frontend jest (affected files only) + one web e2e. Ask the owner before running any suite.

## Core (Node ABI)
`cd packages/core && npx jest src/repositories/__tests__/ExchangeRepository.lira369.test.ts src/validators/__tests__/exchange.lira369.test.ts src/repositories/__tests__/TransactionRepository.exchangeLotReversal.test.ts`
Expect: every scenario in spec US1–US4 + edge cases; create + void nets to 0 per currency on drawers, `debt_ledger`, lots, profit.

## Frontend
`cd frontend && npx jest src/features/exchange/pages/Exchange/__tests__/Exchange.lira369.test.tsx` and the MultiPaymentInput rate-box test under `packages/ui`.
Expect: window opens for USD→EUR / EUR→GBP; methods per mode; rate box "1 EUR = … USD" seeded at the trade rate; Confirm off without client or rate.

## Web e2e
`yarn test:e2e:web -g "lira-web-0NN"` (number assigned in tasks).
Flow: USD→EUR 100 EUR, 60 cash + 40 account at 1.10 → client statement shows +$44 credit with "40 EUR @ 1.10 = $44"; void → credit gone, EUR drawer back.

## Manual (test tenant, after deploy)
Exchange $110 → 100 EUR all to account; check Debts page credit $110, EUR drawer unchanged, Positions panel EUR unchanged.
