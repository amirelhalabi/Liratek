import { BaseRepository } from "./BaseRepository.js";
import { DatabaseError } from "../utils/errors.js";
export class SupplierRepository extends BaseRepository {
    constructor() {
        super("suppliers", { softDelete: false });
    }
    listSuppliers(search) {
        try {
            let sql = `SELECT * FROM suppliers WHERE is_active = 1`;
            const params = [];
            if (search?.trim()) {
                sql += ` AND name LIKE ?`;
                params.push(`%${search.trim()}%`);
            }
            sql += ` ORDER BY name ASC`;
            return this.query(sql, ...params);
        }
        catch (e) {
            throw new DatabaseError("Failed to list suppliers", { cause: e });
        }
    }
    createSupplier(data) {
        try {
            const stmt = this.db.prepare(`
        INSERT INTO suppliers (name, contact_name, phone, note, is_active, created_at)
        VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
      `);
            const res = stmt.run(data.name.trim(), data.contact_name ?? null, data.phone ?? null, data.note ?? null);
            return { id: Number(res.lastInsertRowid) };
        }
        catch (e) {
            throw new DatabaseError("Failed to create supplier", { cause: e });
        }
    }
    addLedgerEntry(data) {
        try {
            const stmt = this.db.prepare(`
        INSERT INTO supplier_ledger (
          supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);
            const res = stmt.run(data.supplier_id, data.entry_type, data.amount_usd || 0, data.amount_lbp || 0, data.note ?? null, data.created_by ?? null);
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
                    if (data.amount_usd)
                        upsertBalanceDelta.run(data.drawer_name, "USD", -data.amount_usd);
                    if (data.amount_lbp)
                        upsertBalanceDelta.run(data.drawer_name, "LBP", -data.amount_lbp);
                    // Log to payments table
                    this.db.prepare(`
            INSERT INTO payments (source_type, source_id, method, drawer_name, currency_code, amount, note, created_by)
            VALUES ('SUPPLIER_PAYMENT', ?, 'CASH', ?, ?, ?, ?, ?)
          `).run(entryId, data.drawer_name, data.amount_usd ? "USD" : "LBP", -(data.amount_usd || data.amount_lbp), data.note || `Supplier Payment: ${data.supplier_id}`, data.created_by || 1);
                }
            }
            return { id: entryId };
        }
        catch (e) {
            throw new DatabaseError("Failed to add supplier ledger entry", { cause: e });
        }
    }
    getSupplierLedger(supplierId, limit = 200) {
        try {
            return this.query(`SELECT * FROM supplier_ledger WHERE supplier_id = ? ORDER BY created_at DESC LIMIT ?`, supplierId, limit);
        }
        catch (e) {
            throw new DatabaseError("Failed to get supplier ledger", {
                cause: e,
                entityId: supplierId,
            });
        }
    }
    getSupplierBalances() {
        try {
            return this.query(`
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
        }
        catch (e) {
            throw new DatabaseError("Failed to get supplier balances", { cause: e });
        }
    }
}
let supplierRepositoryInstance = null;
export function getSupplierRepository() {
    if (!supplierRepositoryInstance)
        supplierRepositoryInstance = new SupplierRepository();
    return supplierRepositoryInstance;
}
export function resetSupplierRepository() {
    supplierRepositoryInstance = null;
}
