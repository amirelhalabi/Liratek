# Quickstart: validate Whish App Only Days (LIRA-406)

## Automated
- Core: `cd packages/core && npx jest src/repositories/__tests__/FinancialServiceRepository.telecomOnlyDays.test.ts src/services/__tests__/RechargePartnerOrderService.test.ts`
  - Whish App LBP Only Days credits the Alfa / MTC drawer and primary line; USD does not; deferPayment sibling credits; void nets to 0.
- Frontend: `cd frontend && npx jest src/features/recharge` (affected suites)
  - Katsh Only Days suites unchanged and green (extraction is a pure move).
  - Whish App: panel shows only for eligible LBP cards; each builder (walk-in, session sub-items, basket checkout, partner) carries the per-unit fields; one variant table walks all modes.
- Web e2e: `node scripts/run-e2e.mjs web -g "Only Days"` (new `lira-web-1xx` spec; also saves the What's new screenshot).

## Manual (test tenant, web)
1. Mobile Recharge → Whish App → Bills (LBP). Pick Alfa 7.58, open it, tick Only Days → price 250,000 LBP, returned credit $7.00.
2. Pay cash, save. Expect: Whish App LBP −765,007; Alfa USD +$7.00; main Alfa line +$7.00; profit counts the returned credit.
3. Refund from Transactions → every figure back to its start.
4. Repeat through a customer session, a Whish + Katsh basket, and For Partner.
