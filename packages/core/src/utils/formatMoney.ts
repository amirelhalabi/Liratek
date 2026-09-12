/**
 * Render a plain currency amount for a STORED summary/ledger-note string
 * (`transactions.summary`, `recharges.note`, `supplier_ledger.note`, etc.),
 * matching the transactions-table cash-flow badge's own formatting
 * (`frontend/src/features/audit/pages/TransactionsViewer.tsx`'s
 * `formatAmount`: `$${usd.toLocaleString()}` for USD, `${lbp.toLocaleString()}
 * LBP` for LBP) so a row's stored text and its badge never disagree on the
 * same number.
 *
 * Before this helper existed, every money repository hand-rolled its own
 * `${amount} ${currency}` (or a bespoke `.toLocaleString()` variant) inline —
 * the raw, comma-less form is exactly the bug this fixes: a live row once
 * showed a badge of "↓ 700,579 LBP" beside a stored summary reading
 * "...: 700579 LBP" on the SAME row (RechargeRepository's supplier/app/
 * partner/client top-up builders). Use this instead of a sixth hand-rolled
 * copy.
 *
 * Lives in `utils/`, not beside its original callers in `moneyPosting.ts`,
 * because it must be reachable from BOTH @liratek/core entry points
 * (`index.ts` for Node/electron/backend, `browser.ts` for Vite/the
 * renderer — see browser.ts's own header comment). `moneyPosting.ts`
 * transitively reaches the database (moneyPosting -> utils/payments.js ->
 * PaymentMethodRepository.js -> db/connection.js's `getDatabase`), so a
 * value export of that module from `browser.ts` would pull in
 * better-sqlite3 and break the renderer at load. This file has ZERO
 * imports, so it is trivially safe in both entry points.
 */
export function formatMoneyAmount(
  amount: number,
  currencyCode: string,
): string {
  if (currencyCode === "USD") return `$${amount.toLocaleString()}`;
  if (currencyCode === "LBP") return `${amount.toLocaleString()} LBP`;
  return `${amount.toLocaleString()} ${currencyCode}`;
}
