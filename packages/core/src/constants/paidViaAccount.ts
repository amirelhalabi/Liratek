/**
 * "Paid through the customer's account" on the Transactions page Type filter
 * — the Debts twin of `paidViaDrawer.ts` (LIRA-323).
 *
 * Every Type-filter option in the Debts group carries `paid_via_account`.
 * Selecting it shows the option's own rows AND rows of other types that are
 * linked to a customer account (`debt_ledger`): a sale or repair charged to
 * the account, change kept as credit, a session basket left on the account.
 *
 * Why `debt_ledger` and not `payments`: a CUSTOMER_ACCOUNT leg moves no
 * drawer, so no `payments` row is ever written for it (NON_DRAWER_METHODS in
 * utils/payments.ts) — the drawer route cannot see it. The ledger link
 * (`transaction_id`, or `session_id` for a basket) is the same link the
 * void/refund path trusts (rule 20), and it exists on rows older than
 * `payment_snapshot`.
 *
 * `PAID_VIA_ACCOUNT_OWN_TUPLES` is the ONE definition (rule 14) of the Debts
 * group's own rows: a row matching any of them shows only under its own
 * option, never through the account route. Consumed by
 * `TransactionRepository.getRecent` (SQL + the row's `paid_via_account` flag)
 * and `useTransactionRows.ts` (client twin, which reads that flag);
 * `paidViaDrawerOptions.guard.test.ts` (frontend) fails if FILTER_GROUPS'
 * tagged options and this list ever disagree.
 *
 * Leaf module (rule 29): type-only imports, reachable from `browser.ts`.
 */
import type { PaidViaDrawerOwnTuple } from "./paidViaDrawer.js";

export const PAID_VIA_ACCOUNT_OWN_TUPLES: readonly PaidViaDrawerOwnTuple[] = [
  { type: "DEBT_REPAYMENT" },
  { type: "ACCOUNT_ADJUSTMENT" },
  { type: "CREDIT_CASH_IN" },
  { type: "DEBT_CASH_OUT" },
  { type: "CREDIT_CASH_OUT" },
];
