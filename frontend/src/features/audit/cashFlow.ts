// Cash-flow direction and payment-leg helpers for the transactions table.
//
// Moved to core (packages/core/src/utils/cashFlow.ts) so the phone's Activity
// tab reads the exact same rule (rule 14). Re-exported here so every existing
// import and test in the web app keeps working unchanged.
export {
  extraCurrencyLegs,
  formatLegAmount,
  formatPaymentLegs,
  getCashFlowDirection,
  getRowCashFlowDirection,
  isCashTransaction,
  saleTenderTotals,
  type CashFlowDirection,
  type TransactionPaymentLeg,
} from "@liratek/core";
