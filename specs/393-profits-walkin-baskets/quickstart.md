# Quickstart — LIRA-393

```bash
cd packages/core && npx jest src/constants/__tests__/anonymousSessionName.test.ts src/services/__tests__/ProfitService.anonymousBasketWalkIn.test.ts src/repositories/__tests__/ProfitRepository.moduleDetailReconciliation.test.ts src/constants/__tests__/profitRecognition.guard.test.ts src/__tests__/browserEntryIsNodeFree.guard.test.ts
cd frontend && npx jest src/features/sessions/components/__tests__/CustomerSessionButton.test.tsx
```

Expected: By Client has one "Walk-in" row holding both anonymous baskets, the real client "Client2" (with id) keeps its own row, Σ profit unchanged; drill-down counterparts read "Walk-in".
