/**
 * LIRA-079 — plain-language "can't refund here, because…" messages for every
 * transaction type in core's `NON_REVERSIBLE_TRANSACTION_TYPES`
 * (packages/core/src/constants/transactionTypes.ts).
 *
 * Owner decision (2026-10-02): keep the safe list as-is — Refund/Void stay
 * available on every generically-reversible type, and the deliberately
 * protected types keep their dedicated reversal path. What was missing is
 * that the Transactions page showed NOTHING for a protected row (just "—"),
 * leaving the operator to guess why the buttons are gone. This file is the
 * single source of truth for that explanation (rule 14) — one message per
 * type, each naming the real correction path, sourced from the rationale
 * already written next to each entry in `NON_REVERSIBLE_TRANSACTION_TYPES`.
 *
 * Deliberately pure/presentational: reads only `row.type` (already present
 * on both the IPC and REST transaction-row shape), so it needs no backend
 * change and behaves identically on desktop and web (rule 19).
 *
 * Keep this in lockstep with core's `NON_REVERSIBLE_TRANSACTION_TYPES` —
 * `nonReversibleReasons.guard.test.ts` enforces every member has an entry
 * here (and that nothing stale lingers for a type since moved OUT of that
 * set, e.g. RECHARGE_TOPUP/SUPPLIER_SETTLEMENT/PARTNER_SETTLEMENT history).
 */

export const NON_REVERSIBLE_REASONS: Readonly<Record<string, string>> = {
  LOTO_CASH_PRIZE:
    "Loto cash prizes are reversed only as part of their session basket — void or refund the basket from one of its other rows on this page, or from the Loto page.",
  LOTO_SETTLEMENT:
    "A settled Loto checkpoint can't be refunded or voided here — correct it with a new checkpoint/settlement from the Loto page.",
  REFUND:
    "This row is itself a refund — it can't be refunded or voided again. An admin can undo a per-item refund right from this row (\"Undo refund\"); other refunds have no undo yet.",
  REFUND_UNDO:
    "This row already undoes a refund — it can't be refunded, voided, or undone again.",
  CREDIT_CASH_OUT:
    "Correct this from the Debts page with an opposite manual entry — voiding here would return the cash without restoring the client's credit.",
  CREDIT_CASH_IN:
    "Correct this from the Debts page with the opposite manual entry (Add Debt cancels Add Credit) — that corrects both the drawer and the client's balance.",
  DEBT_CASH_OUT:
    "Correct this from the Debts page with the opposite manual entry (Add Credit cancels Add Debt) — that corrects both the drawer and the client's balance.",
  KEPT_CHANGE:
    "Nothing to reverse on this row by itself — the kept change stays in the drawer either way. Void or refund the sale this change belongs to instead.",
  PARTNER_ADJUSTMENT:
    "Correct this from the Partners page with an opposite Add Credit/Debt entry.",
  ACCOUNT_ADJUSTMENT:
    "Correct this from the Accounts page with an opposite Add Credit/Debt entry.",
  SUPPLIER_ADJUSTMENT:
    "Correct this from the Suppliers page with an opposite Add Credit/Debt entry.",
  COUNTERPARTY_DISCOUNT:
    "Correct this with an opposite discount from the Partners/Suppliers page, not a refund here.",
  MTC_TOPUP:
    "Correct this with an opposite manual top-up from the Recharge page.",
  ALFA_TOPUP:
    "Correct this with an opposite manual top-up from the Recharge page.",
  DRAWER_TOPUP:
    "Correct this with an opposite transfer from the Dashboard.",
  DRAWER_CASHOUT:
    "Correct this with an opposite Drawer Top-Up from the Dashboard.",
  HOLD_MONEY:
    "Held money is reversed from the Hold Money page (collect or adjust it there), not with a refund here.",
  HOLD_MONEY_COLLECT:
    "Undo a pickup from the Hold Money page (\"Void pickup\"), not with a refund here.",
  HOLD_MONEY_COLLECT_VOID:
    "This row already reverses a Hold Money pickup — it can't be reversed again.",
  LOTO_MONTHLY_FEE:
    "Correct this from the Loto monthly-fee page, not with a refund here.",
  CHECKPOINT:
    "Checkpoints are a point-in-time count, not a transaction to undo — correct a bad count with a new checkpoint.",
  CARRIER_LINE_ADJUSTMENT:
    "Correct this by editing the carrier line again from the MTC/Alfa page — a hand-edit is a standing correction, not something to reverse.",
  CLIENT_CREATED:
    "This is a client-record audit entry, not a money transaction — there's nothing to refund.",
  CLIENT_UPDATED:
    "This is a client-record audit entry, not a money transaction — there's nothing to refund.",
  CLIENT_DELETED:
    "This is a client-record audit entry, not a money transaction — there's nothing to refund.",
};

/**
 * The reason a row can't be Refunded/Voided from this page, or `null` when
 * the type isn't one of the protected ones (either it's genuinely
 * reversible, or it's in some other already-handled state — e.g. already
 * voided/refunded — which `isReversibleRow` already distinguishes
 * separately and this function does not attempt to explain).
 */
export function getNonReversibleReason(type: string): string | null {
  return NON_REVERSIBLE_REASONS[type] ?? null;
}
