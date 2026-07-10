import { BaseRepository } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";

// =============================================================================
// Types
// =============================================================================

export interface AuditLogEntity {
  id: number;
  user_id: number;
  username: string;
  role: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  old_values: string | null;
  new_values: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateAuditLogData {
  user_id: number;
  username: string;
  role: string;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  summary: string;
  old_values?: Record<string, unknown> | null;
  new_values?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

export interface AuditFilters {
  userId?: number;
  action?: string;
  entityType?: string;
  entityId?: string;
  from?: string;
  to?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

// =============================================================================
// Repository
// =============================================================================

export class AuditRepository extends BaseRepository<AuditLogEntity> {
  constructor() {
    super("audit_log");
  }

  protected getColumns(): string {
    return "id, user_id, username, role, action, entity_type, entity_id, summary, old_values, new_values, metadata, created_at, updated_at";
  }

  /**
   * Insert an audit log entry. Returns the new row ID.
   */
  log(data: CreateAuditLogData): number {
    const stmt = this.db.prepare(`
      INSERT INTO audit_log
        (user_id, username, role, action, entity_type, entity_id,
         summary, old_values, new_values, metadata,
         tenant_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              datetime('now', 'localtime'), datetime('now', 'localtime'))
    `);
    const result = stmt.run(
      data.user_id,
      data.username,
      data.role,
      data.action,
      data.entity_type,
      data.entity_id ?? null,
      data.summary,
      data.old_values ? JSON.stringify(data.old_values) : null,
      data.new_values ? JSON.stringify(data.new_values) : null,
      data.metadata ? JSON.stringify(data.metadata) : null,
      getCurrentTenantId(),
    );
    return Number(result.lastInsertRowid);
  }

  /**
   * Get recent audit log entries.
   */
  getRecent(limit: number = 200): AuditLogEntity[] {
    const n = Math.min(Math.max(Number(limit), 1), 1000);
    return this.db
      .prepare(
        `SELECT * FROM audit_log WHERE tenant_id = ? ORDER BY id DESC LIMIT ?`,
      )
      .all(getCurrentTenantId(), n) as AuditLogEntity[];
  }

  /**
   * Get audit log entries for a specific entity.
   */
  getByEntity(entityType: string, entityId: string): AuditLogEntity[] {
    return this.db
      .prepare(
        `SELECT * FROM audit_log WHERE entity_type = ? AND entity_id = ? AND tenant_id = ? ORDER BY id DESC`,
      )
      .all(entityType, entityId, getCurrentTenantId()) as AuditLogEntity[];
  }

  /**
   * Search audit log with filters.
   */
  search(filters: AuditFilters): { rows: AuditLogEntity[]; total: number } {
    const params: unknown[] = [getCurrentTenantId()];
    // Each query string is built via its own `let x = "..."; x += "...";`
    // chain (never `${where}` template interpolation of a shared fragment
    // variable, and never conditions.push()+join()) so the literal
    // `tenant_id = ?` text stays statically visible to
    // scripts/check-tenant-scoping.mjs — it can trace a reassignment chain
    // on the bare identifier passed to `.prepare()`, but not a value that
    // only exists inside another local variable or an Array#join().
    let countQuery = "SELECT COUNT(*) as count FROM audit_log WHERE tenant_id = ?";
    let rowsQuery = "SELECT * FROM audit_log WHERE tenant_id = ?";

    if (filters.userId != null) {
      countQuery += " AND user_id = ?";
      rowsQuery += " AND user_id = ?";
      params.push(filters.userId);
    }
    if (filters.action) {
      countQuery += " AND action = ?";
      rowsQuery += " AND action = ?";
      params.push(filters.action);
    }
    if (filters.entityType) {
      countQuery += " AND entity_type = ?";
      rowsQuery += " AND entity_type = ?";
      params.push(filters.entityType);
    }
    if (filters.entityId) {
      countQuery += " AND entity_id = ?";
      rowsQuery += " AND entity_id = ?";
      params.push(filters.entityId);
    }
    if (filters.from) {
      countQuery += " AND created_at >= ?";
      rowsQuery += " AND created_at >= ?";
      params.push(filters.from);
    }
    if (filters.to) {
      countQuery += " AND created_at <= ?";
      rowsQuery += " AND created_at <= ?";
      params.push(filters.to);
    }
    if (filters.search) {
      countQuery += " AND summary LIKE ?";
      rowsQuery += " AND summary LIKE ?";
      params.push(`%${filters.search}%`);
    }
    rowsQuery += " ORDER BY id DESC LIMIT ? OFFSET ?";

    const limit = Math.min(Math.max(Number(filters.limit ?? 200), 1), 1000);
    const offset = Math.max(Number(filters.offset ?? 0), 0);

    const total = (
      this.db.prepare(countQuery).get(...params) as { count: number }
    ).count;

    const rows = this.db
      .prepare(rowsQuery)
      .all(...params, limit, offset) as AuditLogEntity[];

    return { rows, total };
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: AuditRepository | null = null;

export function getAuditRepository(): AuditRepository {
  if (!instance) {
    instance = new AuditRepository();
  }
  return instance;
}

export function resetAuditRepository(): void {
  instance = null;
}
