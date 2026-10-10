/**
 * LIRA-296 P3 (US8) — the warranty report's reads. SQL only, tenant-scoped
 * on every joined table (rules 13 and 14):
 *
 *   - `coveredSaleLines(today)` / `coveredRepairs(today)` — every line or
 *     repair whose warranty may still run on the shop's `today`. Uncapped:
 *     the report's totals must not silently stop at a search limit. The
 *     final COVERED decision is the service's, through the one shared
 *     `warrantyState` helper.
 *   - `claimCounts` — live claims made in the period, by action.
 *   - `costSplit` — the period's WARRANTY_COST rows with the SAME source,
 *     status, pending-debt and date fragments as the Profits "Warranty cost"
 *     line (`ProfitRepository.getWarrantyTotals`), split into supplier
 *     recovery and the rest by the row's `kind` (a reversal takes the kind
 *     of the row it reverses).
 */
import { BaseRepository, type BaseEntity } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { dateRange } from "./reportingTimeFragments.js";
import { notDebtPending, warrantyCostSource } from "./ProfitRepository.js";
import type { WarrantyLineRow } from "./WarrantyRepository.js";

/** A covered-candidate sale line, with its category for grouping. */
export interface WarrantyReportLineRow extends WarrantyLineRow {
  category: string;
}

/** A covered-candidate repair (its own warranty). */
export interface WarrantyReportRepairRow {
  maintenance_id: number;
  client_id: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  device_name: string;
  is_refunded: number;
  warranty_until: string;
}

export interface WarrantyCostSplitRow {
  net_usd: number;
  net_lbp: number;
  recovered_usd: number;
  recovered_lbp: number;
}

/** WARRANTY_COST kinds that are money back from a supplier. */
const SUPPLIER_KINDS = "('SUPPLIER_CREDIT', 'SUPPLIER_REPLACED')";

export class WarrantyReportRepository extends BaseRepository<BaseEntity> {
  constructor() {
    super("sale_items");
  }

  protected getColumns(): string {
    return "id";
  }

  coveredSaleLines(today: string): WarrantyReportLineRow[] {
    const tenantId = getCurrentTenantId();
    return this.query<WarrantyReportLineRow>(
      `SELECT si.id AS sale_item_id,
              si.sale_id AS sale_id,
              s.created_at AS sold_at,
              s.client_id AS client_id,
              COALESCE(c.full_name, tw.client_name) AS customer_name,
              COALESCE(c.phone_number, tw.client_phone) AS customer_phone,
              si.product_id AS product_id,
              p.name AS product_name,
              p.barcode AS barcode,
              si.quantity AS quantity,
              COALESCE(si.refunded_quantity, 0) AS refunded_quantity,
              COALESCE(si.is_refunded, 0) AS is_refunded,
              si.warranty_until AS warranty_until,
              si.warranty_months AS warranty_months,
              COALESCE(pc.name, NULLIF(TRIM(p.category), ''), 'Uncategorized') AS category
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id AND s.tenant_id = ?
         LEFT JOIN clients c ON c.id = s.client_id AND c.tenant_id = ?
         LEFT JOIN transactions tw ON tw.id = (
                SELECT t.id FROM transactions t
                 WHERE t.source_table = 'sales' AND t.source_id = s.id
                   AND t.type = 'SALE' AND t.tenant_id = ?
                 ORDER BY t.id LIMIT 1)
         LEFT JOIN products p ON p.id = si.product_id AND p.tenant_id = ?
         LEFT JOIN product_categories pc ON pc.id = p.category_id AND pc.tenant_id = ?
        WHERE si.tenant_id = ?
          AND si.warranty_until IS NOT NULL
          AND (substr(si.warranty_until, 1, 10) >= ?
               OR EXISTS (SELECT 1 FROM product_units pu
                           WHERE pu.sale_item_id = si.id AND pu.tenant_id = ?
                             AND substr(pu.warranty_override_until, 1, 10) >= ?))
        ORDER BY category, substr(si.warranty_until, 1, 10), si.id`,
      tenantId,
      tenantId,
      tenantId,
      tenantId,
      tenantId,
      tenantId,
      today,
      tenantId,
      today,
    );
  }

  /** Repairs whose own warranty runs on `today`. Empty before v206. */
  coveredRepairs(today: string): WarrantyReportRepairRow[] {
    const cols = this.db.prepare(`PRAGMA table_info(maintenance)`).all() as {
      name: string;
    }[];
    if (!cols.some((c) => c.name === "warranty_until")) return [];
    const tenantId = getCurrentTenantId();
    return this.query<WarrantyReportRepairRow>(
      `SELECT m.id AS maintenance_id,
              m.client_id AS client_id,
              COALESCE(c.full_name, m.client_name) AS customer_name,
              COALESCE(NULLIF(m.client_phone, ''), c.phone_number) AS customer_phone,
              m.device_name AS device_name,
              COALESCE(m.is_refunded, 0) AS is_refunded,
              m.warranty_until AS warranty_until
         FROM maintenance m
         LEFT JOIN clients c ON c.id = m.client_id AND c.tenant_id = ?
        WHERE m.tenant_id = ?
          AND m.warranty_until IS NOT NULL
          AND substr(m.warranty_until, 1, 10) >= ?
          AND m.status NOT IN ('Voided', 'Deleted')
        ORDER BY substr(m.warranty_until, 1, 10), m.id`,
      tenantId,
      tenantId,
      today,
    );
  }

  /** Live (not voided) claims made in [fromDt, toDt], by action. */
  claimCounts(
    fromDt: string,
    toDt: string,
  ): { action: "REPAIR" | "REPLACE" | "REFUND"; n: number }[] {
    return this.query(
      `SELECT action, COUNT(*) AS n FROM warranty_claims
        WHERE tenant_id = ? AND status <> 'VOIDED'
          AND ${dateRange("created_at")}
        GROUP BY action`,
      getCurrentTenantId(),
      fromDt,
      toDt,
    );
  }

  /** The period's warranty money, split into supplier recovery and net. */
  costSplit(fromDt: string, toDt: string): WarrantyCostSplitRow {
    const tenantId = getCurrentTenantId();
    // A reversal row carries the kind of the row it reverses.
    const kind = `CASE WHEN json_extract(t.metadata_json, '$.kind') = 'REVERSAL'
                       THEN (SELECT json_extract(o.metadata_json, '$.kind')
                               FROM transactions o
                              WHERE o.id = t.reverses_id AND o.tenant_id = t.tenant_id)
                       ELSE json_extract(t.metadata_json, '$.kind') END`;
    const row = this.queryOne<WarrantyCostSplitRow>(
      `SELECT COALESCE(SUM(t.profit_usd), 0) AS net_usd,
              COALESCE(SUM(t.profit_lbp), 0) AS net_lbp,
              COALESCE(SUM(CASE WHEN ${kind} IN ${SUPPLIER_KINDS} THEN t.profit_usd ELSE 0 END), 0) AS recovered_usd,
              COALESCE(SUM(CASE WHEN ${kind} IN ${SUPPLIER_KINDS} THEN t.profit_lbp ELSE 0 END), 0) AS recovered_lbp
         FROM transactions t
        WHERE t.status = 'ACTIVE'
          AND ${warrantyCostSource("t")}
          AND ${notDebtPending("t.id")}
          AND ${dateRange("t.created_at")}
          AND t.tenant_id = ?`,
      fromDt,
      toDt,
      tenantId,
    );
    return (
      row ?? { net_usd: 0, net_lbp: 0, recovered_usd: 0, recovered_lbp: 0 }
    );
  }
}

let instance: WarrantyReportRepository | null = null;
export function getWarrantyReportRepository(): WarrantyReportRepository {
  if (!instance) instance = new WarrantyReportRepository();
  return instance;
}
export function resetWarrantyReportRepository(): void {
  instance = null;
}
