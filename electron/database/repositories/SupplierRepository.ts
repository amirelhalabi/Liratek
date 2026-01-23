import { BaseRepository } from "./BaseRepository";
import { DatabaseError } from "../../utils/errors";

export interface SupplierEntity {
  id: number;
  name: string;
  contact_name: string | null;
  phone: string | null;
  note: string | null;
  is_active: number;
  created_at: string;
}

export type SupplierLedgerEntryType = "TOP_UP" | "PAYMENT" | "ADJUSTMENT";

export interface SupplierLedgerEntryEntity {
  id: number;
  supplier_id: number;
  entry_type: SupplierLedgerEntryType;
  amount_usd: number;
  amount_lbp: number;
  note: string | null;
  created_by: number | null;
  created_at: string;
}

export interface CreateSupplierData {
  name: string;
  contact_name?: string;
  phone?: string;
  note?: string;
}

export interface CreateSupplierLedgerEntryData {
  supplier_id: number;
  entry_type: SupplierLedgerEntryType;
  amount_usd: number;
  amount_lbp: number;
  note?: string;
  created_by?: number;
}

export interface SupplierBalance {
  supplier_id: number;
  total_usd: number;
  total_lbp: number;
}

export class SupplierRepository extends BaseRepository<SupplierEntity> {
  constructor() {
    super("suppliers", { softDelete: false });
  }

  listSuppliers(search?: string): SupplierEntity[] {
    try {
      let sql = `SELECT * FROM suppliers WHERE is_active = 1`;
      const params: string[] = [];
      if (search?.trim()) {
        sql += ` AND name LIKE ?`;
        params.push(`%${search.trim()}%`);
      }
      sql += ` ORDER BY name ASC`;
      return this.query<SupplierEntity>(sql, ...params);
    } catch (e) {
      throw new DatabaseError("Failed to list suppliers", { cause: e });
    }
  }

  createSupplier(data: CreateSupplierData): { id: number } {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO suppliers (name, contact_name, phone, note, is_active, created_at)
        VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
      `);
      const res = stmt.run(
        data.name.trim(),
        data.contact_name ?? null,
        data.phone ?? null,
        data.note ?? null,
      );
      return { id: Number(res.lastInsertRowid) };
    } catch (e) {
      throw new DatabaseError("Failed to create supplier", { cause: e });
    }
  }

  addLedgerEntry(data: CreateSupplierLedgerEntryData): { id: number } {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO supplier_ledger (
          supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);
      const res = stmt.run(
        data.supplier_id,
        data.entry_type,
        data.amount_usd || 0,
        data.amount_lbp || 0,
        data.note ?? null,
        data.created_by ?? null,
      );
      return { id: Number(res.lastInsertRowid) };
    } catch (e) {
      throw new DatabaseError("Failed to add supplier ledger entry", { cause: e });
    }
  }

  getSupplierLedger(supplierId: number, limit = 200): SupplierLedgerEntryEntity[] {
    try {
      return this.query<SupplierLedgerEntryEntity>(
        `SELECT * FROM supplier_ledger WHERE supplier_id = ? ORDER BY created_at DESC LIMIT ?`,
        supplierId,
        limit,
      );
    } catch (e) {
      throw new DatabaseError("Failed to get supplier ledger", {
        cause: e,
        entityId: supplierId,
      });
    }
  }

  getSupplierBalances(): SupplierBalance[] {
    try {
      return this.query<SupplierBalance>(`
        SELECT
          s.id as supplier_id,
          COALESCE(SUM(l.amount_usd), 0) as total_usd,
          COALESCE(SUM(l.amount_lbp), 0) as total_lbp
        FROM suppliers s
        LEFT JOIN supplier_ledger l ON l.supplier_id = s.id
        WHERE s.is_active = 1
        GROUP BY s.id
        ORDER BY s.name ASC
      `);
    } catch (e) {
      throw new DatabaseError("Failed to get supplier balances", { cause: e });
    }
  }
}

let supplierRepositoryInstance: SupplierRepository | null = null;
export function getSupplierRepository(): SupplierRepository {
  if (!supplierRepositoryInstance) supplierRepositoryInstance = new SupplierRepository();
  return supplierRepositoryInstance;
}
export function resetSupplierRepository(): void {
  supplierRepositoryInstance = null;
}
