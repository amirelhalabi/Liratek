import { BaseRepository } from "./BaseRepository.js";
import { DatabaseError } from "../utils/errors.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";

export interface SupplierEntity {
  id: number;
  name: string;
  contact_name: string | null;
  phone: string | null;
  note: string | null;
  is_active: number;
  module_key: string | null;
  provider: string | null;
  is_system: number;
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
  transaction_id: number | null;
  created_at: string;
}

export interface CreateSupplierData {
  name: string;
  contact_name?: string;
  phone?: string;
  note?: string;
  module_key?: string;
  provider?: string;
}

export interface CreateSupplierLedgerEntryData {
  supplier_id: number;
  entry_type: SupplierLedgerEntryType;
  amount_usd: number;
  amount_lbp: number;
  note?: string;
  created_by?: number;
  drawer_name?: string;
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

  // Override getColumns() to use explicit columns instead of SELECT *
  protected getColumns(): string {
    return "id, name, contact_name, phone, note, is_active, module_key, provider, is_system, created_at";
  }

  listSuppliers(search?: string): SupplierEntity[] {
    try {
      let sql = `SELECT ${this.getColumns()} FROM suppliers WHERE is_active = 1`;
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
        INSERT INTO suppliers (name, contact_name, phone, note, module_key, provider, is_active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
      `);
      const res = stmt.run(
        data.name.trim(),
        data.contact_name ?? null,
        data.phone ?? null,
        data.note ?? null,
        data.module_key ?? null,
        data.provider ?? null,
      );
      return { id: Number(res.lastInsertRowid) };
    } catch (e) {
      throw new DatabaseError("Failed to create supplier", { cause: e });
    }
  }

  getByProvider(provider: string): SupplierEntity | undefined {
    try {
      const rows = this.query<SupplierEntity>(
        `SELECT ${this.getColumns()} FROM suppliers WHERE provider = ? AND is_active = 1 LIMIT 1`,
        provider,
      );
      return rows[0];
    } catch (e) {
      throw new DatabaseError("Failed to get supplier by provider", {
        cause: e,
      });
    }
  }

  getByModuleKey(moduleKey: string): SupplierEntity[] {
    try {
      return this.query<SupplierEntity>(
        `SELECT ${this.getColumns()} FROM suppliers WHERE module_key = ? AND is_active = 1 ORDER BY name ASC`,
        moduleKey,
      );
    } catch (e) {
      throw new DatabaseError("Failed to get suppliers by module", {
        cause: e,
      });
    }
  }

  addLedgerEntry(data: CreateSupplierLedgerEntryData): { id: number } {
    try {
      // Enforce sign convention: PAYMENT amounts stored as negative
      let amountUsd = data.amount_usd || 0;
      let amountLbp = data.amount_lbp || 0;
      if (data.entry_type === "PAYMENT") {
        amountUsd = -Math.abs(amountUsd);
        amountLbp = -Math.abs(amountLbp);
      }

      const stmt = this.db.prepare(`
        INSERT INTO supplier_ledger (
          supplier_id, entry_type, amount_usd, amount_lbp, note, created_by,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);
      const res = stmt.run(
        data.supplier_id,
        data.entry_type,
        amountUsd,
        amountLbp,
        data.note ?? null,
        data.created_by ?? null,
      );
      const entryId = Number(res.lastInsertRowid);

      // If drawer_name is provided, update drawer_balances
      if (data.drawer_name) {
        const upsertBalanceDelta = this.db.prepare(`
          INSERT INTO drawer_balances (drawer_name, currency_code, balance)
          VALUES (?, ?, ?)
          ON CONFLICT(drawer_name, currency_code) DO UPDATE SET
            balance = drawer_balances.balance + excluded.balance,
            updated_at = CURRENT_TIMESTAMP
        `);

        // Decrease drawer for PAYMENT, Increase for TOP_UP (refund style), or Adjustment
        // Logic: Debt is liability. Payment reduces liability and reduces asset (Cash).
        // TOP_UP increases liability and (theoretically) increases asset if we got stock?
        // Usually, payments are the ones affecting cash.
        if (data.entry_type === "PAYMENT") {
          // Create unified transaction row for supplier payment
          const txnId = getTransactionRepository().createTransaction({
            type: TRANSACTION_TYPES.SUPPLIER_PAYMENT,
            source_table: "supplier_ledger",
            source_id: entryId,
            user_id: data.created_by || 1,
            amount_usd: Math.abs(amountUsd),
            amount_lbp: Math.abs(amountLbp),
            summary: `Supplier Payment: $${Math.abs(amountUsd)} + ${Math.abs(amountLbp)} LBP`,
            metadata_json: {
              supplier_id: data.supplier_id,
              drawer_name: data.drawer_name,
            },
          });

          // Link supplier_ledger row to unified transaction
          this.db
            .prepare(
              `UPDATE supplier_ledger SET transaction_id = ? WHERE id = ?`,
            )
            .run(txnId, entryId);

          if (amountUsd)
            upsertBalanceDelta.run(data.drawer_name, "USD", amountUsd);
          if (amountLbp)
            upsertBalanceDelta.run(data.drawer_name, "LBP", amountLbp);

          // Log to payments table
          this.db
            .prepare(
              `
            INSERT INTO payments (transaction_id, method, drawer_name, currency_code, amount, note, created_by)
            VALUES (?, 'CASH', ?, ?, ?, ?, ?)
          `,
            )
            .run(
              txnId,
              data.drawer_name,
              amountUsd ? "USD" : "LBP",
              amountUsd || amountLbp,
              data.note || `Supplier Payment: ${data.supplier_id}`,
              data.created_by || 1,
            );
        }
      }

      return { id: entryId };
    } catch (e) {
      throw new DatabaseError("Failed to add supplier ledger entry", {
        cause: e,
      });
    }
  }

  getSupplierLedger(
    supplierId: number,
    limit = 200,
  ): SupplierLedgerEntryEntity[] {
    try {
      return this.query<SupplierLedgerEntryEntity>(
        `SELECT id, supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, transaction_id, created_at FROM supplier_ledger WHERE supplier_id = ? ORDER BY created_at DESC LIMIT ?`,
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
  if (!supplierRepositoryInstance)
    supplierRepositoryInstance = new SupplierRepository();
  return supplierRepositoryInstance;
}
export function resetSupplierRepository(): void {
  supplierRepositoryInstance = null;
}
