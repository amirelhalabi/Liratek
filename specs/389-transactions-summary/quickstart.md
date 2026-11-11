# Quickstart — validating LIRA-389

1. Core (failing-first, then green):
   `cd packages/core && npx jest src/services/__tests__/TransactionSummaryService.test.ts --maxWorkers=2`
   — fixture: multi-line sale, whole-refunded sale, item-refunded sale, OMT send + receive,
   session basket (sale + OMT send), recharge, expense (+ an auto expense), deleted and
   renamed product. Expect per-dimension rows/units/volumes and the R3 TOTAL formula
   against `getRecent` + `isTransactionListRowVisible`.
2. Backend: `cd backend && npx jest src/api/__tests__/transactionsSummary.api.test.ts`.
3. Electron: `cd electron-app && npx jest handlers/__tests__/transactionHandlers.summary.test.ts`.
4. Frontend: `cd frontend && npx jest src/features/audit/pages/__tests__/TransactionsViewer.summary.test.tsx`.
5. Web e2e: `rm -f frontend/test-results/e2e-web/phone_shop.web.db*` then
   `node scripts/run-e2e.mjs web view=off --min=1 lira-web-100 lira-web-018 lira-web-037`.
6. Manual: Audit & Transactions → Summary → Group by Product → TOTAL equals the list's sales
   count; click a row → List with a chip, same count; Excel → "Summary by Product" sheet.
