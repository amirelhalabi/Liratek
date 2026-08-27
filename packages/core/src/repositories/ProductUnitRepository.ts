/**
 * Product Unit Repository — per-IMEI phone unit tracking
 * (LIRA-143 Phase 2, current_sprint.md, owner-interviewed 2026-08-23).
 *
 * Phase 1 (migration v157) created the `product_units` table with no
 * reader/writer wired up yet (schema-only). This repository is the first
 * thing that reads/writes it. Nothing in `SalesRepository`,
 * `TransactionRepository`, or `ProductRepository` calls into this class yet
 * — the sale/refund/void wiring is a later phase; this repository stands on
 * its own, callable directly by tests and by `ProductUnitService`.
 *
 * One row per physical IMEI-tracked unit of a product MODEL (decision #1:
 * ONE product row per model at stock N, not one product row per phone).
 * `status` is `IN_STOCK` or `SOLD`; the partial unique index
 * `idx_product_units_active_imei` (`tenant_id, imei` WHERE `status =
 * 'IN_STOCK'`) blocks a duplicate IMEI only while it is actively in stock
 * (decision #3) — a SOLD unit's IMEI may be re-registered on a different
 * product row, and a refund flips the SAME row back to `IN_STOCK` rather
 * than inserting a new one, so that path can never collide with itself.
 *
 * Every method is scoped to the current tenant (`getCurrentTenantId()`).
 */

import { BaseRepository } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { inventoryLogger } from "../utils/logger.js";
import { escapeLike, LIKE_ESCAPE_CLAUSE } from "../utils/sqlLike.js";

// =============================================================================
// Entity Types
// =============================================================================

export type ProductUnitStatus = "IN_STOCK" | "SOLD";

export interface ProductUnitEntity {
  id: number;
  tenant_id: number | null;
  product_id: number;
  imei: string;
  status: ProductUnitStatus;
  sale_item_id: number | null;
  is_defective: number; // SQLite boolean
  warranty_override_until: string | null; // ISO date
  created_at: string;
  updated_at: string;
}

/** Per-product IN_STOCK/SOLD/defective rollup — see {@link
 *  ProductUnitRepository.getSummaryForProducts} for why a unit-less product
 *  gets no key at all rather than a zeroed entry. */
export interface ProductUnitSummary {
  in_stock: number;
  sold: number;
  defective: number;
}

/**
 * One `product_units` row joined with its provenance for the walk-in
 * lookup read (decision #7): the owning product's name, and — when the unit
 * has ever been sold (`sale_item_id` set, even if it's since been flipped
 * back to `IN_STOCK` by a refund) — the sale line's warranty stamp/refund
 * state, the sale's timestamp/client, and the client's name. All the joined
 * fields are `null` for a unit that has never been sold.
 *
 * `product_warranty_months` is the owning MODEL's warranty term — same
 * display-only role (and the same non-retroactive caveat) as on
 * {@link UnitListRow}; both reads take it off the ONE shared
 * {@link ProductUnitRepository.UNIT_PROVENANCE_JOIN} so the two surfaces can
 * never disagree.
 */
export interface UnitStory {
  id: number;
  tenant_id: number | null;
  product_id: number;
  imei: string;
  status: ProductUnitStatus;
  sale_item_id: number | null;
  is_defective: number;
  warranty_override_until: string | null;
  created_at: string;
  updated_at: string;
  product_name: string | null;
  product_warranty_months: number | null;
  warranty_until: string | null;
  is_refunded: number | null;
  refunded_quantity: number | null;
  quantity: number | null;
  sold_price_usd: number | null;
  sale_id: number | null;
  sold_at: string | null;
  client_id: number | null;
  client_name: string | null;
}

/**
 * Filters for the Phone Units management view (`listUnits`). `limit`/
 * `offset` are REQUIRED here — the Zod schema
 * (`validators/productUnit.ts#listProductUnitsSchema`) supplies the
 * 50/0 defaults at the transport door, so by the time a filter set reaches
 * the repository the page window is always explicit.
 */
export interface UnitListFilters {
  status?: ProductUnitStatus;
  /** `true` narrows to `is_defective = 1`; `false`/absent means "no defect
   *  filter" (NOT "only healthy units"). */
  defectiveOnly?: boolean;
  /** LIKE-matches the unit's IMEI OR its product's name. Matched as a
   *  LITERAL substring: `%`, `_` and `\` in the term are escaped
   *  (`utils/sqlLike.ts`), so they are characters, not wildcards. */
  search?: string;
  limit: number;
  offset: number;
}

/**
 * One row of the Phone Units management view: the unit's own columns plus
 * the sale provenance it was last sold on (`sold_at`, `sold_price_usd`,
 * `client_name`, `warranty_until`) and the derived {@link
 * ProductUnitRepository.SALE_REFUNDED_EXPR} flag. Every sale-side field is
 * `null` for a unit that has never been sold; `sale_refunded` is `null` in
 * that case too (distinct from `0` = sold and NOT refunded).
 *
 * `product_name` is typed non-null because `product_units.product_id` is a
 * NOT NULL FK to a same-tenant product row — the join is a LEFT JOIN only
 * to keep it byte-identical to `getUnitStoryByImei`'s shape (both build
 * from the same {@link ProductUnitRepository.UNIT_PROVENANCE_JOIN}).
 *
 * `product_warranty_months` is the owning MODEL's warranty TERM
 * (`products.warranty_months`), NOT this unit's coverage: decision #4 starts
 * the warranty clock at the sale, so an unsold unit has no `warranty_until`
 * to show and its computed `warranty` is `NONE`. Carrying the term lets the
 * UI say "6 mo — starts at sale" for fresh stock instead of the misleading
 * "No warranty" (owner-reported 2026-08-26). It is display information only
 * — it is deliberately NOT fed to `computeWarrantyStatus`, whose precedence
 * is owner-locked, and it never retro-stamps a unit sold before the model
 * had a term.
 */
export interface UnitListRow {
  id: number;
  product_id: number;
  imei: string;
  status: ProductUnitStatus;
  is_defective: number;
  warranty_override_until: string | null;
  created_at: string;
  product_name: string;
  product_warranty_months: number | null;
  sale_item_id: number | null;
  sold_at: string | null;
  sold_price_usd: number | null;
  client_name: string | null;
  warranty_until: string | null;
  sale_refunded: 0 | 1 | null;
}

/** One page of {@link UnitListRow}s plus the unpaged total over the
 *  IDENTICAL filter set (see `listUnits`). */
export interface UnitListPage {
  rows: UnitListRow[];
  total: number;
}

export interface MarkInStockOptions {
  /** Overwrites `is_defective` only when provided (`undefined` leaves the
   *  existing flag untouched). */
  isDefective?: boolean;
  /** Overwrites `warranty_override_until` only when provided — pass `null`
   *  explicitly to clear it, or omit the key entirely to leave it alone. */
  warrantyOverrideUntil?: string | null;
}

// =============================================================================
// Repository
// =============================================================================

export class ProductUnitRepository extends BaseRepository<ProductUnitEntity> {
  constructor() {
    super("product_units", { softDelete: false });
  }

  protected getColumns(): string {
    return [
      "id",
      "tenant_id",
      "product_id",
      "imei",
      "status",
      "sale_item_id",
      "is_defective",
      "warranty_override_until",
      "created_at",
      "updated_at",
    ].join(", ");
  }

  // ---------------------------------------------------------------------------
  // Shared SQL fragments (rule 14 — defined ONCE, reused)
  // ---------------------------------------------------------------------------

  /**
   * Rule-14 single definition of the unit-provenance join: a unit, its
   * product model, and — when it has ever been sold — the sale line, the
   * sale, and the sale's client. Shared by `getUnitStoryByImei` (the
   * walk-in lookup, decision #7) and `listUnits` (the Phone Units
   * management view) plus that view's `COUNT(*)` twin, so all three see
   * exactly the same row set.
   *
   * Every LEFT JOIN is tenant-guarded (`AND ….tenant_id = pu.tenant_id`) so
   * a corrupted cross-tenant FK can never leak another tenant's product,
   * sale, or client name through the join. Each join is on a PRIMARY KEY
   * (`id`), so it can match at most one row — no query built on this
   * fragment can multiply `product_units` rows, which is what makes the
   * `COUNT(*)` twin's total exact.
   *
   * Aliases (`pu`, `p`, `si`, `s`, `c`) are part of the contract: any query
   * interpolating this fragment must reference those names, and must supply
   * `pu.tenant_id = ?` itself (the fragment introduces NO `?` of its own).
   */
  private static readonly UNIT_PROVENANCE_JOIN = `FROM product_units pu
         LEFT JOIN products p ON p.id = pu.product_id AND p.tenant_id = pu.tenant_id
         LEFT JOIN sale_items si ON si.id = pu.sale_item_id AND si.tenant_id = pu.tenant_id
         LEFT JOIN sales s ON s.id = si.sale_id AND s.tenant_id = pu.tenant_id
         LEFT JOIN clients c ON c.id = s.client_id AND c.tenant_id = pu.tenant_id`;

  /**
   * Rule-14 single definition of "this unit's sale was refunded", the SQL
   * twin of `ProductUnitService`'s `isSaleRefunded` predicate: the sale
   * line's own `is_refunded` flag OR a fully-refunded quantity
   * (`refunded_quantity >= quantity`, quantity may be 1). `NULL` — not `0`
   * — when the unit has never been sold, so the caller can tell "no sale to
   * refund" apart from "sold and not refunded". Requires the
   * {@link UNIT_PROVENANCE_JOIN} aliases (`pu`, `si`).
   */
  private static readonly SALE_REFUNDED_EXPR = `CASE
             WHEN pu.sale_item_id IS NULL THEN NULL
             WHEN COALESCE(si.is_refunded, 0) <> 0 THEN 1
             WHEN si.quantity > 0 AND COALESCE(si.refunded_quantity, 0) >= si.quantity THEN 1
             ELSE 0
           END`;

  /**
   * Translate a {@link UnitListFilters} set into the ONE `WHERE` clause
   * that both of `listUnits`' queries use — the page read and its
   * `COUNT(*)` twin — so the total can never disagree with the rows
   * (rule 14: the filter predicate is written once, never pasted into the
   * second query). Always emits `pu.tenant_id = ?` first, so the returned
   * params are already correctly ordered for the caller.
   *
   * `defectiveOnly: false` is treated as absent (no defect predicate),
   * NOT as "only healthy units" — the UI's checkbox is a narrowing filter,
   * so unchecking it must widen back to everything. `search` is trimmed and
   * an empty result is dropped, so `search: "   "` never degenerates into a
   * `LIKE '%%'` that matches every row by accident — and its `%`/`_`/`\` are
   * escaped (`utils/sqlLike.ts`) so a NON-empty term can't degenerate the
   * same way either (LIRA-143 item 5: `search: "%"` used to return the whole
   * table).
   */
  private static buildUnitListWhere(
    tenantId: number,
    filters: UnitListFilters,
  ): { sql: string; params: unknown[] } {
    const clauses = ["pu.tenant_id = ?"];
    const params: unknown[] = [tenantId];

    if (filters.status) {
      clauses.push("pu.status = ?");
      params.push(filters.status);
    }
    if (filters.defectiveOnly) {
      clauses.push("pu.is_defective = 1");
    }
    const search = filters.search?.trim();
    if (search) {
      // LIRA-143 item 5 — the term's own `%`/`_`/`\` are escaped and the
      // matching `ESCAPE '\'` clause is attached (`utils/sqlLike.ts` owns the
      // pair; using either half alone is a bug). Without it, a search for
      // `%` returned the entire table and `81_9` matched `8139…`. Scope is
      // deliberately this ONE search — see `sqlLike.ts`'s scope note for why
      // ProductRepository's product name/barcode search keeps its
      // long-standing raw-LIKE behaviour.
      clauses.push(
        `(pu.imei LIKE ? ${LIKE_ESCAPE_CLAUSE} OR p.name LIKE ? ${LIKE_ESCAPE_CLAUSE})`,
      );
      const term = `%${escapeLike(search)}%`;
      params.push(term, term);
    }

    return { sql: `WHERE ${clauses.join(" AND ")}`, params };
  }

  // ---------------------------------------------------------------------------
  // Intake
  // ---------------------------------------------------------------------------

  /**
   * Register one or more IMEI units against a product model at intake.
   * Every IMEI is trimmed; an empty string (after trim) or a duplicate
   * within the SAME batch is rejected before anything is written. The
   * whole batch runs inside one `db.transaction` so a mid-batch failure
   * (a duplicate IMEI three rows in) inserts nothing — no partial intake.
   *
   * Before each INSERT, checks whether that IMEI already has an active
   * (`IN_STOCK`) unit anywhere for this tenant and throws a named error
   * that identifies the product currently holding it (owner decision #3),
   * e.g. `IMEI 356938035643809 is already registered in stock on product
   * "iPhone 13"`. The partial unique index (`idx_product_units_active_imei`)
   * remains the race backstop: if a concurrent insert slips in between the
   * pre-check and this INSERT, the INSERT throws `SQLITE_CONSTRAINT_UNIQUE`,
   * which is caught and converted to the identical named-error shape by
   * re-querying for the row that won the race.
   */
  addUnits(productId: number, imeis: string[]): ProductUnitEntity[] {
    const tenantId = getCurrentTenantId();

    const trimmed = imeis.map((raw) => raw.trim());
    const emptyIndex = trimmed.findIndex((imei) => imei.length === 0);
    if (emptyIndex !== -1) {
      throw new Error("addUnits: IMEI values must not be empty");
    }
    const seen = new Set<string>();
    for (const imei of trimmed) {
      if (seen.has(imei)) {
        throw new Error(
          `addUnits: duplicate IMEI ${imei} within the same intake batch`,
        );
      }
      seen.add(imei);
    }

    return this.transaction(() => {
      const insertStmt = this.db.prepare(
        `INSERT INTO product_units (
           tenant_id, product_id, imei, status, created_at, updated_at
         ) VALUES (?, ?, ?, 'IN_STOCK', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      );

      const insertedIds: number[] = [];
      for (const imei of trimmed) {
        this.assertImeiNotActive(tenantId, imei);
        try {
          const result = insertStmt.run(tenantId, productId, imei);
          insertedIds.push(Number(result.lastInsertRowid));
        } catch (error) {
          const code = (error as { code?: string })?.code;
          if (
            code === "SQLITE_CONSTRAINT_UNIQUE" ||
            code === "SQLITE_CONSTRAINT"
          ) {
            // Race backstop: a concurrent request won the insert between
            // our pre-check and this statement. Re-query to name the real
            // holder rather than surfacing the raw SQLite error.
            this.assertImeiNotActive(tenantId, imei);
          }
          throw error;
        }
      }

      inventoryLogger.info(
        { productId, count: insertedIds.length },
        "Product units registered",
      );
      return insertedIds.map((id) => this.findByIdOrFail(id));
    });
  }

  /** Throws the decision-#3 named error if `imei` already has an `IN_STOCK`
   *  unit for this tenant, naming the product that currently holds it. */
  private assertImeiNotActive(tenantId: number, imei: string): void {
    const holder = this.db
      .prepare(
        `SELECT p.name AS product_name
         FROM product_units pu
         JOIN products p ON p.id = pu.product_id
         WHERE pu.tenant_id = ? AND pu.imei = ? AND pu.status = 'IN_STOCK'
         LIMIT 1`,
      )
      .get(tenantId, imei) as { product_name: string } | undefined;
    if (holder) {
      throw new Error(
        `IMEI ${imei} is already registered in stock on product "${holder.product_name}"`,
      );
    }
  }

  /**
   * Adversarial-review finding 2 fix: throws a named error if ANOTHER unit
   * (`id != excludeUnitId`) currently holds `imei` `IN_STOCK` for this
   * tenant. Decision #3 allows a SOLD unit's imei to be re-registered
   * `IN_STOCK` on a different product — when that happened, flipping the
   * ORIGINAL unit back to `IN_STOCK` (a refund) collides with the partial
   * unique index (`idx_product_units_active_imei`) and, unguarded, used to
   * surface a raw `UNIQUE constraint failed` straight to the operator. This
   * names both the colliding product and unit id so the message is
   * actionable — the refund is still blocked either way (fail-closed,
   * unchanged); only the error's quality changes.
   */
  private assertImeiNotActiveElsewhere(
    tenantId: number,
    imei: string,
    excludeUnitId: number,
  ): void {
    const holder = this.db
      .prepare(
        `SELECT pu.id AS unit_id, p.name AS product_name
         FROM product_units pu
         JOIN products p ON p.id = pu.product_id
         WHERE pu.tenant_id = ? AND pu.imei = ? AND pu.status = 'IN_STOCK' AND pu.id != ?
         LIMIT 1`,
      )
      .get(tenantId, imei, excludeUnitId) as
      | { unit_id: number; product_name: string }
      | undefined;
    if (holder) {
      throw new Error(
        `Cannot return IMEI ${imei} to stock: it is currently registered in stock on product "${holder.product_name}" (unit #${holder.unit_id}). Delete or correct that unit in its product form, then retry the refund.`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /** All units for a product, optionally filtered by status, oldest first. */
  getUnitsForProduct(
    productId: number,
    status?: ProductUnitStatus,
  ): ProductUnitEntity[] {
    const tenantId = getCurrentTenantId();
    const params: unknown[] = [tenantId, productId];
    let query = `SELECT ${this.getColumns()} FROM product_units WHERE tenant_id = ? AND product_id = ?`;
    if (status) {
      query += ` AND status = ?`;
      params.push(status);
    }
    query += ` ORDER BY created_at ASC, id ASC`;
    return this.db.prepare(query).all(...params) as ProductUnitEntity[];
  }

  /**
   * Batched per-product IN_STOCK/SOLD/defective rollup — ONE query, grouped
   * by `product_id, status`, merged in JS. `productIds.length === 0`
   * short-circuits to `{}` with no query (same contract as
   * `ExchangeLotRepository.getSummaryForSources`/`getSummaryForSettlers`).
   *
   * A product with NO units produces NO key at all — the caller gets
   * `undefined` for that id, never a zeroed `{in_stock: 0, sold: 0,
   * defective: 0}` entry that would be indistinguishable from "has units,
   * all counts happen to be 0". `GROUP BY` naturally already does this (a
   * product with zero rows contributes zero groups), so nothing needs to be
   * filtered out — the trap would only appear if this were rewritten as a
   * `LEFT JOIN products` with `COALESCE(..., 0)`, which is exactly the shape
   * to avoid. `is_defective` is summed with a plain `SUM(is_defective)` per
   * `(product_id, status)` group — never a `CASE` inside the aggregate — and
   * the two per-status defective counts are added together in JS to get the
   * product's total, since `is_defective` is unit history retained across
   * both `IN_STOCK` and `SOLD` rows (decision #10).
   */
  getSummaryForProducts(
    productIds: number[],
  ): Record<number, ProductUnitSummary> {
    if (productIds.length === 0) return {};
    const tenantId = getCurrentTenantId();
    const placeholders = productIds.map(() => "?").join(", ");

    const rows = this.db
      .prepare(
        `SELECT
           product_id,
           status,
           COUNT(*) AS count,
           SUM(is_defective) AS defective_count
         FROM product_units
         WHERE tenant_id = ? AND product_id IN (${placeholders})
         GROUP BY product_id, status`,
      )
      .all(tenantId, ...productIds) as {
      product_id: number;
      status: ProductUnitStatus;
      count: number;
      defective_count: number;
    }[];

    const out: Record<number, ProductUnitSummary> = {};
    for (const row of rows) {
      const entry = out[row.product_id] ?? {
        in_stock: 0,
        sold: 0,
        defective: 0,
      };
      if (row.status === "IN_STOCK") {
        entry.in_stock = row.count;
      } else {
        entry.sold = row.count;
      }
      entry.defective += row.defective_count;
      out[row.product_id] = entry;
    }
    return out;
  }

  /** Exact-match IMEI lookup, `IN_STOCK` only — the scanner-resolve read
   *  (decision #2). Returns `null` when the IMEI has no active unit
   *  (never registered, or currently `SOLD`). */
  findActiveByImei(imei: string): ProductUnitEntity | null {
    const tenantId = getCurrentTenantId();
    const row = this.db
      .prepare(
        `SELECT ${this.getColumns()} FROM product_units
         WHERE tenant_id = ? AND imei = ? AND status = 'IN_STOCK'`,
      )
      .get(tenantId, imei) as ProductUnitEntity | undefined;
    return row ?? null;
  }

  /** Batched `sale_item_id IN (...)` read — feeds the refund flip and
   *  sale-detail rendering. `saleItemIds.length === 0` short-circuits to
   *  `[]`. */
  findBySaleItemIds(saleItemIds: number[]): ProductUnitEntity[] {
    if (saleItemIds.length === 0) return [];
    const tenantId = getCurrentTenantId();
    const placeholders = saleItemIds.map(() => "?").join(", ");
    return this.db
      .prepare(
        `SELECT ${this.getColumns()} FROM product_units
         WHERE tenant_id = ? AND sale_item_id IN (${placeholders})`,
      )
      .all(tenantId, ...saleItemIds) as ProductUnitEntity[];
  }

  /**
   * The walk-in lookup read (decision #7): every `product_units` row
   * matching `imei` exactly, regardless of status, newest unit first
   * (`id DESC` — same second-granularity reasoning as `transactions.
   * created_at`, rule 15: two units created in the same second would sort
   * arbitrarily on `created_at` alone). The joins come from the shared
   * {@link ProductUnitRepository.UNIT_PROVENANCE_JOIN} fragment (rule 14) —
   * every one of them tenant-guarded, so a corrupted cross-tenant FK can
   * never leak another tenant's product/sale/client name.
   */
  getUnitStoryByImei(imei: string): UnitStory[] {
    const tenantId = getCurrentTenantId();
    return this.db
      .prepare(
        `SELECT
           pu.id, pu.tenant_id, pu.product_id, pu.imei, pu.status,
           pu.sale_item_id, pu.is_defective, pu.warranty_override_until,
           pu.created_at, pu.updated_at,
           p.name AS product_name,
           p.warranty_months AS product_warranty_months,
           si.warranty_until AS warranty_until,
           si.is_refunded AS is_refunded,
           si.refunded_quantity AS refunded_quantity,
           si.quantity AS quantity,
           si.sold_price_usd AS sold_price_usd,
           si.sale_id AS sale_id,
           s.created_at AS sold_at,
           s.client_id AS client_id,
           c.full_name AS client_name
         ${ProductUnitRepository.UNIT_PROVENANCE_JOIN}
         WHERE pu.tenant_id = ? AND pu.imei = ?
         ORDER BY pu.id DESC`,
      )
      .all(tenantId, imei) as UnitStory[];
  }

  /**
   * The Phone Units management view read: one filtered, paginated page of
   * units across ALL products, newest unit first (`pu.id DESC` — same
   * second-granularity reasoning as `getUnitStoryByImei`, rule 15), plus
   * the unpaged `total` for the pager.
   *
   * `total` is a `COUNT(*)` over the IDENTICAL join + `WHERE` (both built
   * from {@link ProductUnitRepository.UNIT_PROVENANCE_JOIN} and
   * {@link ProductUnitRepository.buildUnitListWhere}, never a second
   * hand-written predicate) — that is what makes "showing 20 of 137"
   * trustworthy. The join needs to be present in the count query too, not
   * just the page query: `search` matches `p.name`, so dropping the join
   * there would break the filter, not merely slow it down.
   *
   * Tenant-scoped through `buildUnitListWhere`'s leading
   * `pu.tenant_id = ?` plus the per-join tenant guards.
   */
  listUnits(filters: UnitListFilters): UnitListPage {
    const tenantId = getCurrentTenantId();
    const where = ProductUnitRepository.buildUnitListWhere(tenantId, filters);

    const rows = this.db
      .prepare(
        `SELECT
           pu.id, pu.product_id, pu.imei, pu.status, pu.is_defective,
           pu.warranty_override_until, pu.created_at,
           p.name AS product_name,
           p.warranty_months AS product_warranty_months,
           pu.sale_item_id,
           s.created_at AS sold_at,
           si.sold_price_usd AS sold_price_usd,
           c.full_name AS client_name,
           si.warranty_until AS warranty_until,
           ${ProductUnitRepository.SALE_REFUNDED_EXPR} AS sale_refunded
         ${ProductUnitRepository.UNIT_PROVENANCE_JOIN}
         ${where.sql}
         ORDER BY pu.id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...where.params, filters.limit, filters.offset) as UnitListRow[];

    const totalRow = this.db
      .prepare(
        `SELECT COUNT(*) AS total
         ${ProductUnitRepository.UNIT_PROVENANCE_JOIN}
         ${where.sql}`,
      )
      .get(...where.params) as { total: number };

    return { rows, total: totalRow.total };
  }

  // ---------------------------------------------------------------------------
  // Status transitions
  // ---------------------------------------------------------------------------

  /**
   * Flip a unit to `SOLD` on a fresh sale line. Clears
   * `warranty_override_until` (owner decision #12's default): a NEW sale's
   * fresh warranty stamp on the sale line wins, and any prior refund-time
   * override is cleared — that override exists for a customer who KEPT the
   * phone, not for whoever buys this unit next. `is_defective` is
   * deliberately KEPT across a re-sale — it is unit history, not a sale
   * blocker (decision #10: informational only). Throws if the unit isn't
   * currently `IN_STOCK` for this tenant (not found, already sold, or wrong
   * tenant) — the update's `WHERE status = 'IN_STOCK'` guard makes those
   * three cases indistinguishable from a single `changes === 0`, which is
   * fine: all three are equally "cannot sell this unit right now".
   */
  markSold(unitId: number, saleItemId: number): void {
    const tenantId = getCurrentTenantId();
    const result = this.db
      .prepare(
        `UPDATE product_units
         SET status = 'SOLD', sale_item_id = ?, warranty_override_until = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'IN_STOCK' AND tenant_id = ?`,
      )
      .run(saleItemId, unitId, tenantId);
    if (result.changes === 0) {
      throw new Error(
        `markSold: product unit ${unitId} not found, already sold, or wrong tenant`,
      );
    }
    inventoryLogger.info({ unitId, saleItemId }, "Product unit marked sold");
  }

  /**
   * The refund flip: move a `SOLD` unit back to `IN_STOCK`. Idempotent by
   * design — returns `false` (never throws) when the unit is not currently
   * `SOLD`, because a partial-refund-then-full-refund sequence can call
   * this twice for the same unit (the first per-item refund already flipped
   * it; the later full-refund pass must silently no-op instead of erroring).
   * `sale_item_id` is deliberately KEPT, not nulled — it is the historical
   * pointer the warranty-void lookup (decision #11(b)) needs to find the
   * sale line this unit was last sold on, even after it's back in stock.
   * `is_defective`/`warranty_override_until` are overwritten only when the
   * corresponding option key is provided (`undefined` leaves the existing
   * value untouched; an explicit `null` for `warrantyOverrideUntil` clears
   * it).
   *
   * Adversarial-review finding 2 fix: decision #3 allows a SOLD unit's imei
   * to be re-registered `IN_STOCK` on a different product row. If that
   * happened to THIS unit's imei, the flip below would collide with the
   * partial unique index (`idx_product_units_active_imei`). Pre-checks for
   * that collision (`assertImeiNotActiveElsewhere`) and throws a named,
   * actionable error instead of letting a raw `SQLITE_CONSTRAINT` escape —
   * the refund is still blocked either way; only the error's quality
   * changes. The idempotent not-SOLD no-op contract runs FIRST, before any
   * collision check, so a unit that's already back `IN_STOCK` (whose imei
   * may since have collided) keeps silently no-oping.
   */
  markInStock(unitId: number, opts?: MarkInStockOptions): boolean {
    const tenantId = getCurrentTenantId();

    const current = this.db
      .prepare(
        `SELECT status, imei FROM product_units WHERE id = ? AND tenant_id = ?`,
      )
      .get(unitId, tenantId) as
      | { status: ProductUnitStatus; imei: string }
      | undefined;

    // Idempotent contract (unchanged): not found, or not currently SOLD —
    // no-op BEFORE any collision check. A partial-refund-then-full-refund
    // sequence depends on this staying silent even when this unit's imei
    // has since collided elsewhere.
    if (!current || current.status !== "SOLD") {
      return false;
    }

    this.assertImeiNotActiveElsewhere(tenantId, current.imei, unitId);

    const setClauses = [
      "status = 'IN_STOCK'",
      "updated_at = CURRENT_TIMESTAMP",
    ];
    const params: unknown[] = [];

    if (opts?.isDefective !== undefined) {
      setClauses.push("is_defective = ?");
      params.push(opts.isDefective ? 1 : 0);
    }
    if (opts && opts.warrantyOverrideUntil !== undefined) {
      setClauses.push("warranty_override_until = ?");
      params.push(opts.warrantyOverrideUntil);
    }

    params.push(unitId, tenantId);

    let changes: number;
    try {
      const result = this.db
        .prepare(
          `UPDATE product_units SET ${setClauses.join(", ")}
           WHERE id = ? AND status = 'SOLD' AND tenant_id = ?`,
        )
        .run(...params);
      changes = result.changes;
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT") {
        // Race backstop: a concurrent registration won between the
        // pre-check above and this UPDATE. Re-query to name the real
        // holder rather than surfacing the raw SQLite error.
        this.assertImeiNotActiveElsewhere(tenantId, current.imei, unitId);
      }
      throw error;
    }

    if (changes > 0) {
      inventoryLogger.info({ unitId }, "Product unit flipped back to stock");
    }
    return changes > 0;
  }

  /**
   * Delete an intake mistake — allowed only while the unit is still
   * `IN_STOCK`. A `SOLD` unit is history and must never be deleted; the row
   * is queried first so the error can say WHY it was refused (sold) rather
   * than a generic "not found" when the id is perfectly valid.
   */
  deleteUnit(unitId: number): void {
    const tenantId = getCurrentTenantId();
    const row = this.db
      .prepare(
        `SELECT status FROM product_units WHERE id = ? AND tenant_id = ?`,
      )
      .get(unitId, tenantId) as { status: ProductUnitStatus } | undefined;

    if (!row) {
      throw new Error(`deleteUnit: product unit ${unitId} not found`);
    }
    if (row.status === "SOLD") {
      throw new Error(
        `deleteUnit: product unit ${unitId} is SOLD — a sold unit is history and cannot be deleted`,
      );
    }

    const result = this.db
      .prepare(
        `DELETE FROM product_units WHERE id = ? AND status = 'IN_STOCK' AND tenant_id = ?`,
      )
      .run(unitId, tenantId);
    if (result.changes === 0) {
      throw new Error(`deleteUnit: product unit ${unitId} not found`);
    }
    inventoryLogger.info({ unitId }, "Product unit deleted");
  }

  /**
   * Cascade for a product soft-delete (owner decision 2026-08-26,
   * "zero-burden delete"): hard-delete every `IN_STOCK` unit belonging to the
   * given products, and report exactly what went.
   *
   * ## Why the units must go with the product
   *
   * A soft-deleted product disappears from every product read
   * (`is_deleted = 0` is in `LISTABLE_PRODUCTS_WHERE` and every by-id/by-
   * barcode lookup), but its `product_units` rows are NOT soft-deletable —
   * this table has no `is_deleted` column and `super("product_units", {
   * softDelete: false })` says so. So before this cascade the IN_STOCK units
   * of a deleted product survived as invisible rows that still held their
   * IMEIs under the partial unique index
   * (`idx_product_units_active_imei`): re-registering that same IMEI on a
   * live product failed with `IMEI … is already registered in stock on
   * product "<the deleted one>"`, naming a product the operator can no
   * longer see or open to fix. Deleting the rows frees the IMEIs — the index
   * only covers `status = 'IN_STOCK'`, so the delete is exactly what lifts
   * the block.
   *
   * ## SOLD units are NEVER touched
   *
   * A SOLD unit is the provenance of a real sale: it carries the
   * `sale_item_id` that `getUnitStoryByImei` (the walk-in warranty lookup,
   * decision #7) joins through, and `deleteUnit` already refuses to delete
   * one for that reason. Deleting the model must not erase a customer's
   * warranty story, so the `status = 'IN_STOCK'` predicate here is
   * load-bearing, not an optimisation. A SOLD unit also cannot block anyone:
   * the unique index ignores it.
   *
   * ## Transaction ownership
   *
   * Deliberately opens NO transaction of its own — it is designed to be
   * called inside the caller's (`InventoryService.deleteProduct` /
   * `batchDeleteProducts` wrap this together with the product soft-delete via
   * `transaction()`), so the product row and its units can never end up
   * half-deleted.
   *
   * Returns `{ count, imeis }` so the service can log it and hand the UI an
   * honest number ("also removed 2 in-stock IMEIs") instead of a silent
   * side effect. `productIds: []` short-circuits with no query.
   */
  deleteInStockForProducts(productIds: number[]): {
    count: number;
    imeis: string[];
  } {
    if (productIds.length === 0) return { count: 0, imeis: [] };
    const tenantId = getCurrentTenantId();
    const placeholders = productIds.map(() => "?").join(", ");

    // Read the IMEIs first — after the DELETE there is nothing left to report.
    const doomed = this.db
      .prepare(
        `SELECT imei FROM product_units
         WHERE tenant_id = ? AND product_id IN (${placeholders})
           AND status = 'IN_STOCK'
         ORDER BY id ASC`,
      )
      .all(tenantId, ...productIds) as { imei: string }[];
    if (doomed.length === 0) return { count: 0, imeis: [] };

    const result = this.db
      .prepare(
        `DELETE FROM product_units
         WHERE tenant_id = ? AND product_id IN (${placeholders})
           AND status = 'IN_STOCK'`,
      )
      .run(tenantId, ...productIds);

    const imeis = doomed.map((r) => r.imei);
    inventoryLogger.info(
      { productIds, count: result.changes, imeis },
      "In-stock product units removed with their deleted product",
    );
    return { count: result.changes, imeis };
  }

  /** Single-product form of {@link deleteInStockForProducts} — same contract,
   *  same (caller-owned) transaction requirement. Rule 14: the batch method
   *  is the ONE implementation; this is a name for the common case. */
  deleteInStockForProduct(productId: number): {
    count: number;
    imeis: string[];
  } {
    return this.deleteInStockForProducts([productId]);
  }

  /** Count of `IN_STOCK` units for a product — the drift-check input for
   *  `ProductUnitService.registerUnits`. */
  countInStock(productId: number): number {
    const tenantId = getCurrentTenantId();
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM product_units
         WHERE tenant_id = ? AND product_id = ? AND status = 'IN_STOCK'`,
      )
      .get(tenantId, productId) as { count: number };
    return row.count;
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let productUnitRepositoryInstance: ProductUnitRepository | null = null;

export function getProductUnitRepository(): ProductUnitRepository {
  if (!productUnitRepositoryInstance) {
    productUnitRepositoryInstance = new ProductUnitRepository();
  }
  return productUnitRepositoryInstance;
}

export function resetProductUnitRepository(): void {
  productUnitRepositoryInstance = null;
}
