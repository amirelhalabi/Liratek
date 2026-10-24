/**
 * "Paid with a gift card" on the Transactions page Type filter — the
 * Vouchers twin of `paidViaAccount.ts` / `paidViaDrawer.ts` (LIRA-339).
 *
 * Every Type-filter option in the Vouchers group carries `paid_via_voucher`.
 * Selecting it shows the option's own rows AND rows of other types paid with
 * a voucher: a transaction whose id is a voucher's `redeemed_transaction_id`,
 * or a session basket whose id is a voucher's `redeemed_session_id`
 * (stamped from migration v224 on; earlier basket redemptions are not
 * detectable).
 *
 * `PAID_VIA_VOUCHER_OWN_TUPLES` is the ONE definition (rule 14) of the
 * Vouchers group's own rows: a row matching any of them shows only under its
 * own option, never through the voucher route. Consumed by
 * `TransactionRepository.getRecent` and the client twin in
 * `useTransactionRows.ts`; the frontend options guard fails if FILTER_GROUPS'
 * tagged options and this list ever disagree.
 *
 * Leaf module (rule 29): type-only imports, reachable from `browser.ts`.
 */
import type { PaidViaDrawerOwnTuple } from "./paidViaDrawer.js";

export const PAID_VIA_VOUCHER_OWN_TUPLES: readonly PaidViaDrawerOwnTuple[] = [
  { type: "VOUCHER_SALE" },
  { type: "VOUCHER_CANCEL" },
];
