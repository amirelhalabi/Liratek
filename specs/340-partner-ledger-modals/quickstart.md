# Quickstart: verify LIRA-340

1. Core: `cd packages/core && npx jest src/repositories/__tests__/PartnerRepository.ledgerGroup.test.ts` — a partner with a FOR_POS, a THROUGH_OMT_SEND, a SETTLEMENT (Split), a DISCOUNT and an ADJUSTMENT: payments = 3, transactions = 2, sum = 5.
2. Frontend: `cd frontend && npx jest src/features/partners/pages/Partners/__tests__/Partners.tableModals.test.tsx` — buttons show counts, no inline table, each window lists its group, Escape closes.
3. Web e2e: `node scripts/run-e2e.mjs web view=off tests/e2e-web/lira-web-07x-partner-ledger-modals.spec.ts` — same over REST; saves the What's new screenshot.
4. `node scripts/build-release-notes.cjs --check`.
