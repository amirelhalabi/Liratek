/**
 * Client Repository
 *
 * Handles all database operations for clients.
 * Extends BaseRepository for standard CRUD operations.
 *
 * Note: The clients table doesn't have is_active column, so soft delete is not used.
 */

import {
  BaseRepository,
  type FindOptions,
  type PaginatedResult,
} from "./BaseRepository.js";
import {
  DatabaseError,
  BusinessRuleError,
  getRepoConstraintCode,
} from "../utils/errors.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";
import { getCurrentTenantId } from "../db/tenantContext.js";

// =============================================================================
// Types
// =============================================================================

export interface ClientEntity {
  id: number;
  full_name: string;
  phone_number: string;
  notes: string | null;
  whatsapp_opt_in: number; // SQLite boolean (0 or 1)
  created_at: string;
}

export interface CreateClientData {
  full_name: string;
  phone_number: string;
  notes?: string;
  whatsapp_opt_in?: boolean | number;
}

export interface UpdateClientData {
  full_name?: string;
  phone_number?: string;
  notes?: string;
  whatsapp_opt_in?: boolean | number;
}

// =============================================================================
// Repository
// =============================================================================

export class ClientRepository extends BaseRepository<ClientEntity> {
  constructor() {
    // Note: clients table doesn't have is_active, so softDelete is false
    super("clients", { softDelete: false });
  }

  // Override getColumns() to use explicit columns instead of SELECT *
  protected getColumns(): string {
    return "id, full_name, phone_number, notes, whatsapp_opt_in, created_at";
  }

  // ---------------------------------------------------------------------------
  // Client-Specific Queries
  // ---------------------------------------------------------------------------

  /**
   * Get all clients with optional search filter
   */
  findAllClients(search?: string): ClientEntity[] {
    try {
      let query = `SELECT ${this.getColumns()} FROM ${this.tableName} WHERE tenant_id = ?`;
      const params: (string | number)[] = [getCurrentTenantId()];

      if (search) {
        query += ` AND (full_name LIKE ? OR phone_number LIKE ?)`;
        const term = `%${search}%`;
        params.push(term, term);
      }

      query += ` ORDER BY full_name ASC`;
      return this.query<ClientEntity>(query, ...params);
    } catch (error) {
      throw new DatabaseError("Failed to find clients", { cause: error });
    }
  }

  /**
   * Get paginated clients with search filter
   */
  findClientsPaginated(
    options: FindOptions & { search?: string } = {},
  ): PaginatedResult<ClientEntity> {
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
  findByPhone(phoneNumber: string): ClientEntity | null {
    try {
      const query = `SELECT ${this.getColumns()} FROM ${this.tableName} WHERE phone_number = ? AND tenant_id = ?`;
      return this.queryOne<ClientEntity>(
        query,
        phoneNumber,
        getCurrentTenantId(),
      );
    } catch (error) {
      throw new DatabaseError("Failed to find client by phone", {
        cause: error,
      });
    }
  }

  /**
   * Find client by exact full name (first match), ignoring letter case —
   * a name-only session typed as "amir shneif" must still resolve to
   * "AMIR SHNEIF". Exact-modulo-case only: never substring/fuzzy (rule that
   * fixed the session→client misattribution).
   */
  findByName(fullName: string): ClientEntity | null {
    try {
      const query = `SELECT ${this.getColumns()} FROM ${this.tableName} WHERE full_name = ? COLLATE NOCASE AND tenant_id = ? LIMIT 1`;
      return this.queryOne<ClientEntity>(query, fullName, getCurrentTenantId());
    } catch (error) {
      throw new DatabaseError("Failed to find client by name", {
        cause: error,
      });
    }
  }

  /**
   * Check if phone number already exists.
   *
   * Tenant-scoped: `clients.phone_number` is now UNIQUE per (tenant_id,
   * phone_number) (see migration v123), so an unscoped check would falsely
   * reject a phone number already used by a DIFFERENT tenant.
   */
  phoneExists(phoneNumber: string, excludeId?: number): boolean {
    try {
      const tenantId = getCurrentTenantId();
      const query = excludeId
        ? `SELECT 1 FROM ${this.tableName} WHERE phone_number = ? AND tenant_id = ? AND id != ?`
        : `SELECT 1 FROM ${this.tableName} WHERE phone_number = ? AND tenant_id = ?`;

      const params = excludeId
        ? [phoneNumber, tenantId, excludeId]
        : [phoneNumber, tenantId];
      return this.queryOne<{ 1: number }>(query, ...params) !== null;
    } catch (error) {
      throw new DatabaseError("Failed to check phone existence", {
        cause: error,
      });
    }
  }

  /**
   * Create a new client
   */
  createClient(data: CreateClientData, userId: number): { id: number } {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO ${this.tableName} (full_name, phone_number, notes, whatsapp_opt_in, tenant_id)
        VALUES (?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        data.full_name,
        data.phone_number,
        data.notes ?? null,
        data.whatsapp_opt_in ? 1 : 0,
        getCurrentTenantId(),
      );

      const clientId = result.lastInsertRowid as number;

      // Create unified transaction row
      getTransactionRepository().createTransaction({
        type: TRANSACTION_TYPES.CLIENT_CREATED,
        source_table: "clients",
        source_id: clientId,
        user_id: userId,
        amount_usd: 0,
        amount_lbp: 0,
        client_id: clientId,
        summary: `Client created: ${data.full_name}`,
        metadata_json: {
          fullName: data.full_name,
          phoneNumber: data.phone_number,
        },
      });

      return { id: clientId };
    } catch (error) {
      const code = (error as { code?: string })?.code;
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
   * Find the client owning `phone`, or register a new client with this
   * name+phone (FEATURE_GUIDE §6: an unknown name+phone auto-creates the
   * client). The PHONE is the identity key: when it already belongs to a
   * client under a different name, that client wins and no duplicate is
   * created — never match by partial/fuzzy name here (a `LIKE '%name%'
   * LIMIT 1` lookup once charged a session typed as "amir" to "AMIR SHNEIF").
   *
   * Race-safe: a concurrent registration of the same phone (second window /
   * web client) loses the INSERT to the UNIQUE(tenant_id, phone_number)
   * constraint and resolves to the winner's row instead of throwing.
   */
  findOrCreateByPhone(
    fullName: string,
    phone: string,
    userId: number,
  ): { id: number; created: boolean } {
    const existing = this.findByPhone(phone);
    if (existing) return { id: existing.id, created: false };

    try {
      const created = this.createClient(
        { full_name: fullName, phone_number: phone },
        userId,
      );
      return { id: created.id, created: true };
    } catch (error) {
      if (getRepoConstraintCode(error) === "DUPLICATE_PHONE") {
        const winner = this.findByPhone(phone);
        if (winner) return { id: winner.id, created: false };
      }
      throw error;
    }
  }

  /**
   * Update an existing client
   */
  updateClient(id: number, data: UpdateClientData): boolean {
    try {
      if (data.phone_number && this.phoneExists(data.phone_number, id)) {
        throw new DatabaseError(
          "Phone number already in use by another client",
          { code: "DUPLICATE_PHONE" },
        );
      }

      const stmt = this.db.prepare(`
        UPDATE ${this.tableName}
        SET full_name = COALESCE(?, full_name),
            phone_number = COALESCE(?, phone_number),
            notes = COALESCE(?, notes),
            whatsapp_opt_in = COALESCE(?, whatsapp_opt_in)
        WHERE id = ? AND tenant_id = ?
      `);

      const result = stmt.run(
        data.full_name ?? null,
        data.phone_number ?? null,
        data.notes ?? null,
        data.whatsapp_opt_in !== undefined
          ? data.whatsapp_opt_in
            ? 1
            : 0
          : null,
        id,
        getCurrentTenantId(),
      );

      return result.changes > 0;
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === "SQLITE_CONSTRAINT_UNIQUE") {
        throw new DatabaseError(
          "Phone number already in use by another client",
          { cause: error, code: "DUPLICATE_PHONE" },
        );
      }
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError("Failed to update client", {
        cause: error,
        entityId: id,
      });
    }
  }

  /**
   * Update client with all fields explicitly (for handler compatibility)
   */
  updateClientFull(
    id: number,
    data: {
      full_name: string;
      phone_number: string;
      notes?: string | null;
      whatsapp_opt_in: boolean | number;
    },
    userId: number,
  ): boolean {
    try {
      const stmt = this.db.prepare(`
        UPDATE ${this.tableName}
        SET full_name = ?, phone_number = ?, notes = ?, whatsapp_opt_in = ?
        WHERE id = ? AND tenant_id = ?
      `);

      const result = stmt.run(
        data.full_name,
        data.phone_number,
        data.notes ?? null,
        data.whatsapp_opt_in ? 1 : 0,
        id,
        getCurrentTenantId(),
      );

      if (result.changes > 0) {
        // Create unified transaction row
        getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.CLIENT_UPDATED,
          source_table: "clients",
          source_id: id,
          user_id: userId,
          amount_usd: 0,
          amount_lbp: 0,
          client_id: id,
          summary: `Client updated: ${data.full_name}`,
          metadata_json: {
            fullName: data.full_name,
            phoneNumber: data.phone_number,
          },
        });
      }

      return result.changes > 0;
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === "SQLITE_CONSTRAINT_UNIQUE") {
        throw new DatabaseError(
          "Phone number already in use by another client",
          { cause: error, code: "DUPLICATE_PHONE" },
        );
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
  hasSalesHistory(id: number): boolean {
    try {
      const result = this.queryOne<{ count: number }>(
        `SELECT count(*) as count FROM sales WHERE client_id = ? AND tenant_id = ?`,
        id,
        getCurrentTenantId(),
      );
      return (result?.count ?? 0) > 0;
    } catch (error) {
      throw new DatabaseError("Failed to check sales history", {
        cause: error,
      });
    }
  }

  /**
   * Delete client (hard delete) - checks for sales history first
   */
  deleteClient(id: number, userId: number): boolean {
    // Check for existing sales
    if (this.hasSalesHistory(id)) {
      throw new BusinessRuleError(
        "Cannot delete client with existing sales history",
      );
    }

    // Get client info for logging before deletion
    const client = this.findById(id);

    const deleted = this.delete(id);

    if (deleted && client) {
      // Create unified transaction row
      getTransactionRepository().createTransaction({
        type: TRANSACTION_TYPES.CLIENT_DELETED,
        source_table: "clients",
        source_id: id,
        user_id: userId,
        amount_usd: 0,
        amount_lbp: 0,
        client_id: id,
        summary: `Client deleted: ${client.full_name}`,
        metadata_json: {
          fullName: client.full_name,
          phoneNumber: client.phone_number,
        },
      });
    }

    return deleted;
  }

  /**
   * Search clients by name or phone
   */
  search(term: string, options: { limit?: number } = {}): ClientEntity[] {
    try {
      const { limit = 20 } = options;
      const searchTerm = `%${term}%`;

      const query = `
        SELECT ${this.getColumns()} FROM ${this.tableName}
        WHERE (full_name LIKE ? OR phone_number LIKE ?) AND tenant_id = ?
        ORDER BY full_name ASC
        LIMIT ?
      `;

      return this.query<ClientEntity>(
        query,
        searchTerm,
        searchTerm,
        getCurrentTenantId(),
        limit,
      );
    } catch (error) {
      throw new DatabaseError("Failed to search clients", { cause: error });
    }
  }

  /**
   * Get client debt balance
   */
  getDebtBalance(clientId: number): number {
    try {
      const result = this.queryOne<{ total: number }>(
        `SELECT COALESCE(SUM(amount_usd), 0) as total FROM debt_ledger WHERE client_id = ? AND tenant_id = ?`,
        clientId,
        getCurrentTenantId(),
      );
      return result?.total ?? 0;
    } catch (error) {
      throw new DatabaseError("Failed to get client debt", { cause: error });
    }
  }

  /**
   * Get clients with outstanding debt
   */
  findClientsWithDebt(): (ClientEntity & { debt_total: number })[] {
    try {
      const tenantId = getCurrentTenantId();
      return this.query<ClientEntity & { debt_total: number }>(
        `
        SELECT c.*, COALESCE(d.total, 0) as debt_total
        FROM ${this.tableName} c
        LEFT JOIN (
          SELECT client_id, tenant_id, SUM(amount_usd) as total
          FROM debt_ledger
          WHERE tenant_id = ?
          GROUP BY client_id, tenant_id
        ) d ON c.id = d.client_id AND c.tenant_id = d.tenant_id
        WHERE d.total > 0 AND c.tenant_id = ?
        ORDER BY d.total DESC
      `,
        tenantId,
        tenantId,
      );
    } catch (error) {
      throw new DatabaseError("Failed to find clients with debt", {
        cause: error,
      });
    }
  }

  /**
   * Get clients who have opted in for WhatsApp
   */
  findWhatsAppOptedIn(): ClientEntity[] {
    try {
      return this.query<ClientEntity>(
        `SELECT ${this.getColumns()} FROM ${this.tableName} WHERE whatsapp_opt_in = 1 AND tenant_id = ? ORDER BY full_name ASC`,
        getCurrentTenantId(),
      );
    } catch (error) {
      throw new DatabaseError("Failed to find WhatsApp opted-in clients", {
        cause: error,
      });
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let clientRepositoryInstance: ClientRepository | null = null;

export function getClientRepository(): ClientRepository {
  if (!clientRepositoryInstance) {
    clientRepositoryInstance = new ClientRepository();
  }
  return clientRepositoryInstance;
}

/** Reset the singleton (for testing) */
export function resetClientRepository(): void {
  clientRepositoryInstance = null;
}
