/**
 * LIRA-201b (owner note #11-B) — which ONE row of a customer-session basket
 * carries the pooled in/out + payment detail on screen and on export.
 *
 * Pre-fix, EVERY session member inherited the whole basket's pooled legs
 * into its own `row.payments` (TransactionRepository._attachPaymentLegs),
 * so a -400,000 LBP loto prize row and a 1,280,000 LBP ticket row printed
 * the identical pooled summary — the owner's reported "duplicate summary".
 * The backend now exposes the pool on EVERY member's `session_payments` /
 * `session_account_payments` (TransactionWithUser), and the viewer decides
 * which single member renders it, via this module.
 *
 * Pure and dependency-free (row-in/Map-out) so it is unit-testable without
 * rendering the table, same rationale as the other `../audit` modules.
 */
// Moved to core (utils/transactionRowDisplay.ts) so the phone picks the same
// basket header row; re-exported for this app's existing imports.
export {
  computeSessionGroupHeaders,
  isSessionGroupHeader,
} from "@liratek/core";
