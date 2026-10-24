# Quickstart validation: LIRA-339

Run only affected tests. Ask the owner before running suites (standing preference).

1. Core: `yarn workspace @liratek/core jest src/repositories/__tests__/VoucherRepository.sale.test.ts src/repositories/__tests__/VoucherRepository.cancelRefund.test.ts src/repositories/__tests__/TransactionRepository.paidViaVoucher.test.ts src/services/__tests__/VoucherService.variants.test.ts`
   Expected: sell→cancel nets to 0 per drawer per currency; legacy cancel pays out 0; a generic void of either type is refused; Profit summary unchanged.
2. Frontend: `yarn workspace @liratek/frontend jest src/features/audit/__tests__/paidViaDrawerOptions.guard.test.ts src/features/audit/hooks/__tests__/useTransactionRows.paidViaVoucher.test.ts src/features/vouchers`
3. Web e2e: `node scripts/run-e2e.mjs web -g "lira-web-079"`
   - Sell a $50 voucher for $60 cash with $10 change. The drawer delta is +$50, and a "Voucher sold" row shows for the client.
   - Cancel it with a cash refund. The drawer delta is −$50, and a "Voucher cancelled" row shows.
   - Filter on Vouchers → Voucher sold. The voucher rows and a gift-card-paid POS sale show.
   - The spec saves `frontend/public/whats-new/<next>/voucher-sale.png`.
4. Desktop: not run on this Mac. Covered by core jest plus `electron-app/handlers/__tests__/voucherHandlers.test.ts`.
5. Gates: `yarn typecheck`, `yarn lint`, `node scripts/build-release-notes.cjs --check`.
