/**
 * LIRA-296 — warranty lookup for ANY item, not just IMEI phones.
 *
 * One read: `search(filters)` over `sale_items` that carry a warranty
 * (`warranty_until IS NOT NULL`), joined to the sale, the customer (the
 * `clients` row, or for a walk-in the SALE transaction's `client_name` /
 * `client_phone` — the same source as `SalesRepository.getSaleWithCustomer`),
 * and the product. `unitsForLines(ids)` returns each line's tracked units
 * (serial/IMEI). Both are tenant-scoped on every joined table.
 *
 * This layer returns raw facts only — quantities, the stamped date, units.
 * The warranty STATE is computed once, in the service, by the shared
 * `warrantyState` helper with the client's own day (rules 14 and 27).
 */
import { BaseRepository, type BaseEntity } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { parseReceiptNumber } from "../utils/receiptNumber.js";
import { escapeLike, LIKE_ESCAPE_CLAUSE } from "../utils/sqlLike.js";
import { localDayExpr } from "./reportingTimeFragments.js";

/** One sale line carrying a warranty, as stored. */
export interface WarrantyLineRow {
  sale_item_id: number;
  sale_id: number;
  /** `sales.created_at` (stored UTC timestamp). */
  sold_at: string;
  client_id: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  product_id: number;
  product_name: string | null;
  barcode: string | null;
  quantity: number;
  refunded_quantity: number;
  is_refunded: number;
  warranty_until: string | null;
  warranty_months: number | null;
}

/** A tracked unit sold on a warranty line. */
export interface WarrantyUnitRow {
  id: number;
  sale_item_id: number;
  imei: string | null;
  status: "IN_STOCK" | "SOLD";
  warranty_override_until: string | null;
}

/** A repair carrying its own warranty (LIRA-296 P2, user story 5). */
export interface WarrantyRepairRow {
  maintenance_id: number;
  sold_at: string;
  client_id: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  device_name: string;
  is_refunded: number;
  warranty_until: string;
  warranty_months: number | null;
}

export interface WarrantyLineFilters {
  /** Name, phone, receipt number, product name/barcode or serial/IMEI. */
  q?: string | undefined;
  /** Sale day range, inclusive, in the shop's own days. */
  from?: string | undefined;
  to?: string | undefined;
  limit: number;
}

export class WarrantyRepository extends BaseRepository<BaseEntity> {
  constructor() {
    super("sale_items");
  }

  protected getColumns(): string {
    return "id";
  }

  /** Warranty lines matching the filters, newest sale first. */
  search(filters: WarrantyLineFilters): WarrantyLineRow[] {
    const tenantId = getCurrentTenantId();
    const where: string[] = [
      "si.tenant_id = ?",
      "si.warranty_until IS NOT NULL",
    ];
    const params: unknown[] = [tenantId];

    const q = filters.q?.trim();
    if (q) {
      const like = `%${escapeLike(q)}%`;
      const digits = q.replace(/\s+/g, "");
      const phoneLike = `%${escapeLike(digits)}%`;
      const textMatch = [
        `COALESCE(c.full_name, tw.client_name) LIKE ? ${LIKE_ESCAPE_CLAUSE}`,
        `REPLACE(COALESCE(c.phone_number, tw.client_phone), ' ', '') LIKE ? ${LIKE_ESCAPE_CLAUSE}`,
        `p.name LIKE ? ${LIKE_ESCAPE_CLAUSE}`,
        `p.barcode LIKE ? ${LIKE_ESCAPE_CLAUSE}`,
        `si.imei LIKE ? ${LIKE_ESCAPE_CLAUSE}`,
        `EXISTS (SELECT 1 FROM product_units pu
                  WHERE pu.sale_item_id = si.id AND pu.tenant_id = ?
                    AND pu.imei LIKE ? ${LIKE_ESCAPE_CLAUSE})`,
      ];
      const textParams: unknown[] = [
        like,
        phoneLike,
        like,
        like,
        like,
        tenantId,
        like,
      ];
      const receiptId = parseReceiptNumber(q);
      if (receiptId !== null) {
        textMatch.unshift("s.id = ?");
        textParams.unshift(receiptId);
      }
      where.push(`(${textMatch.join(" OR ")})`);
      params.push(...textParams);
    }
    if (filters.from) {
      where.push(`${localDayExpr("s.created_at")} >= ?`);
      params.push(filters.from);
    }
    if (filters.to) {
      where.push(`${localDayExpr("s.created_at")} <= ?`);
      params.push(filters.to);
    }

    return this.query<WarrantyLineRow>(
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
              si.warranty_months AS warranty_months
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id AND s.tenant_id = ?
         LEFT JOIN clients c ON c.id = s.client_id AND c.tenant_id = ?
         LEFT JOIN transactions tw ON tw.id = (
                SELECT t.id FROM transactions t
                 WHERE t.source_table = 'sales' AND t.source_id = s.id
                   AND t.type = 'SALE' AND t.tenant_id = ?
                 ORDER BY t.id LIMIT 1)
         LEFT JOIN products p ON p.id = si.product_id AND p.tenant_id = ?
        WHERE ${where.join(" AND ")}
        ORDER BY s.created_at DESC, si.id DESC
        LIMIT ?`,
      tenantId,
      tenantId,
      tenantId,
      tenantId,
      ...params,
      filters.limit,
    );
  }

  /**
   * LIRA-296 P2 — repairs that carry their own warranty (stamped at
   * Delivered_Paid), matched by customer name, phone (spaces ignored) or the
   * device; dated by the job's charge (its MAINTENANCE transaction).
   * Tenant-scoped on every table. Empty on a schema predating v206.
   */
  searchRepairs(filters: WarrantyLineFilters): WarrantyRepairRow[] {
    const cols = this.db.prepare(`PRAGMA table_info(maintenance)`).all() as {
      name: string;
    }[];
    if (!cols.some((c) => c.name === "warranty_until")) return [];
    const tenantId = getCurrentTenantId();
    const soldAt = `COALESCE((SELECT MIN(t.created_at) FROM transactions t
                     WHERE t.source_table = 'maintenance' AND t.source_id = m.id
                       AND t.type = 'MAINTENANCE' AND t.tenant_id = ?), m.created_at)`;
    const where: string[] = [
      "m.tenant_id = ?",
      "m.warranty_until IS NOT NULL",
      "m.status NOT IN ('Voided', 'Deleted')",
    ];
    const params: unknown[] = [tenantId];
    const q = filters.q?.trim();
    if (q) {
      const like = `%${escapeLike(q)}%`;
      const phoneLike = `%${escapeLike(q.replace(/\s+/g, ""))}%`;
      where.push(`(COALESCE(c.full_name, m.client_name) LIKE ? ${LIKE_ESCAPE_CLAUSE}
                OR REPLACE(COALESCE(NULLIF(m.client_phone, ''), c.phone_number), ' ', '') LIKE ? ${LIKE_ESCAPE_CLAUSE}
                OR m.device_name LIKE ? ${LIKE_ESCAPE_CLAUSE})`);
      params.push(like, phoneLike, like);
    }
    if (filters.from) {
      where.push(`${localDayExpr(soldAt)} >= ?`);
      params.push(tenantId, filters.from);
    }
    if (filters.to) {
      where.push(`${localDayExpr(soldAt)} <= ?`);
      params.push(tenantId, filters.to);
    }
    return this.query<WarrantyRepairRow>(
      `SELECT m.id AS maintenance_id,
              ${soldAt} AS sold_at,
              m.client_id AS client_id,
              COALESCE(c.full_name, m.client_name) AS customer_name,
              COALESCE(NULLIF(m.client_phone, ''), c.phone_number) AS customer_phone,
              m.device_name AS device_name,
              COALESCE(m.is_refunded, 0) AS is_refunded,
              m.warranty_until AS warranty_until,
              m.warranty_months AS warranty_months
         FROM maintenance m
         LEFT JOIN clients c ON c.id = m.client_id AND c.tenant_id = ?
        WHERE ${where.join(" AND ")}
        ORDER BY sold_at DESC, m.id DESC
        LIMIT ?`,
      tenantId,
      tenantId,
      ...params,
      filters.limit,
    );
  }

  /** Tracked units (serial/IMEI) sold on the given lines. */
  unitsForLines(saleItemIds: number[]): WarrantyUnitRow[] {
    if (saleItemIds.length === 0) return [];
    const placeholders = saleItemIds.map(() => "?").join(", ");
    return this.query<WarrantyUnitRow>(
      `SELECT id, sale_item_id, imei, status, warranty_override_until
         FROM product_units
        WHERE tenant_id = ? AND sale_item_id IN (${placeholders})
        ORDER BY sale_item_id, id`,
      getCurrentTenantId(),
      ...saleItemIds,
    );
  }
}

/** One sale line with what a claim needs (cost, customer, product). */
export interface WarrantyClaimLineRow extends WarrantyLineRow {
  cost_price_snapshot_usd: number | null;
  sale_status: string;
}

/** A product's stock facts for a REPLACE claim. */
export interface WarrantyProductRow {
  id: number;
  name: string;
  stock_quantity: number;
  cost_price_usd: number;
  in_stock_units: number;
}

export interface WarrantyUnitEntity {
  id: number;
  product_id: number;
  imei: string | null;
  status: "IN_STOCK" | "SOLD";
  sale_item_id: number | null;
  is_defective: number;
  warranty_override_until: string | null;
  warranty_claim_id: number | null;
}

/**
 * LIRA-296 P2 — the claim side of warranty data (line, product, unit and
 * stock writes a claim makes). SQL only; `WarrantyService` orchestrates.
 */
export class WarrantyClaimSideRepository extends BaseRepository<BaseEntity> {
  constructor() {
    super("sale_items");
  }

  protected getColumns(): string {
    return "id";
  }

  lineForClaim(saleItemId: number): WarrantyClaimLineRow | null {
    const tenantId = getCurrentTenantId();
    return this.queryOne<WarrantyClaimLineRow>(
      `SELECT si.id AS sale_item_id, si.sale_id AS sale_id, s.created_at AS sold_at,
              s.client_id AS client_id,
              COALESCE(c.full_name, tw.client_name) AS customer_name,
              COALESCE(c.phone_number, tw.client_phone) AS customer_phone,
              si.product_id AS product_id, p.name AS product_name, p.barcode AS barcode,
              si.quantity AS quantity,
              COALESCE(si.refunded_quantity, 0) AS refunded_quantity,
              COALESCE(si.is_refunded, 0) AS is_refunded,
              si.warranty_until AS warranty_until, si.warranty_months AS warranty_months,
              si.cost_price_snapshot_usd AS cost_price_snapshot_usd,
              s.status AS sale_status
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id AND s.tenant_id = ?
         LEFT JOIN clients c ON c.id = s.client_id AND c.tenant_id = ?
         LEFT JOIN transactions tw ON tw.id = (
                SELECT t.id FROM transactions t
                 WHERE t.source_table = 'sales' AND t.source_id = s.id
                   AND t.type = 'SALE' AND t.tenant_id = ?
                 ORDER BY t.id LIMIT 1)
         LEFT JOIN products p ON p.id = si.product_id AND p.tenant_id = ?
        WHERE si.id = ? AND si.tenant_id = ?`,
      tenantId,
      tenantId,
      tenantId,
      tenantId,
      saleItemId,
      tenantId,
    );
  }

  product(productId: number): WarrantyProductRow | null {
    const tenantId = getCurrentTenantId();
    return this.queryOne<WarrantyProductRow>(
      `SELECT p.id, p.name, p.stock_quantity, p.cost_price_usd,
              (SELECT COUNT(*) FROM product_units pu
                WHERE pu.product_id = p.id AND pu.status = 'IN_STOCK' AND pu.tenant_id = ?) AS in_stock_units
         FROM products p WHERE p.id = ? AND p.tenant_id = ?`,
      tenantId,
      productId,
      tenantId,
    );
  }

  unit(unitId: number): WarrantyUnitEntity | null {
    return this.queryOne<WarrantyUnitEntity>(
      `SELECT id, product_id, imei, status, sale_item_id, is_defective,
              warranty_override_until, warranty_claim_id
         FROM product_units WHERE id = ? AND tenant_id = ?`,
      unitId,
      getCurrentTenantId(),
    );
  }

  /** Take one unit off the shelf; false (nothing written) when none left. */
  takeOneFromStock(productId: number): boolean {
    return (
      this.execute(
        `UPDATE products SET stock_quantity = stock_quantity - 1
          WHERE id = ? AND tenant_id = ? AND stock_quantity >= 1`,
        productId,
        getCurrentTenantId(),
      ).changes > 0
    );
  }

  /** Put units back on (or take off) the shelf. */
  adjustStock(productId: number, delta: number): void {
    this.execute(
      `UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ? AND tenant_id = ?`,
      delta,
      productId,
      getCurrentTenantId(),
    );
  }

  /** A replacement unit handed over under a claim: SOLD, linked to the
   *  claim, covered until the ORIGINAL end date (owner decision D2). */
  markReplacementSold(
    unitId: number,
    claimId: number,
    overrideUntil: string | null,
  ): boolean {
    return (
      this.execute(
        `UPDATE product_units
            SET status = 'SOLD', warranty_claim_id = ?, warranty_override_until = ?,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND tenant_id = ? AND status = 'IN_STOCK'`,
        claimId,
        overrideUntil,
        unitId,
        getCurrentTenantId(),
      ).changes > 0
    );
  }

  /** Undo {@link markReplacementSold} (claim voided). */
  releaseReplacement(unitId: number): void {
    this.execute(
      `UPDATE product_units
          SET status = 'IN_STOCK', warranty_claim_id = NULL, warranty_override_until = NULL,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND tenant_id = ?`,
      unitId,
      getCurrentTenantId(),
    );
  }

  setUnitDefective(unitId: number, defective: boolean): void {
    this.execute(
      `UPDATE product_units SET is_defective = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND tenant_id = ?`,
      defective ? 1 : 0,
      unitId,
      getCurrentTenantId(),
    );
  }

  /** Reverse {@link returnUnitToStock} when a claim void undoes a supplier
   *  replacement: the unit is the faulty one again (SOLD, defective). False
   *  (nothing written) when it is no longer on the shelf — sold again. */
  unitBackToDefective(unitId: number): boolean {
    return (
      this.execute(
        `UPDATE product_units SET status = 'SOLD', is_defective = 1,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND tenant_id = ? AND status = 'IN_STOCK'`,
        unitId,
        getCurrentTenantId(),
      ).changes > 0
    );
  }

  /** The supplier of the earliest FIFO batch a sale line consumed — the
   *  default for a supplier return. Null when no consumed batch names one. */
  supplierForSaleItem(saleItemId: number): number | null {
    const tenantId = getCurrentTenantId();
    const row = this.queryOne<{ supplier_id: number }>(
      `SELECT b.supplier_id FROM stock_batch_consumptions c
         JOIN product_stock_batches b ON b.id = c.batch_id AND b.tenant_id = ?
        WHERE c.sale_item_id = ? AND c.tenant_id = ? AND b.supplier_id IS NOT NULL
        ORDER BY c.id LIMIT 1`,
      tenantId,
      saleItemId,
      tenantId,
    );
    return row?.supplier_id ?? null;
  }

  /** True when the supplier exists in this shop. */
  supplierExists(supplierId: number): boolean {
    return !!this.queryOne<{ id: number }>(
      `SELECT id FROM suppliers WHERE id = ? AND tenant_id = ?`,
      supplierId,
      getCurrentTenantId(),
    );
  }

  /** A "not faulty" unit back on the shelf. */
  returnUnitToStock(unitId: number): void {
    this.execute(
      `UPDATE product_units SET status = 'IN_STOCK', is_defective = 0,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND tenant_id = ?`,
      unitId,
      getCurrentTenantId(),
    );
  }

  /** Units handed over as replacements under the given claims. */
  replacementUnitsForClaims(claimIds: number[]): WarrantyUnitEntity[] {
    if (claimIds.length === 0) return [];
    return this.query<WarrantyUnitEntity>(
      `SELECT id, product_id, imei, status, sale_item_id, is_defective,
              warranty_override_until, warranty_claim_id
         FROM product_units
        WHERE tenant_id = ? AND warranty_claim_id IN (${claimIds.map(() => "?").join(", ")})`,
      getCurrentTenantId(),
      ...claimIds,
    );
  }
}

let claimSideInstance: WarrantyClaimSideRepository | null = null;
export function getWarrantyClaimSideRepository(): WarrantyClaimSideRepository {
  if (!claimSideInstance) claimSideInstance = new WarrantyClaimSideRepository();
  return claimSideInstance;
}

let instance: WarrantyRepository | null = null;

export function getWarrantyRepository(): WarrantyRepository {
  if (!instance) instance = new WarrantyRepository();
  return instance;
}

/** Reset the singleton (for testing). */
export function resetWarrantyRepository(): void {
  instance = null;
  claimSideInstance = null;
}
