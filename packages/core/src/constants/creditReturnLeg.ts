/**
 * The ONE `payments.method` marker for a telecom credit-return leg: the
 * credits an "Only Days" card sale (Katsh/iPick alfa/mtc) hands back to the
 * shop's line (LIRA-090 writer: `FinancialServiceRepository
 * .processTelecomCreditReturn`). Readers: `TransactionRepository`
 * (INTERNAL_LEG_METHODS, `_attachPaymentLegs`) and `ProfitRepository`
 * (`ONLY_DAYS_TXN_IDS_SQL`, LIRA-396).
 *
 * A LEAF module on purpose. `ProfitRepository` builds a module-scope SQL
 * string from this value, and `ProfitRepository` ↔ `TransactionRepository`
 * form an import cycle: when the constant lived in `TransactionRepository`,
 * ESM evaluated `ProfitRepository` first and read it inside its temporal
 * dead zone — `ReferenceError: Cannot access 'CREDIT_RETURN_LEG_METHOD'
 * before initialization`, which crash-looped the Fly backend on boot
 * (2026-11-18). Jest (CommonJS) never trips this, so
 * `scripts/check-core-esm-import.mjs` guards it in CI. Node-free (rule 29).
 */
export const CREDIT_RETURN_LEG_METHOD = "CREDIT_RETURN";
