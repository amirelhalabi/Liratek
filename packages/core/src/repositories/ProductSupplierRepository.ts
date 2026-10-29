import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { DatabaseError, ValidationError } from "../utils/errors.js";
import { ledgerNotRefunded } from "./SupplierRepository.js";

export interface ProductSupplier {
  id: number;
  name: string;
  sort_order: number;
  is_active: number;
  supplier_id: number | null;
  created_at: string;
}

export interface ProductSupplierWithCount extends ProductSupplier {
  product_count: number;
}

export interface ProductSupplierItem {
  product_id: number;
  name: string;
  quantity: number;
  cost: number;
  total: number;
  created_at: string;
}

/** LIRA-361 — what deleting (or merging away) one supplier would touch. */
export interface ProductSupplierImpact {
  /** Active products whose supplier is this name. */
  product_count: number;
  /** supplier_ledger rows of the linked supplier, voided ones included. */
  ledger_entry_count: number;
  balance_usd: number;
  balance_lbp: number;
}

export interface ProductSupplierMergeResult {
  moved_products: number;
  moved_ledger_entries: number;
}

/**
 * LIRA-361 — every table that points at a `suppliers` row by id, and the
 * column it uses. A merge re-points all of them from the source supplier to
 * the target. A table added later that references `suppliers(id)` must be
 * listed here: `supplier_ledger` and `supplier_purchases` are
 * `ON DELETE CASCADE`, so a missed table of that kind would lose its rows
 * silently on the final DELETE instead of failing. The guard test
 * `ProductSupplierRepository.mergeReferences.guard.test.ts` reads
 * create_db.sql and fails on any supplier reference missing from this list.
 */
export const SUPPLIER_REFERENCES: ReadonlyArray<{
  table: string;
  column: string;
}> = [
  { table: "supplier_ledger", column: "supplier_id" },
  { table: "supplier_settlements", column: "supplier_id" },
  { table: "supplier_settlement_coverage", column: "member_supplier_id" },
  { table: "supplier_purchases", column: "supplier_id" },
  { table: "product_stock_batches", column: "supplier_id" },
  { table: "supplier_returns", column: "supplier_id" },
  { table: "products", column: "supplier_id" },
  { table: "product_suppliers", column: "supplier_id" },
  { table: "suppliers", column: "account_supplier_id" },
];

const COLUMNS = "id, name, sort_order, is_active, supplier_id, created_at";

export class ProductSupplierRepository {
  /** Explicit override for tests only; default resolves live (§ 11.2). */
  private readonly _db?: Database.Database;

  constructor(db?: Database.Database) {
    this._db = db;
  }

  private get db(): Database.Database {
    return this._db ?? getDatabase();
  }

  getAll(): ProductSupplier[] {
    return this.db
      .prepare(
        `SELECT ${COLUMNS} FROM product_suppliers WHERE is_active = 1 AND tenant_id = ? ORDER BY sort_order ASC, name ASC`,
      )
      .all(getCurrentTenantId()) as ProductSupplier[];
  }

  /** Get all suppliers with a count of products referencing each one. */
  getAllWithProductCount(): ProductSupplierWithCount[] {
    const tenantId = getCurrentTenantId();
    return this.db
      .prepare(
        `SELECT ps.id, ps.name, ps.sort_order, ps.is_active, ps.supplier_id, ps.created_at,
                COUNT(p.id) AS product_count
         FROM product_suppliers ps
         LEFT JOIN products p ON LOWER(p.supplier) = LOWER(ps.name) AND p.is_active = 1 AND p.tenant_id = ps.tenant_id
         WHERE ps.is_active = 1 AND ps.tenant_id = ?
         GROUP BY ps.id
         ORDER BY ps.sort_order ASC, ps.name ASC`,
      )
      .all(tenantId) as ProductSupplierWithCount[];
  }

  /**
   * Returns inventory items from this supplier for the detail panel.
   * Joined via product_suppliers name (case-insensitive) to products.
   */
  getProductItems(supplierId: number): ProductSupplierItem[] {
    const tenantId = getCurrentTenantId();
    return this.db
      .prepare(
        `SELECT p.id as product_id, p.name, p.stock_quantity as quantity,
                p.cost_price_usd as cost,
                ROUND(p.stock_quantity * p.cost_price_usd, 2) as total,
                p.created_at
         FROM product_suppliers ps
         JOIN products p ON LOWER(p.supplier) = LOWER(ps.name) AND p.is_active = 1 AND p.tenant_id = ps.tenant_id
         WHERE ps.supplier_id = ? AND ps.tenant_id = ?
         ORDER BY p.name ASC`,
      )
      .all(supplierId, tenantId) as ProductSupplierItem[];
  }

  /** Find a product_suppliers row by linked supplier_id. */
  findByLinkedSupplierId(supplierId: number): ProductSupplier | undefined {
    return this.db
      .prepare(
        `SELECT ${COLUMNS} FROM product_suppliers WHERE supplier_id = ? AND tenant_id = ? LIMIT 1`,
      )
      .get(supplierId, getCurrentTenantId()) as ProductSupplier | undefined;
  }

  create(name: string): { id: number; supplier_id: number } {
    const trimmed = name.trim();
    if (!trimmed) throw new DatabaseError("Supplier name is required");
    const tenantId = getCurrentTenantId();

    return this.db.transaction(() => {
      const supplierId = this._findOrCreateLinkedSupplier(trimmed);
      const result = this.db
        .prepare(
          `INSERT INTO product_suppliers (name, sort_order, supplier_id, tenant_id)
           VALUES (?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM product_suppliers WHERE tenant_id = ?), ?, ?)`,
        )
        .run(trimmed, tenantId, supplierId, tenantId);
      return { id: Number(result.lastInsertRowid), supplier_id: supplierId };
    })();
  }

  update(id: number, name: string): boolean {
    const trimmed = name.trim();
    if (!trimmed) throw new DatabaseError("Supplier name is required");
    const tenantId = getCurrentTenantId();

    return this.db.transaction(() => {
      const existing = this.db
        .prepare(
          `SELECT supplier_id FROM product_suppliers WHERE id = ? AND tenant_id = ?`,
        )
        .get(id, tenantId) as { supplier_id: number | null } | undefined;

      // Keep or create linked supplier row with updated name
      if (existing?.supplier_id) {
        this.db
          .prepare(
            `UPDATE suppliers SET name = ? WHERE id = ? AND tenant_id = ?`,
          )
          .run(trimmed, existing.supplier_id, tenantId);
      }

      const result = this.db
        .prepare(
          `UPDATE product_suppliers SET name = ? WHERE id = ? AND tenant_id = ?`,
        )
        .run(trimmed, id, tenantId);
      return result.changes > 0;
    })();
  }

  /** LIRA-361 — products and debt history a delete would orphan. */
  getDeleteImpact(id: number): ProductSupplierImpact {
    const tenantId = getCurrentTenantId();
    const row = this._getRow(id);
    const products = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM products WHERE LOWER(supplier) = LOWER(?) AND is_active = 1 AND tenant_id = ?`,
      )
      .get(row.name, tenantId) as { n: number };
    const ledger = row.supplier_id
      ? (this.db
          .prepare(
            `SELECT COUNT(*) AS n,
                    COALESCE(SUM(CASE WHEN ${ledgerNotRefunded()} THEN amount_usd ELSE 0 END), 0) AS usd,
                    COALESCE(SUM(CASE WHEN ${ledgerNotRefunded()} THEN amount_lbp ELSE 0 END), 0) AS lbp
               FROM supplier_ledger WHERE supplier_id = ? AND tenant_id = ?`,
          )
          .get(row.supplier_id, tenantId) as {
          n: number;
          usd: number;
          lbp: number;
        })
      : { n: 0, usd: 0, lbp: 0 };
    return {
      product_count: products.n,
      ledger_entry_count: ledger.n,
      balance_usd: ledger.usd,
      balance_lbp: ledger.lbp,
    };
  }

  /**
   * LIRA-361 — fold a duplicate supplier (`sourceId`) into the real one
   * (`targetId`), in ONE transaction. Everything moves: product labels,
   * stock batches, every supplier_ledger row (debt, payments, credits),
   * settlements, purchases and returns — so the target's balance becomes
   * the sum of both, per currency. Old-stock products booked no debt, so
   * for them only the label moves; no branching on is_old_stock is needed.
   * Voids still work after a merge: they find the ledger row by id and read
   * its (now re-pointed) supplier_id.
   *
   * Transaction summaries ("Stock received: … — reacall") are a snapshot of
   * the name at saving time and are NOT rewritten (rule 31).
   */
  merge(sourceId: number, targetId: number): ProductSupplierMergeResult {
    if (sourceId === targetId) {
      throw new ValidationError("Cannot merge a supplier into itself");
    }
    const tenantId = getCurrentTenantId();

    return this.db.transaction(() => {
      const source = this._getRow(sourceId);
      const target = this._getRow(targetId);
      const targetSupplierId =
        target.supplier_id ?? this._findOrCreateLinkedSupplier(target.name);
      if (target.supplier_id === null) {
        this.db
          .prepare(
            `UPDATE product_suppliers SET supplier_id = ? WHERE id = ? AND tenant_id = ?`,
          )
          .run(targetSupplierId, target.id, tenantId);
      }

      const movedProducts = this.db
        .prepare(
          `UPDATE products SET supplier = ? WHERE LOWER(supplier) = LOWER(?) AND tenant_id = ?`,
        )
        .run(target.name, source.name, tenantId).changes;

      let movedLedger = 0;
      const sourceSupplierId = source.supplier_id;
      if (sourceSupplierId !== null && sourceSupplierId !== targetSupplierId) {
        const flags = this.db
          .prepare(
            `SELECT is_system FROM suppliers WHERE id IN (?, ?) AND tenant_id = ?`,
          )
          .all(sourceSupplierId, targetSupplierId, tenantId) as {
          is_system: number;
        }[];
        if (flags.some((f) => f.is_system === 1)) {
          throw new ValidationError("System suppliers cannot be merged");
        }

        for (const ref of SUPPLIER_REFERENCES) {
          const changes = this.db
            .prepare(
              `UPDATE ${ref.table} SET ${ref.column} = ? WHERE ${ref.column} = ? AND tenant_id = ?`,
            )
            .run(targetSupplierId, sourceSupplierId, tenantId).changes;
          if (ref.table === "supplier_ledger") movedLedger = changes;
        }
        // Keep contact details the target is missing.
        this.db
          .prepare(
            `UPDATE suppliers SET
               contact_name = COALESCE(contact_name, (SELECT contact_name FROM suppliers WHERE id = ? AND tenant_id = ?)),
               phone = COALESCE(phone, (SELECT phone FROM suppliers WHERE id = ? AND tenant_id = ?)),
               note = COALESCE(note, (SELECT note FROM suppliers WHERE id = ? AND tenant_id = ?))
             WHERE id = ? AND tenant_id = ?`,
          )
          .run(
            sourceSupplierId,
            tenantId,
            sourceSupplierId,
            tenantId,
            sourceSupplierId,
            tenantId,
            targetSupplierId,
            tenantId,
          );
        this.db
          .prepare(`DELETE FROM suppliers WHERE id = ? AND tenant_id = ?`)
          .run(sourceSupplierId, tenantId);
      }

      this.db
        .prepare(`DELETE FROM product_suppliers WHERE id = ? AND tenant_id = ?`)
        .run(source.id, tenantId);

      return {
        moved_products: movedProducts,
        moved_ledger_entries: movedLedger,
      };
    })();
  }

  /**
   * Plain delete — only for a supplier with no active products and no
   * ledger history (LIRA-361). Anything else must be merged into another
   * supplier, or its debt would be left behind unlinked.
   */
  delete(id: number): boolean {
    const tenantId = getCurrentTenantId();
    const row = this.db
      .prepare(
        `SELECT name FROM product_suppliers WHERE id = ? AND tenant_id = ?`,
      )
      .get(id, tenantId) as { name: string } | undefined;

    if (row) {
      const impact = this.getDeleteImpact(id);
      if (impact.product_count > 0 || impact.ledger_entry_count > 0) {
        throw new ValidationError(
          "This supplier has products or debt history — merge it into another supplier instead of deleting it",
        );
      }
      this.db
        .prepare(
          `UPDATE products SET supplier = NULL WHERE LOWER(supplier) = LOWER(?) AND tenant_id = ?`,
        )
        .run(row.name, tenantId);
    }

    const result = this.db
      .prepare(`DELETE FROM product_suppliers WHERE id = ? AND tenant_id = ?`)
      .run(id, tenantId);
    return result.changes > 0;
  }

  /** Find supplier by name (case-insensitive), or create it if missing. Returns id. */
  getOrCreate(name: string): number {
    const trimmed = name.trim();
    if (!trimmed) throw new DatabaseError("Supplier name is required");
    const tenantId = getCurrentTenantId();

    return this.db.transaction(() => {
      const existing = this.db
        .prepare(
          `SELECT id, supplier_id FROM product_suppliers WHERE name = ? COLLATE NOCASE AND tenant_id = ?`,
        )
        .get(trimmed, tenantId) as
        | { id: number; supplier_id: number | null }
        | undefined;
      if (existing) {
        if (existing.supplier_id !== null) {
          this._unarchiveSupplier(existing.supplier_id);
        }
        return existing.id;
      }

      const supplierId = this._findOrCreateLinkedSupplier(trimmed);
      const result = this.db
        .prepare(
          `INSERT INTO product_suppliers (name, sort_order, supplier_id, tenant_id)
           VALUES (?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM product_suppliers WHERE tenant_id = ?), ?, ?)`,
        )
        .run(trimmed, tenantId, supplierId, tenantId);
      return Number(result.lastInsertRowid);
    })();
  }

  getNames(): string[] {
    const rows = this.db
      .prepare(
        `SELECT name FROM product_suppliers WHERE is_active = 1 AND tenant_id = ? ORDER BY sort_order ASC, name ASC`,
      )
      .all(getCurrentTenantId()) as { name: string }[];
    return rows.map((r) => r.name);
  }

  private _getRow(id: number): {
    id: number;
    name: string;
    supplier_id: number | null;
  } {
    const row = this.db
      .prepare(
        `SELECT id, name, supplier_id FROM product_suppliers WHERE id = ? AND tenant_id = ?`,
      )
      .get(id, getCurrentTenantId()) as
      | { id: number; name: string; supplier_id: number | null }
      | undefined;
    if (!row) throw new ValidationError(`Supplier #${id} not found`);
    return row;
  }

  /**
   * LIRA-362 — typing an archived supplier's name again brings that same
   * supplier back to the Suppliers page, so new stock or debt never lands on
   * a hidden row and no duplicate is created.
   */
  private _unarchiveSupplier(supplierId: number): void {
    this.db
      .prepare(
        `UPDATE suppliers SET is_active = 1 WHERE id = ? AND tenant_id = ? AND is_system = 0 AND is_active = 0`,
      )
      .run(supplierId, getCurrentTenantId());
  }

  /** Find or create a suppliers row (is_system=0) for the given product supplier name. */
  private _findOrCreateLinkedSupplier(name: string): number {
    const tenantId = getCurrentTenantId();
    const existing = this.db
      .prepare(
        `SELECT id FROM suppliers WHERE name = ? COLLATE NOCASE AND is_system = 0 AND tenant_id = ? LIMIT 1`,
      )
      .get(name, tenantId) as { id: number } | undefined;
    if (existing) {
      this._unarchiveSupplier(existing.id);
      return existing.id;
    }

    const result = this.db
      .prepare(
        `INSERT INTO suppliers (name, is_active, is_system, created_at, tenant_id)
         VALUES (?, 1, 0, CURRENT_TIMESTAMP, ?)`,
      )
      .run(name, tenantId);
    return Number(result.lastInsertRowid);
  }
}

let instance: ProductSupplierRepository | null = null;
export function getProductSupplierRepository(): ProductSupplierRepository {
  if (!instance) instance = new ProductSupplierRepository();
  return instance;
}

export function resetProductSupplierRepository(): void {
  instance = null;
}
