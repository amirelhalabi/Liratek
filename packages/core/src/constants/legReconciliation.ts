/**
 * The ONE tolerance a payment's legs may miss its expected total by, in
 * USD-equivalent. The server's `reconcileLegs` (repositories/moneyPosting.ts)
 * refuses anything further off; screens that pre-check coverage (the Vouchers
 * page) read the same number so the button and the server never disagree
 * (rule 14). A Node-free leaf: reachable from browser.ts (rule 29).
 */

/** $0.05 USD-equivalent — roughly 5,000 LBP at typical (~90,000-100,000)
 *  USD/LBP sell rates. Owner-specified (S2). */
export const LEG_RECONCILIATION_EPSILON_USD = 0.05;
