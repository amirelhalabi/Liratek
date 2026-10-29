/**
 * LIRA-345 (owner decisions S1/S3, 2026-10-26), rule 14 — the ONE
 * definition of "this supplier is settled on the day calendar" (the
 * LIRA-343 Settle Account sheet), shared by:
 *   - the Suppliers page: the "Settle Account" button opens the calendar and
 *     the Pay / Receive tab is hidden (S3);
 *   - the server: the amount-first settle refuses a supplier outside it
 *     (`SupplierRepository.settlesByDay`);
 *   - the Transactions labels: they come from settlement coverage
 *     (`FinancialService.getAllByProvider`).
 *
 * Who settles by day:
 *   - the OMT account: its parent and every member (LIRA-343);
 *   - Katsh (its top-ups; its bills stay on the "Settle" tick list);
 *   - Whish, when active (its bills too stay on the tick list);
 *   - product suppliers (`is_system = 0`, no provider).
 * Never Loto: it keeps its checkpoints (S1), whatever else is set.
 *
 * Each caller resolves `is_account_member` itself (the page from the
 * account balances, the repository from `account_supplier_id`).
 *
 * Pure leaf (rule 29): reachable from `browser.ts`, so no imports.
 */

export interface SettlesByDayInput {
  provider: string | null;
  is_system: number;
  /** Absent = active. */
  is_active?: number | null;
  /** True for the OMT account parent and its members. */
  is_account_member: boolean;
}

export function settlesByDay(s: SettlesByDayInput): boolean {
  // LIRA-351 (owner decision 2026-10-29): Loto settles on the calendar too.
  // Its old checkpoint settlements were stamped by migration v226.
  if (s.provider === "LOTO") return true;
  if (s.is_account_member) return true;
  if (s.provider === "Katsh") return true;
  if (s.provider === "WHISH") return s.is_active !== 0;
  return s.is_system === 0 && !s.provider;
}

/**
 * LIRA-345 (S1) — the calendar supplier's bills stay on today's "Settle"
 * tick list (their commission is settled there, bill by bill), and the
 * calendar leaves them out. True for a calendar supplier with a provider
 * that is not part of the OMT account (Katsh, Whish).
 */
export function billsStayOnTickList(s: SettlesByDayInput): boolean {
  // Loto has no bills: its tickets and prizes are the calendar's own rows.
  return (
    settlesByDay(s) &&
    !s.is_account_member &&
    !!s.provider &&
    s.provider !== "LOTO"
  );
}

/**
 * LIRA-345 (S4) — does the calendar sheet take a settlement-day commission
 * for this supplier? The OMT account and Whish (pay in full; the commission
 * becomes a credit on the supplier, used next time). Katsh's commission is
 * on its bills (tick list) and product suppliers have none, so the field
 * is hidden for them.
 */
export function calendarTakesCommission(s: SettlesByDayInput): boolean {
  return settlesByDay(s) && (s.is_account_member || s.provider === "WHISH");
}

/**
 * LIRA-345 — the stale-sheet refusal names the supplier being settled
 * ("Katsh's balance changed…"), and the sheet recognises it whatever the
 * name. ONE wording for both sides (rule 14).
 */
export const SETTLE_STALE_MARK =
  "'s balance changed since you opened this sheet.";

export function settleStaleMessage(name: string): string {
  return `${name}${SETTLE_STALE_MARK}`;
}

export function isSettleStaleMessage(message: string): boolean {
  return message.includes(SETTLE_STALE_MARK);
}

/**
 * LIRA-351 (owner decisions 2026-10-29) — Loto is settled only on the day
 * calendar. The old paths that record a Loto payment tied to no shop day
 * (checkpoint settle / batch / mark settled, and Pay / Receive) are refused
 * with these words on both transports (ONE wording, rule 14).
 */
export const LOTO_SETTLE_MOVED_MESSAGE =
  "Loto is now settled from Suppliers → Loto → Settle Account.";
export const LOTO_PAY_MOVED_MESSAGE =
  "Pay Loto from Settle Account so the payment is tied to its days.";
