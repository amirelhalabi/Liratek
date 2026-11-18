# Quickstart — verify LIRA-396

```bash
cd packages/core
npx jest src/services/__tests__/ProfitService.lira396DrilldownLabelsCost.test.ts \
  src/repositories/__tests__/ProfitRepository.moduleDetailReconciliation.test.ts \
  src/constants/__tests__/profitRecognition.guard.test.ts
```

Expected results:

- An Only Days Katsh sale reads price − cost = profit in the FINANCIAL_SERVICE_Katsh drill-down. The Suppliers history still shows the gross cost.
- Create + refund of that sale nets to 0 on the Katsh drawer, the MTC drawer, the carrier line and profit.
- FS/loto/maintenance/custom rows show the module's own summary and never a blank cell.
- KEPT_CHANGE and TOPUP_BUYBACK do not list $0 rows, and Σ counted equals the module row.

On Cornertech after deploy: FS #2220 reads 2,500,000 / 1,755,030 / 744,970.
