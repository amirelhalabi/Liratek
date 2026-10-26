/**
 * LIRA-344 — "Remove credit" on the OMT Settle Account sheet: an open
 * account credit (an ACCOUNT ledger row OMT owes the shop) that OMT will
 * never accept is closed and booked as a shop expense, with no drawer move.
 *
 * A pure leaf (rule 29): the browser reads these names too — the Expenses
 * page labels the category, the sheet bounds the reason — from the same
 * definitions the writer (`SupplierRepository.removeAccountCredit`) uses
 * (rule 14).
 */

/** The expense category of the books-only write-off expense. */
export const OMT_CREDIT_REMOVED_EXPENSE_CATEGORY = "OMT credit not accepted";

/** `metadata_json.mode` of the SUPPLIER_SETTLEMENT that removes a credit. */
export const ACCOUNT_CREDIT_WRITE_OFF_MODE = "CREDIT_WRITE_OFF";

/** The reason the operator must type: 3–200 characters (trimmed). */
export const ACCOUNT_CREDIT_REASON_MIN = 3;
export const ACCOUNT_CREDIT_REASON_MAX = 200;

/** The refusal every manual path gives for the write-off's own expense
 *  (Transactions void / refund, Expenses delete / re-categorise): it belongs
 *  to the credit removal, whose undo removes it (rule 20). */
export const OMT_CREDIT_REMOVED_EXPENSE_LOCKED_MESSAGE =
  "This expense belongs to a removed OMT credit. Undo the credit removal (void its settlement in Transactions) instead.";
