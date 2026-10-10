/**
 * LIRA-296 P2 — warranty claims (table `warranty_claims`, v206). SQL only,
 * tenant-scoped (rule 13). One claim covers exactly one unit of a sale line
 * (or one repair job); the orchestration lives in `WarrantyService`.
 */
import { BaseRepository, type BaseEntity } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";

export type WarrantyClaimAction = "REPAIR" | "REPLACE" | "REFUND";
export type WarrantyClaimStatus = "OPEN" | "DONE" | "VOIDED";

export interface WarrantyClaimEntity extends BaseEntity {
  tenant_id: number;
  sale_item_id: number | null;
  maintenance_id: number | null;
  unit_id: number | null;
  quantity: number;
  action: WarrantyClaimAction;
  status: WarrantyClaimStatus;
  override_reason: string | null;
  notes: string | null;
  user_id: number;
  repair_job_id: number | null;
  replacement_unit_id: number | null;
  refund_transaction_id: number | null;
  voided_at: string | null;
  created_at: string;
  updated_at: string;
  /** Joined for display (claim history): the staff member's username. */
  username?: string | null;
}

export interface NewWarrantyClaimRow {
  saleItemId: number | null;
  maintenanceId: number | null;
  unitId: number | null;
  action: WarrantyClaimAction;
  status: WarrantyClaimStatus;
  overrideReason: string | null;
  notes: string | null;
  userId: number;
}

const COLUMNS =
  "id, tenant_id, sale_item_id, maintenance_id, unit_id, quantity, action, status, override_reason, notes, user_id, repair_job_id, replacement_unit_id, refund_transaction_id, voided_at, created_at, updated_at";

export class WarrantyClaimRepository extends BaseRepository<WarrantyClaimEntity> {
  constructor() {
    super("warranty_claims");
  }

  protected getColumns(): string {
    return COLUMNS;
  }

  /** Run `fn` in ONE database transaction (a claim writes several tables). */
  withTransaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  insertClaim(data: NewWarrantyClaimRow): number {
    const result = this.execute(
      `INSERT INTO warranty_claims (
         tenant_id, sale_item_id, maintenance_id, unit_id, quantity, action, status,
         override_reason, notes, user_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      getCurrentTenantId(),
      data.saleItemId,
      data.maintenanceId,
      data.unitId,
      data.action,
      data.status,
      data.overrideReason,
      data.notes,
      data.userId,
    );
    return Number(result.lastInsertRowid);
  }

  /** Claim history, newest first, with the staff member's username. */
  listFor(filter: {
    saleItemId?: number;
    maintenanceId?: number;
    unitId?: number;
  }): WarrantyClaimEntity[] {
    const tenantId = getCurrentTenantId();
    const where: string[] = ["wc.tenant_id = ?"];
    const params: unknown[] = [tenantId, tenantId];
    if (filter.saleItemId != null) {
      where.push("wc.sale_item_id = ?");
      params.push(filter.saleItemId);
    }
    if (filter.maintenanceId != null) {
      where.push("wc.maintenance_id = ?");
      params.push(filter.maintenanceId);
    }
    if (filter.unitId != null) {
      where.push("(wc.unit_id = ? OR wc.replacement_unit_id = ?)");
      params.push(filter.unitId, filter.unitId);
    }
    return this.query<WarrantyClaimEntity>(
      `SELECT ${COLUMNS.split(", ")
        .map((c) => `wc.${c}`)
        .join(", ")}, u.username AS username
         FROM warranty_claims wc
         LEFT JOIN users u ON u.id = wc.user_id AND u.tenant_id = ?
        WHERE ${where.join(" AND ")}
        ORDER BY wc.created_at DESC, wc.id DESC`,
      ...params,
    );
  }

  /** The unit's OPEN claim, if any (invariant: at most one). */
  findOpenForUnit(unitId: number): WarrantyClaimEntity | null {
    return this.queryOne<WarrantyClaimEntity>(
      `SELECT ${COLUMNS} FROM warranty_claims
        WHERE unit_id = ? AND status = 'OPEN' AND tenant_id = ?
        ORDER BY id LIMIT 1`,
      unitId,
      getCurrentTenantId(),
    );
  }

  /** The repair job's OPEN claim (a job opened by a claim). */
  findByRepairJob(jobId: number): WarrantyClaimEntity | null {
    return this.queryOne<WarrantyClaimEntity>(
      `SELECT ${COLUMNS} FROM warranty_claims
        WHERE repair_job_id = ? AND tenant_id = ?
        ORDER BY id DESC LIMIT 1`,
      jobId,
      getCurrentTenantId(),
    );
  }

  /** Live (OPEN or DONE) claims on a line that did NOT refund it — a REFUND
   *  claim already lowered the line's covered quantity itself. */
  countLiveNonRefundForLine(saleItemId: number): number {
    return (
      this.queryOne<{ n: number }>(
        `SELECT COUNT(*) AS n FROM warranty_claims
          WHERE sale_item_id = ? AND status IN ('OPEN', 'DONE')
            AND action <> 'REFUND' AND tenant_id = ?`,
        saleItemId,
        getCurrentTenantId(),
      )?.n ?? 0
    );
  }

  /** Live claims on a repair job (warranty on a repair). */
  countLiveForJob(maintenanceId: number): number {
    return (
      this.queryOne<{ n: number }>(
        `SELECT COUNT(*) AS n FROM warranty_claims
          WHERE maintenance_id = ? AND status IN ('OPEN', 'DONE') AND tenant_id = ?`,
        maintenanceId,
        getCurrentTenantId(),
      )?.n ?? 0
    );
  }

  /** The OPEN claim id per line (for the search's `openClaimId`). */
  openClaimIdsForLines(saleItemIds: number[]): Map<number, number> {
    const out = new Map<number, number>();
    if (saleItemIds.length === 0) return out;
    const rows = this.query<{ sale_item_id: number; id: number }>(
      `SELECT sale_item_id, MAX(id) AS id FROM warranty_claims
        WHERE status = 'OPEN' AND tenant_id = ?
          AND sale_item_id IN (${saleItemIds.map(() => "?").join(", ")})
        GROUP BY sale_item_id`,
      getCurrentTenantId(),
      ...saleItemIds,
    );
    for (const r of rows) out.set(r.sale_item_id, r.id);
    return out;
  }

  setLinks(
    id: number,
    links: {
      repairJobId?: number | null;
      replacementUnitId?: number | null;
      refundTransactionId?: number | null;
    },
  ): void {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (links.repairJobId !== undefined) {
      sets.push("repair_job_id = ?");
      params.push(links.repairJobId);
    }
    if (links.replacementUnitId !== undefined) {
      sets.push("replacement_unit_id = ?");
      params.push(links.replacementUnitId);
    }
    if (links.refundTransactionId !== undefined) {
      sets.push("refund_transaction_id = ?");
      params.push(links.refundTransactionId);
    }
    if (sets.length === 0) return;
    this.execute(
      `UPDATE warranty_claims SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND tenant_id = ?`,
      ...params,
      id,
      getCurrentTenantId(),
    );
  }

  setStatus(id: number, status: WarrantyClaimStatus): void {
    this.execute(
      `UPDATE warranty_claims SET status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND tenant_id = ?`,
      status,
      id,
      getCurrentTenantId(),
    );
  }

  markVoided(id: number): void {
    this.execute(
      `UPDATE warranty_claims SET status = 'VOIDED', voided_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND tenant_id = ?`,
      id,
      getCurrentTenantId(),
    );
  }

  /** Point a reversal row at the row it negates. */
  setReverses(id: number, reversesId: number): void {
    this.execute(
      `UPDATE transactions SET reverses_id = ? WHERE id = ? AND tenant_id = ?`,
      reversesId,
      id,
      getCurrentTenantId(),
    );
  }

  /** The WARRANTY_COST rows a claim wrote (and their reversals). */
  costRowsForClaim(claimId: number): {
    id: number;
    profit_usd: number;
    profit_lbp: number;
    reverses_id: number | null;
    client_id: number | null;
  }[] {
    return this.query(
      `SELECT id, profit_usd, profit_lbp, reverses_id, client_id FROM transactions
        WHERE source_table = 'warranty_claims' AND source_id = ?
          AND type = 'WARRANTY_COST' AND tenant_id = ?
        ORDER BY id`,
      claimId,
      getCurrentTenantId(),
    );
  }
}

let instance: WarrantyClaimRepository | null = null;
export function getWarrantyClaimRepository(): WarrantyClaimRepository {
  if (!instance) instance = new WarrantyClaimRepository();
  return instance;
}
export function resetWarrantyClaimRepository(): void {
  instance = null;
}
