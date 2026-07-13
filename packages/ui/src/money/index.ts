// Multi-currency payment engine (docs/plans/done_plans/MULTI_CURRENCY_PAYMENT_PLAN.md).
// Pure TS, no React. Lives in @liratek/ui because every consumer today is a
// frontend form; graduates to its own package the FIRST time packages/core or
// backend needs it (decision D2 — never copy it).
export {
  MoneyError,
  type AllocationResult,
  type CrossApplication,
  type CurrencyInfo,
  type Money,
  type RatePair,
  type RateSide,
  type RateTable,
} from "./types";
export {
  currencyInfo,
  DEFAULT_CURRENCIES,
  isSettled,
  roundForCurrency,
  type CurrencyRegistry,
} from "./registry";
export { convert, crossRate } from "./convert";
export {
  allocatePayments,
  type AllocationInput,
  type AllocationOptions,
} from "./allocate";
