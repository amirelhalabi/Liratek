# Quickstart — validate LIRA-394

```bash
cd packages/core
npx jest src/services/__tests__/ProfitService.saleDrilldownRefundedAndExtra.test.ts \
  src/repositories/__tests__/ProfitRepository.moduleDetailReconciliation.test.ts \
  src/repositories/__tests__/ProfitRepository.extraChargeAccountHold.test.ts \
  src/repositories/__tests__/ProfitRepository.correlatedTenantIndex.guard.test.ts \
  src/constants/__tests__/profitRecognition.guard.test.ts
yarn workspace @liratek/core typecheck
yarn workspace @liratek/backend typecheck
```

Expected: fully refunded sales (whole or line-by-line, paid or on account) absent
from the SALE drill-down; "$18 + $2 extra" on account reads
"Customer still owes — paid $0.00 of $20.00." and after a $10 repayment
"paid $10.00 of $20.00."; the reconciliation suite's refunded-with-residual row
still counted (100 %, +5) with a "Refunded: …" detail.

Contracts: none — internal repository/service change; the IPC/REST payload shape is unchanged.
