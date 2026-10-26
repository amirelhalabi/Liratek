/**
 * LIRA-343 (US5/US6) — an OMT transfer seeded WITH the unified transactions
 * the real writers book, so a void/refund of it runs the production path:
 *
 *  - the transfer's own FINANCIAL_SERVICE transaction (`source_table =
 *    'financial_services'`), and
 *  - the hidden SUPPLIER_PAYMENT transaction of its auto TOP_UP sibling,
 *    linked by `supplier_ledger.transaction_id` — `_cascadeSupplierSiblingVoid`
 *    only reaches a sibling through that link. `seedOmtSend` alone leaves it
 *    NULL, so a void would leave the sibling's debt on the ledger (a shape
 *    production never has).
 */
import Database from "better-sqlite3";
import { getTransactionRepository } from "../TransactionRepository";
import { TRANSACTION_TYPES } from "../../constants/transactionTypes";
import { seedOmtSend } from "./omtAccountDb";

export interface SeededTransfer {
  /** financial_services.id */
  fsId: number;
  /** The transfer's own unified transaction (what the operator voids). */
  txnId: number;
  /** The auto TOP_UP sibling's supplier_ledger.id. */
  siblingLedgerId: number;
}

export function seedOmtSendWithTxns(
  db: Database.Database,
  omtId: number,
  data: Parameters<typeof seedOmtSend>[2],
): SeededTransfer {
  const fsId = seedOmtSend(db, omtId, data);
  const sibling = db
    .prepare(
      `SELECT id, amount_usd, amount_lbp FROM supplier_ledger
        WHERE tenant_id = 1 AND source_ref_table = 'financial_services' AND source_ref_id = ?`,
    )
    .get(fsId) as { id: number; amount_usd: number; amount_lbp: number };
  const repo = getTransactionRepository();
  const currency = data.currency ?? "USD";
  const txnId = repo.createTransaction({
    type: TRANSACTION_TYPES.FINANCIAL_SERVICE,
    source_table: "financial_services",
    source_id: fsId,
    user_id: 1,
    amount_usd: currency === "USD" ? data.amount : 0,
    amount_lbp: currency === "LBP" ? data.amount : 0,
    summary: `OMT SEND ${data.amount} ${currency}`,
    metadata_json: {},
  });
  const siblingTxnId = repo.createTransaction({
    type: TRANSACTION_TYPES.SUPPLIER_PAYMENT,
    source_table: "supplier_ledger",
    source_id: sibling.id,
    user_id: 1,
    amount_usd: sibling.amount_usd,
    amount_lbp: sibling.amount_lbp,
    summary: "OMT top-up (auto)",
    metadata_json: { is_auto: true },
  });
  db.prepare(`UPDATE supplier_ledger SET transaction_id = ? WHERE tenant_id = 1 AND id = ?`).run(
    siblingTxnId,
    sibling.id,
  );
  return { fsId, txnId, siblingLedgerId: sibling.id };
}
