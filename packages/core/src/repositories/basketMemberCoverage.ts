/**
 * LIRA-304 — the only writers of a basket member's coverage
 * (`customer_session_transactions.covered_*`). Each keeps the basket's
 * `'Session Debt'` row in step, so invariant I1 holds after every write:
 *
 *   Σ non-sale member (owed − covered − refund credit) = row outstanding
 *
 * Shared by DebtRepository (repayment / discount coverage) and
 * TransactionRepository (repayment void / refund) — rule 14, one writer.
 * Every statement is tenant-scoped and `?`-bound.
 */
import type Database from "better-sqlite3";
import { DatabaseError } from "../utils/errors.js";

const EPS_USD = 0.01;
const EPS_LBP = 1;

/** Pay `usd`/`lbp` of one member's share and the same amount on its basket
 *  row. Refuses (throws) when the member would be over-covered — e.g. two
 *  repayments racing for the same item (spec edge case, task E1). */
export function coverBasketMember(
  db: Database.Database,
  tenantId: number,
  memberId: number,
  usd: number,
  lbp: number,
): { rowId: number } {
  const member = db
    .prepare(
      `SELECT cst.session_id FROM customer_session_transactions cst
       WHERE cst.id = ? AND cst.tenant_id = ?`,
    )
    .get(memberId, tenantId) as { session_id: number } | undefined;
  if (!member) {
    throw new DatabaseError(`Basket item ${memberId} not found`);
  }
  const row = db
    .prepare(
      `SELECT id FROM debt_ledger
       WHERE session_id = ? AND tenant_id = ? AND transaction_type = 'Session Debt'
         AND transaction_id IS NULL
       ORDER BY id ASC LIMIT 1`,
    )
    .get(member.session_id, tenantId) as { id: number } | undefined;
  if (!row) {
    throw new DatabaseError(`Basket item ${memberId} has no basket debt`);
  }
  const changed = db
    .prepare(
      `UPDATE customer_session_transactions
       SET covered_usd = covered_usd + ?, covered_lbp = covered_lbp + ?,
           updated_at = datetime('now')
       WHERE id = ? AND tenant_id = ?
         AND covered_usd + ? <= owed_usd + ${EPS_USD}
         AND covered_lbp + ? <= owed_lbp + ${EPS_LBP}`,
    )
    .run(usd, lbp, memberId, tenantId, usd, lbp).changes;
  if (changed !== 1) {
    throw new DatabaseError(
      "This item was already paid by another repayment — reload and try again.",
    );
  }
  db.prepare(
    `UPDATE debt_ledger SET covered_usd = covered_usd + ?, covered_lbp = covered_lbp + ?
     WHERE id = ? AND tenant_id = ?`,
  ).run(usd, lbp, row.id, tenantId);
  return { rowId: row.id };
}

/** Give back exactly what a repayment paid on one member (its void). */
export function uncoverBasketMember(
  db: Database.Database,
  tenantId: number,
  memberId: number,
  rowId: number,
  usd: number,
  lbp: number,
): void {
  db.prepare(
    `UPDATE customer_session_transactions
     SET covered_usd = MAX(0, covered_usd - ?), covered_lbp = MAX(0, covered_lbp - ?),
         updated_at = datetime('now')
     WHERE id = ? AND tenant_id = ?`,
  ).run(usd, lbp, memberId, tenantId);
  db.prepare(
    `UPDATE debt_ledger SET covered_usd = MAX(0, covered_usd - ?), covered_lbp = MAX(0, covered_lbp - ?)
     WHERE id = ? AND tenant_id = ?`,
  ).run(usd, lbp, rowId, tenantId);
}

/**
 * A basket row's coverage went DOWN by `usd`/`lbp` through a path that does
 * not know its members (voiding a repayment booked before LIRA-304, whose
 * record names only the row). Reopen the members by the same amount so I1
 * still holds: newest member first, un-covering what it has; whatever is
 * left raises the newest member's share. The caller has already lowered
 * the row's own `covered_*`.
 */
export function reopenBasketMembers(
  db: Database.Database,
  tenantId: number,
  rowId: number,
  usd: number,
  lbp: number,
): void {
  if (usd <= 0 && lbp <= 0) return;
  const row = db
    .prepare(
      `SELECT session_id FROM debt_ledger WHERE id = ? AND tenant_id = ? AND transaction_type = 'Session Debt'`,
    )
    .get(rowId, tenantId) as { session_id: number | null } | undefined;
  if (!row?.session_id) return;
  const members = db
    .prepare(
      `SELECT cst.id, cst.covered_usd, cst.covered_lbp
       FROM customer_session_transactions cst
       JOIN transactions t ON t.id = cst.unified_transaction_id AND t.tenant_id = cst.tenant_id
       WHERE cst.session_id = ? AND cst.tenant_id = ?
         AND cst.transaction_type <> 'session_item_refund'
         AND t.type <> 'SALE'
         AND (cst.amount_usd > 0 OR cst.amount_lbp > 0)
       ORDER BY cst.id DESC`,
    )
    .all(row.session_id, tenantId) as Array<{
    id: number;
    covered_usd: number;
    covered_lbp: number;
  }>;
  if (members.length === 0) return;
  let leftUsd = usd;
  let leftLbp = lbp;
  const upd = db.prepare(
    `UPDATE customer_session_transactions
     SET covered_usd = covered_usd - ?, covered_lbp = covered_lbp - ?,
         owed_usd = owed_usd + ?, owed_lbp = owed_lbp + ?, updated_at = datetime('now')
     WHERE id = ? AND tenant_id = ?`,
  );
  for (const m of members) {
    const u = Math.min(leftUsd, Math.max(0, m.covered_usd));
    const l = Math.min(leftLbp, Math.max(0, m.covered_lbp));
    if (u > 0 || l > 0) upd.run(u, l, 0, 0, m.id, tenantId);
    leftUsd -= u;
    leftLbp -= l;
  }
  // Coverage the members never had (checkout pre-cover, legacy rounding):
  // reopen it as extra share on the newest member.
  if (leftUsd > 1e-9 || leftLbp > 1e-9) {
    upd.run(0, 0, Math.max(0, leftUsd), Math.max(0, leftLbp), members[0].id, tenantId);
  }
}
