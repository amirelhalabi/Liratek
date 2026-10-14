/**
 * LIRA-312 — the SQL fragments of a wrong-number record, defined ONCE (rule
 * 14). A leaf module (no repository imports) so `TransactionRepository`'s
 * expense-void guard can reuse them without an import cycle.
 */
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";

/** Refused when a wrong-number expense is undone while credits received for
 *  it are still active (research R6). */
export const UNDO_CREDITS_FIRST_ERROR = "Undo the credits received first.";

/**
 * "This transaction has been reversed" — VOIDED, or refunded (an active
 * REFUND row points back at it). Defined ONCE (rule 14). Reads alias `a`.
 */
export function reversedSql(a: string): string {
  return `(${a}.status <> 'ACTIVE' OR EXISTS (
    SELECT 1 FROM transactions rv
     WHERE rv.reverses_id = ${a}.id AND rv.tenant_id = ${a}.tenant_id
       AND rv.type = 'REFUND' AND rv.status = 'ACTIVE'))`;
}

/**
 * "An active credits-received entry of a wrong-number record" — defined ONCE
 * (rule 14) and reused by the record's totals, the cap check and the
 * expense-void guard (`TransactionRepository._assertReversible`). Reads alias
 * `a` of `transactions`; the caller binds the record id. A void writes a
 * reversal row of the SAME type and source (`reverses_id` set) — that row is
 * never an entry of its own.
 */
export function activeWrongNumberCreditsSql(a: string): string {
  return `${a}.type = '${TRANSACTION_TYPES.WRONG_NUMBER_CREDITS}'
    AND ${a}.source_table = 'wrong_number_cards'
    AND ${a}.source_id = ?
    AND ${a}.reverses_id IS NULL
    AND NOT ${reversedSql(a)}`;
}

