/**
 * LIRA-296 P2 — the defective-items holding (table `defective_items`, v206):
 * faulty units taken back from customers under a warranty claim. Not
 * sellable; they leave by supplier return, write-off, or "not faulty — back
 * to stock". SQL only, tenant-scoped (rule 13).
 */
import { BaseRepository, type BaseEntity } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";

export type DefectiveItemStatus =
  | "HELD"
  | "SENT_TO_SUPPLIER"
  | "WRITTEN_OFF"
  | "RETURNED_TO_STOCK";

export interface DefectiveItemEntity extends BaseEntity {
  tenant_id: number;
  product_id: number;
  unit_id: number | null;
  quantity: number;
  unit_cost_usd: number;
  warranty_claim_id: number;
  status: DefectiveItemStatus;
  restock_batch_id: number | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  /** Joined for display (the admin list). */
  product_name?: string | null;
  serial?: string | null;
  claim_action?: string | null;
  sale_item_id?: number | null;
}

const COLUMNS =
  "id, tenant_id, product_id, unit_id, quantity, unit_cost_usd, warranty_claim_id, status, restock_batch_id, resolved_at, created_at, updated_at";

export class DefectiveItemRepository extends BaseRepository<DefectiveItemEntity> {
  constructor() {
    super("defective_items");
  }

  protected getColumns(): string {
    return COLUMNS;
  }

  insertItem(data: {
    productId: number;
    unitId: number | null;
    quantity: number;
    unitCostUsd: number;
    warrantyClaimId: number;
  }): number {
    const result = this.execute(
      `INSERT INTO defective_items (
         tenant_id, product_id, unit_id, quantity, unit_cost_usd, warranty_claim_id,
         status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'HELD', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      getCurrentTenantId(),
      data.productId,
      data.unitId,
      data.quantity,
      data.unitCostUsd,
      data.warrantyClaimId,
    );
    return Number(result.lastInsertRowid);
  }

  findByClaim(claimId: number): DefectiveItemEntity | null {
    return this.queryOne<DefectiveItemEntity>(
      `SELECT ${COLUMNS} FROM defective_items
        WHERE warranty_claim_id = ? AND tenant_id = ? ORDER BY id LIMIT 1`,
      claimId,
      getCurrentTenantId(),
    );
  }

  /** The admin list, newest first, optionally one status. */
  list(status?: DefectiveItemStatus): DefectiveItemEntity[] {
    const tenantId = getCurrentTenantId();
    const params: unknown[] = [tenantId, tenantId, tenantId, tenantId];
    let where = "d.tenant_id = ?";
    if (status) {
      where += " AND d.status = ?";
      params.push(status);
    }
    return this.query<DefectiveItemEntity>(
      `SELECT ${COLUMNS.split(", ")
        .map((c) => `d.${c}`)
        .join(", ")},
              p.name AS product_name, pu.imei AS serial,
              wc.action AS claim_action, wc.sale_item_id AS sale_item_id
         FROM defective_items d
         LEFT JOIN products p ON p.id = d.product_id AND p.tenant_id = ?
         LEFT JOIN product_units pu ON pu.id = d.unit_id AND pu.tenant_id = ?
         LEFT JOIN warranty_claims wc ON wc.id = d.warranty_claim_id AND wc.tenant_id = ?
        WHERE ${where}
        ORDER BY d.created_at DESC, d.id DESC`,
      ...params,
    );
  }

  /** Move to a resolved status (HELD → …), stamping `resolved_at`. */
  setStatus(
    id: number,
    status: DefectiveItemStatus,
    restockBatchId: number | null,
  ): void {
    this.execute(
      `UPDATE defective_items
          SET status = ?, restock_batch_id = ?,
              resolved_at = CASE WHEN ? = 'HELD' THEN NULL ELSE CURRENT_TIMESTAMP END,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND tenant_id = ?`,
      status,
      restockBatchId,
      status,
      id,
      getCurrentTenantId(),
    );
  }

  /** A voided claim's defective row disappears (it never happened). */
  delete(id: number): boolean {
    return (
      this.execute(
        `DELETE FROM defective_items WHERE id = ? AND tenant_id = ?`,
        id,
        getCurrentTenantId(),
      ).changes > 0
    );
  }
}

let instance: DefectiveItemRepository | null = null;
export function getDefectiveItemRepository(): DefectiveItemRepository {
  if (!instance) instance = new DefectiveItemRepository();
  return instance;
}
export function resetDefectiveItemRepository(): void {
  instance = null;
}
