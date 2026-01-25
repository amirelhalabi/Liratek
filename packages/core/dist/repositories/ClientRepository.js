/**
 * Client Repository
 *
 * Handles all database operations for clients.
 * Extends BaseRepository for standard CRUD operations.
 *
 * Note: The clients table doesn't have is_active column, so soft delete is not used.
 */
import { BaseRepository, } from "./BaseRepository.js";
import { DatabaseError, BusinessRuleError } from "../utils/errors.js";
// =============================================================================
// Repository
// =============================================================================
export class ClientRepository extends BaseRepository {
    constructor() {
        // Note: clients table doesn't have is_active, so softDelete is false
        super("clients", { softDelete: false });
    }
    // ---------------------------------------------------------------------------
    // Client-Specific Queries
    // ---------------------------------------------------------------------------
    /**
     * Get all clients with optional search filter
     */
    findAllClients(search) {
        try {
            let query = `SELECT * FROM ${this.tableName} WHERE 1=1`;
            const params = [];
            if (search) {
                query += ` AND (full_name LIKE ? OR phone_number LIKE ?)`;
                const term = `%${search}%`;
                params.push(term, term);
            }
            query += ` ORDER BY full_name ASC`;
            return this.query(query, ...params);
        }
        catch (error) {
            throw new DatabaseError("Failed to find clients", { cause: error });
        }
    }
    /**
     * Get paginated clients with search filter
     */
    findClientsPaginated(options = {}) {
        const { limit = 50, offset = 0, search } = options;
        const data = this.findAllClients(search);
        const total = search ? data.length : this.count();
        const paginatedData = limit ? data.slice(offset, offset + limit) : data;
        return {
            data: paginatedData,
            total,
            limit,
            offset,
            hasMore: offset + paginatedData.length < total,
        };
    }
    /**
     * Find client by phone number
     */
    findByPhone(phoneNumber) {
        try {
            const query = `SELECT * FROM ${this.tableName} WHERE phone_number = ?`;
            return this.queryOne(query, phoneNumber);
        }
        catch (error) {
            throw new DatabaseError("Failed to find client by phone", {
                cause: error,
            });
        }
    }
    /**
     * Check if phone number already exists
     */
    phoneExists(phoneNumber, excludeId) {
        try {
            const query = excludeId
                ? `SELECT 1 FROM ${this.tableName} WHERE phone_number = ? AND id != ?`
                : `SELECT 1 FROM ${this.tableName} WHERE phone_number = ?`;
            const params = excludeId ? [phoneNumber, excludeId] : [phoneNumber];
            return this.queryOne(query, ...params) !== null;
        }
        catch (error) {
            throw new DatabaseError("Failed to check phone existence", {
                cause: error,
            });
        }
    }
    /**
     * Create a new client
     */
    createClient(data) {
        try {
            const stmt = this.db.prepare(`
        INSERT INTO ${this.tableName} (full_name, phone_number, notes, whatsapp_opt_in)
        VALUES (?, ?, ?, ?)
      `);
            const result = stmt.run(data.full_name, data.phone_number, data.notes ?? null, data.whatsapp_opt_in ? 1 : 0);
            return { id: result.lastInsertRowid };
        }
        catch (error) {
            const code = error?.code;
            if (code === "SQLITE_CONSTRAINT_UNIQUE") {
                throw new DatabaseError("Phone number already registered", {
                    cause: error,
                    code: "DUPLICATE_PHONE",
                });
            }
            throw new DatabaseError("Failed to create client", { cause: error });
        }
    }
    /**
     * Update an existing client
     */
    updateClient(id, data) {
        try {
            if (data.phone_number && this.phoneExists(data.phone_number, id)) {
                throw new DatabaseError("Phone number already in use by another client", { code: "DUPLICATE_PHONE" });
            }
            const stmt = this.db.prepare(`
        UPDATE ${this.tableName} 
        SET full_name = COALESCE(?, full_name), 
            phone_number = COALESCE(?, phone_number), 
            notes = COALESCE(?, notes), 
            whatsapp_opt_in = COALESCE(?, whatsapp_opt_in)
        WHERE id = ?
      `);
            const result = stmt.run(data.full_name ?? null, data.phone_number ?? null, data.notes ?? null, data.whatsapp_opt_in !== undefined
                ? data.whatsapp_opt_in
                    ? 1
                    : 0
                : null, id);
            return result.changes > 0;
        }
        catch (error) {
            const code = error?.code;
            if (code === "SQLITE_CONSTRAINT_UNIQUE") {
                throw new DatabaseError("Phone number already in use by another client", { cause: error, code: "DUPLICATE_PHONE" });
            }
            if (error instanceof DatabaseError)
                throw error;
            throw new DatabaseError("Failed to update client", {
                cause: error,
                entityId: id,
            });
        }
    }
    /**
     * Update client with all fields explicitly (for handler compatibility)
     */
    updateClientFull(id, data) {
        try {
            const stmt = this.db.prepare(`
        UPDATE ${this.tableName} 
        SET full_name = ?, phone_number = ?, notes = ?, whatsapp_opt_in = ?
        WHERE id = ?
      `);
            const result = stmt.run(data.full_name, data.phone_number, data.notes ?? null, data.whatsapp_opt_in ? 1 : 0, id);
            return result.changes > 0;
        }
        catch (error) {
            const code = error?.code;
            if (code === "SQLITE_CONSTRAINT_UNIQUE") {
                throw new DatabaseError("Phone number already in use by another client", { cause: error, code: "DUPLICATE_PHONE" });
            }
            throw new DatabaseError("Failed to update client", {
                cause: error,
                entityId: id,
            });
        }
    }
    /**
     * Check if client has sales history (used before hard delete)
     */
    hasSalesHistory(id) {
        try {
            const result = this.queryOne(`SELECT count(*) as count FROM sales WHERE client_id = ?`, id);
            return (result?.count ?? 0) > 0;
        }
        catch (error) {
            throw new DatabaseError("Failed to check sales history", {
                cause: error,
            });
        }
    }
    /**
     * Delete client (hard delete) - checks for sales history first
     */
    deleteClient(id) {
        // Check for existing sales
        if (this.hasSalesHistory(id)) {
            throw new BusinessRuleError("Cannot delete client with existing sales history");
        }
        return this.delete(id);
    }
    /**
     * Search clients by name or phone
     */
    search(term, options = {}) {
        try {
            const { limit = 20 } = options;
            const searchTerm = `%${term}%`;
            const query = `
        SELECT * FROM ${this.tableName} 
        WHERE full_name LIKE ? OR phone_number LIKE ?
        ORDER BY full_name ASC 
        LIMIT ?
      `;
            return this.query(query, searchTerm, searchTerm, limit);
        }
        catch (error) {
            throw new DatabaseError("Failed to search clients", { cause: error });
        }
    }
    /**
     * Get client debt balance
     */
    getDebtBalance(clientId) {
        try {
            const result = this.queryOne(`SELECT COALESCE(SUM(amount_usd), 0) as total FROM debt_ledger WHERE client_id = ?`, clientId);
            return result?.total ?? 0;
        }
        catch (error) {
            throw new DatabaseError("Failed to get client debt", { cause: error });
        }
    }
    /**
     * Get clients with outstanding debt
     */
    findClientsWithDebt() {
        try {
            return this.query(`
        SELECT c.*, COALESCE(d.total, 0) as debt_total
        FROM ${this.tableName} c
        LEFT JOIN (
          SELECT client_id, SUM(amount_usd) as total 
          FROM debt_ledger 
          GROUP BY client_id
        ) d ON c.id = d.client_id
        WHERE d.total > 0
        ORDER BY d.total DESC
      `);
        }
        catch (error) {
            throw new DatabaseError("Failed to find clients with debt", {
                cause: error,
            });
        }
    }
    /**
     * Get clients who have opted in for WhatsApp
     */
    findWhatsAppOptedIn() {
        try {
            return this.query(`SELECT * FROM ${this.tableName} WHERE whatsapp_opt_in = 1 ORDER BY full_name ASC`);
        }
        catch (error) {
            throw new DatabaseError("Failed to find WhatsApp opted-in clients", {
                cause: error,
            });
        }
    }
}
// =============================================================================
// Singleton Instance
// =============================================================================
let clientRepositoryInstance = null;
export function getClientRepository() {
    if (!clientRepositoryInstance) {
        clientRepositoryInstance = new ClientRepository();
    }
    return clientRepositoryInstance;
}
/** Reset the singleton (for testing) */
export function resetClientRepository() {
    clientRepositoryInstance = null;
}
