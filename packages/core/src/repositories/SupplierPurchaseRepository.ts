import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";

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
        `INSERT INTO supplier_purchases (supplier_id, total_usd, note, created_by)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        data.supplier_id,
        data.total_usd,
        data.note ?? null,
        data.created_by ?? null,
      );
    return this.getById(Number(res.lastInsertRowid))!;
  }

  getById(id: number): SupplierPurchase | null {
    return this.db
      .prepare(`SELECT *, ${STATUS_CASE} FROM supplier_purchases WHERE id = ?`)
      .get(id) as SupplierPurchase | null;
  }

  getBySupplier(supplierId: number): SupplierPurchase[] {
    return this.db
      .prepare(
        `SELECT *, ${STATUS_CASE}
         FROM supplier_purchases
         WHERE supplier_id = ?
         ORDER BY created_at ASC`,
      )
      .all(supplierId) as SupplierPurchase[];
  }

  /**
   * Apply a USD-equivalent payment to this supplier's oldest unpaid/partial
   * purchases (FIFO). Must be called inside an existing db.transaction() so
   * the update is atomic with the payment ledger entry.
   */
  applyFifoPayment(supplierId: number, amountUsd: number): void {
    if (amountUsd <= 0) return;

    const unpaid = this.db
      .prepare(
        `SELECT id, total_usd, paid_usd
         FROM supplier_purchases
         WHERE supplier_id = ? AND paid_usd < total_usd - 0.005
         ORDER BY created_at ASC`,
      )
      .all(supplierId) as { id: number; total_usd: number; paid_usd: number }[];

    const updateRow = this.db.prepare(
      `UPDATE supplier_purchases
       SET paid_usd = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    );

    let remaining = amountUsd;
    for (const row of unpaid) {
      if (remaining <= 0) break;
      const canAbsorb = row.total_usd - row.paid_usd;
      const applied = Math.min(remaining, canAbsorb);
      updateRow.run(Math.min(row.paid_usd + applied, row.total_usd), row.id);
      remaining -= applied;
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
