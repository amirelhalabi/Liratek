import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { allocateFifo } from "../utils/fifoCoverage.js";

export interface SupplierPurchase {
  id: number;
  supplier_id: number;
  total_usd: number;
  paid_usd: number;
  /** Derived: PAID | PARTIAL | UNPAID */
  status: "PAID" | "PARTIAL" | "UNPAID";
  note: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSupplierPurchaseData {
  supplier_id: number;
  total_usd: number;
  note?: string;
  created_by?: number;
}

const STATUS_CASE = `
  CASE
    WHEN paid_usd >= total_usd - 0.005 THEN 'PAID'
    WHEN paid_usd > 0.005              THEN 'PARTIAL'
    ELSE                                    'UNPAID'
  END AS status
`;

export class SupplierPurchaseRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  create(data: CreateSupplierPurchaseData): SupplierPurchase {
    const res = this.db
      .prepare(
        `INSERT INTO supplier_purchases (supplier_id, total_usd, note, created_by, tenant_id)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        data.supplier_id,
        data.total_usd,
        data.note ?? null,
        data.created_by ?? null,
        getCurrentTenantId(),
      );
    return this.getById(Number(res.lastInsertRowid))!;
  }

  getById(id: number): SupplierPurchase | null {
    return this.db
      .prepare(
        `SELECT *, ${STATUS_CASE} FROM supplier_purchases WHERE id = ? AND tenant_id = ?`,
      )
      .get(id, getCurrentTenantId()) as SupplierPurchase | null;
  }

  getBySupplier(supplierId: number): SupplierPurchase[] {
    return this.db
      .prepare(
        `SELECT *, ${STATUS_CASE}
         FROM supplier_purchases
         WHERE supplier_id = ? AND tenant_id = ?
         ORDER BY created_at ASC`,
      )
      .all(supplierId, getCurrentTenantId()) as SupplierPurchase[];
  }

  /**
   * Apply a USD-equivalent payment to this supplier's oldest unpaid/partial
   * purchases (FIFO). Must be called inside an existing db.transaction() so
   * the update is atomic with the payment ledger entry.
   */
  applyFifoPayment(supplierId: number, amountUsd: number): void {
    if (amountUsd <= 0) return;
    const tenantId = getCurrentTenantId();

    const unpaid = this.db
      .prepare(
        `SELECT id, total_usd, paid_usd
         FROM supplier_purchases
         WHERE supplier_id = ? AND paid_usd < total_usd - 0.005 AND tenant_id = ?
         ORDER BY created_at ASC`,
      )
      .all(supplierId, tenantId) as {
      id: number;
      total_usd: number;
      paid_usd: number;
    }[];

    const updateRow = this.db.prepare(
      `UPDATE supplier_purchases
       SET paid_usd = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND tenant_id = ?`,
    );

    // CQ-2 — shared FIFO allocator (same math as SupplierRepository's
    // _applyPurchaseFifoCoverage, which covers the same table); epsilon 0
    // matches this site's original exact tolerance.
    const takes = allocateFifo(
      unpaid.map((row) => ({
        id: row.id,
        outstanding: row.total_usd - row.paid_usd,
      })),
      amountUsd,
      0,
    );
    const unpaidById = new Map(unpaid.map((row) => [row.id, row]));
    for (const t of takes) {
      const row = unpaidById.get(t.id as number)!;
      updateRow.run(
        Math.min(row.paid_usd + t.take, row.total_usd),
        row.id,
        tenantId,
      );
    }
  }
}

let instance: SupplierPurchaseRepository | null = null;

export function getSupplierPurchaseRepository(): SupplierPurchaseRepository {
  if (!instance) instance = new SupplierPurchaseRepository(getDatabase());
  return instance;
}

export function resetSupplierPurchaseRepository(): void {
  instance = null;
}
