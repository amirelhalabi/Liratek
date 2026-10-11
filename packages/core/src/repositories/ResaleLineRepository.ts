/**
 * LIRA-309 — phone lines the shop holds FOR SALE.
 *
 * A for-sale line is an inventory product in a lines category (LIRA-207:
 * one product per number, the number stored normalised in `barcode`). This
 * repository owns its DETAILS row (`resale_lines`: carrier, credit, expiry),
 * kept apart from `carrier_lines` on purpose: carrier lines make up the
 * MTC/Alfa drawer, checkpoints, primary-line selection and buy-back
 * matching, and a for-sale line must reach none of them (spec FR-019,
 * research R1). The number is NOT copied here — it is the product's barcode
 * (rule 14).
 *
 * Every statement is scoped to the current tenant (`getCurrentTenantId()`).
 */
import { BaseRepository } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { requestNow } from "../utils/requestNow.js";
import { isPhoneLineCategoryName } from "../utils/phoneNumber.js";

export type ResaleLineCarrier = "mtc" | "alfa";

export interface ResaleLineEntity {
  id: number;
  tenant_id: number;
  product_id: number;
  carrier: ResaleLineCarrier;
  credits: number;
  validity_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * One row of the For sale list: the product (number, name, cost, price,
 * stock) LEFT JOINed with its details. A line product with no details row yet
 * (created before LIRA-309) comes back with `resale_line_id`/`carrier` null —
 * it shows as "No expiry set" until the owner saves its details.
 */
export interface ResaleLineRow {
  product_id: number;
  /** `products.barcode` — the line's number, normalised by LIRA-207. */
  phone_number: string | null;
  name: string;
  category: string | null;
  cost_price_usd: number;
  selling_price_usd: number;
  stock_quantity: number;
  /** 1 when the line is still in stock (see {@link UNSOLD_LINE_SQL}). */
  is_unsold: number;
  resale_line_id: number | null;
  carrier: ResaleLineCarrier | null;
  credits: number;
  validity_expires_at: string | null;
}

export interface ListResaleLinesOptions {
  carrier?: ResaleLineCarrier;
  includeSold?: boolean;
}

export interface UpsertResaleLineData {
  carrier: ResaleLineCarrier;
  credits?: number;
  validityExpiresAt?: string | null;
}

/**
 * "This line is still in stock" — defined ONCE (rule 14) and reused by the
 * list, by number detection, and (US4) by the customer-recharge guard. Reads
 * the `p.` alias of `products`.
 */
export const UNSOLD_LINE_SQL =
  "(p.is_deleted = 0 AND p.is_active = 1 AND p.stock_quantity > 0)";

export class ResaleLineRepository extends BaseRepository<ResaleLineEntity> {
  constructor() {
    super("resale_lines", { softDelete: false });
  }

  protected getColumns(): string {
    return [
      "id",
      "tenant_id",
      "product_id",
      "carrier",
      "credits",
      "validity_expires_at",
      "created_at",
      "updated_at",
    ].join(", ");
  }

  /** Run `fn` in ONE database transaction. */
  withTransaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /**
   * Every line product of the tenant with its details. The SQL narrows to
   * categories containing "line" (cheap pre-filter); the exact rule is the
   * shared {@link isPhoneLineCategoryName} predicate (whole word, so
   * "Online Cards" is not a lines category), applied here once.
   */
  listLines(options: ListResaleLinesOptions = {}): ResaleLineRow[] {
    const tenantId = getCurrentTenantId();
    // Bind order follows the SQL text: JOIN tenant, WHERE tenant, carrier.
    const params: unknown[] = [tenantId, tenantId];
    let where = `p.tenant_id = ? AND p.is_deleted = 0 AND p.category LIKE '%line%'`;
    if (!options.includeSold) where += ` AND ${UNSOLD_LINE_SQL}`;
    if (options.carrier) {
      where += ` AND rl.carrier = ?`;
      params.push(options.carrier);
    }
    const rows = this.db
      .prepare(
        `SELECT p.id AS product_id,
                p.barcode AS phone_number,
                p.name,
                p.category,
                COALESCE(p.cost_price_usd, 0) AS cost_price_usd,
                COALESCE(p.selling_price_usd, 0) AS selling_price_usd,
                COALESCE(p.stock_quantity, 0) AS stock_quantity,
                CASE WHEN ${UNSOLD_LINE_SQL} THEN 1 ELSE 0 END AS is_unsold,
                rl.id AS resale_line_id,
                rl.carrier,
                COALESCE(rl.credits, 0) AS credits,
                rl.validity_expires_at
           FROM products p
           LEFT JOIN resale_lines rl
             ON rl.product_id = p.id AND rl.tenant_id = ?
          WHERE ${where}
          ORDER BY p.name`,
      )
      .all(...params) as ResaleLineRow[];
    return rows.filter((r) => isPhoneLineCategoryName(r.category));
  }

  getByProductId(productId: number): ResaleLineEntity | null {
    const tenantId = getCurrentTenantId();
    return (
      (this.db
        .prepare(
          `SELECT ${this.getColumns()} FROM resale_lines
            WHERE tenant_id = ? AND product_id = ?`,
        )
        .get(tenantId, productId) as ResaleLineEntity | undefined) ?? null
    );
  }

  /** The product row a details save is validated against. */
  getLineProduct(
    productId: number,
  ): { id: number; barcode: string | null; category: string | null } | null {
    const tenantId = getCurrentTenantId();
    return (
      (this.db
        .prepare(
          `SELECT id, barcode, category FROM products
            WHERE tenant_id = ? AND id = ? AND is_deleted = 0`,
        )
        .get(tenantId, productId) as
        | { id: number; barcode: string | null; category: string | null }
        | undefined) ?? null
    );
  }

  /** Create the details row, or update it in place. Fields left undefined
   *  keep their stored value on update. */
  upsertDetails(
    productId: number,
    data: UpsertResaleLineData,
  ): ResaleLineEntity {
    const tenantId = getCurrentTenantId();
    const now = requestNow();
    const existing = this.getByProductId(productId);
    if (existing) {
      this.db
        .prepare(
          `UPDATE resale_lines
              SET carrier = ?, credits = ?, validity_expires_at = ?, updated_at = ?
            WHERE tenant_id = ? AND id = ?`,
        )
        .run(
          data.carrier,
          data.credits ?? existing.credits,
          data.validityExpiresAt === undefined
            ? existing.validity_expires_at
            : data.validityExpiresAt,
          now,
          tenantId,
          existing.id,
        );
    } else {
      this.db
        .prepare(
          `INSERT INTO resale_lines
             (tenant_id, product_id, carrier, credits, validity_expires_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          tenantId,
          productId,
          data.carrier,
          data.credits ?? 0,
          data.validityExpiresAt ?? null,
          now,
          now,
        );
    }
    return this.getByProductId(productId)!;
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let resaleLineRepositoryInstance: ResaleLineRepository | null = null;

export function getResaleLineRepository(): ResaleLineRepository {
  if (!resaleLineRepositoryInstance) {
    resaleLineRepositoryInstance = new ResaleLineRepository();
  }
  return resaleLineRepositoryInstance;
}

export function resetResaleLineRepository(): void {
  resaleLineRepositoryInstance = null;
}
