/**
 * The ONE "cancel this customer-account charge" insert (rule 14, LIRA-339).
 *
 * Writes a `debt_ledger` row of type 'Refund Reversal' that negates a
 * charge's amounts on the SAME `transaction_id`, so the charge and its
 * reversal net to 0 on one link, per currency. Ledger-only: an account leg
 * took no cash, so its reversal never touches a drawer.
 *
 * Shared by the generic void/refund (`TransactionRepository._cancelDebt`)
 * and the voucher cancel (`VoucherRepository.cancelWithRefund`), so both
 * write exactly the same shape. Call inside the caller's db.transaction().
 */
import type Database from "better-sqlite3";
import { requestNow } from "../utils/requestNow.js";

export interface DebtRefundReversalInput {
  clientId: number;
  /** The CHARGE's amounts (positive as booked); the row stores them negated. */
  amountUsd: number | null;
  amountLbp: number | null;
  /** The charge's own transaction_id (the original sale/service). */
  transactionId: number;
  createdBy: number | null;
  tenantId: number;
}

export const DEBT_REFUND_REVERSAL_NOTE = "Debt cancelled by refund/void";

export function insertDebtRefundReversal(
  db: Database.Database,
  input: DebtRefundReversalInput,
): void {
  db.prepare(
    `INSERT INTO debt_ledger (
       client_id, transaction_type, amount_usd, amount_lbp, transaction_id, note, created_by, tenant_id, created_at
     ) VALUES (?, 'Refund Reversal', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.clientId,
    -(input.amountUsd ?? 0),
    -(input.amountLbp ?? 0),
    input.transactionId,
    DEBT_REFUND_REVERSAL_NOTE,
    input.createdBy,
    input.tenantId,
    // LIRA-306 FR-021: the event time on an offline replay.
    requestNow(),
  );
}
