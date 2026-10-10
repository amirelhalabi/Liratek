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

let instance: WarrantyRepository | null = null;

export function getWarrantyRepository(): WarrantyRepository {
  if (!instance) instance = new WarrantyRepository();
  return instance;
}

/** Reset the singleton (for testing). */
export function resetWarrantyRepository(): void {
  instance = null;
}
