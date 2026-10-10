/**
 * LIRA-296 P3 — supplier returns (table `supplier_returns`, v207): a
 * defective item sent back to its supplier, and the supplier's answer
 * (CREDITED / REPLACED / REJECTED). Each closed row keeps the links to what
 * its outcome wrote — the supplier ledger entry, the WARRANTY_COST row, the
 * restock batch — so voiding the claim can reverse each one (rule 20).
 * SQL only, tenant-scoped (rule 13).
 */
import { BaseRepository, type BaseEntity } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import type { SupplierReturnStatus } from "../validators/warranty.js";

export interface SupplierReturnEntity extends BaseEntity {
  tenant_id: number;
  defective_item_id: number;
  warranty_claim_id: number;
  supplier_id: number;
  status: SupplierReturnStatus;
  credit_usd: number;
  credit_lbp: number;
  ledger_entry_id: number | null;
  cost_transaction_id: number | null;
  restock_batch_id: number | null;
  user_id: number;
  closed_by: number | null;
  sent_at: string | null;
  closed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** Joined for display (the admin list). */
  supplier_name?: string | null;
  product_id?: number | null;
  product_name?: string | null;
  serial?: string | null;
  unit_cost_usd?: number | null;
}

const COLUMNS =
  "id, tenant_id, defective_item_id, warranty_claim_id, supplier_id, status, credit_usd, credit_lbp, ledger_entry_id, cost_transaction_id, restock_batch_id, user_id, closed_by, sent_at, closed_at, notes, created_at, updated_at";

export class SupplierReturnRepository extends BaseRepository<SupplierReturnEntity> {
  constructor() {
    super("supplier_returns");
  }

  protected getColumns(): string {
    return COLUMNS;
  }

  insertReturn(data: {
    defectiveItemId: number;
    warrantyClaimId: number;
    supplierId: number;
    userId: number;
    notes: string | null;
  }): number {
    const result = this.execute(
      `INSERT INTO supplier_returns (
         tenant_id, defective_item_id, warranty_claim_id, supplier_id, status,
         user_id, notes, sent_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'SENT', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      getCurrentTenantId(),
      data.defectiveItemId,
      data.warrantyClaimId,
      data.supplierId,
      data.userId,
      data.notes,
    );
    return Number(result.lastInsertRowid);
  }

  /** Close a SENT return with its outcome and the links it wrote. */
  close(
    id: number,
    data: {
      status: Exclude<SupplierReturnStatus, "SENT">;
      creditUsd: number;
      creditLbp: number;
      ledgerEntryId: number | null;
      costTransactionId: number | null;
      restockBatchId: number | null;
      closedBy: number;
      notes: string | null;
    },
  ): void {
    this.execute(
      `UPDATE supplier_returns
          SET status = ?, credit_usd = ?, credit_lbp = ?, ledger_entry_id = ?,
              cost_transaction_id = ?, restock_batch_id = ?, closed_by = ?,
              notes = COALESCE(?, notes), closed_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND tenant_id = ? AND status = 'SENT'`,
      data.status,
      data.creditUsd,
      data.creditLbp,
      data.ledgerEntryId,
      data.costTransactionId,
      data.restockBatchId,
      data.closedBy,
      data.notes,
      id,
      getCurrentTenantId(),
    );
  }

  /** Every return of a claim, oldest first. */
  listForClaim(claimId: number): SupplierReturnEntity[] {
    return this.query<SupplierReturnEntity>(
      `SELECT ${COLUMNS} FROM supplier_returns
        WHERE warranty_claim_id = ? AND tenant_id = ? ORDER BY id`,
      claimId,
      getCurrentTenantId(),
    );
  }

  /** Remove a claim's returns once the claim void has reversed them. */
  deleteForClaim(claimId: number): number {
    return this.execute(
      `DELETE FROM supplier_returns WHERE warranty_claim_id = ? AND tenant_id = ?`,
      claimId,
      getCurrentTenantId(),
    ).changes;
  }

  /** The admin list, newest first, optionally one status. */
  list(status?: SupplierReturnStatus): SupplierReturnEntity[] {
    const tenantId = getCurrentTenantId();
    const params: unknown[] = [tenantId, tenantId, tenantId, tenantId, tenantId];
    let where = "r.tenant_id = ?";
    if (status) {
      where += " AND r.status = ?";
      params.push(status);
    }
    return this.query<SupplierReturnEntity>(
      `SELECT ${COLUMNS.split(", ")
        .map((c) => `r.${c}`)
        .join(", ")},
              s.name AS supplier_name, d.product_id AS product_id,
              p.name AS product_name, pu.imei AS serial,
              d.unit_cost_usd AS unit_cost_usd
         FROM supplier_returns r
         LEFT JOIN suppliers s ON s.id = r.supplier_id AND s.tenant_id = ?
         LEFT JOIN defective_items d ON d.id = r.defective_item_id AND d.tenant_id = ?
         LEFT JOIN products p ON p.id = d.product_id AND p.tenant_id = ?
         LEFT JOIN product_units pu ON pu.id = d.unit_id AND pu.tenant_id = ?
        WHERE ${where}
        ORDER BY r.created_at DESC, r.id DESC`,
      ...params,
    );
  }
}

let instance: SupplierReturnRepository | null = null;
export function getSupplierReturnRepository(): SupplierReturnRepository {
  if (!instance) instance = new SupplierReturnRepository();
  return instance;
}
export function resetSupplierReturnRepository(): void {
  instance = null;
}
