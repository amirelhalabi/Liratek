import { BaseRepository } from "./BaseRepository.js";

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
         created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
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
    );
    return Number(result.lastInsertRowid);
  }

  /**
   * Get recent audit log entries.
   */
  getRecent(limit: number = 200): AuditLogEntity[] {
    const n = Math.min(Math.max(Number(limit), 1), 1000);
    return this.db
      .prepare(`SELECT * FROM audit_log ORDER BY id DESC LIMIT ?`)
      .all(n) as AuditLogEntity[];
  }

  /**
   * Get audit log entries for a specific entity.
   */
  getByEntity(entityType: string, entityId: string): AuditLogEntity[] {
    return this.db
      .prepare(
        `SELECT * FROM audit_log WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC`,
      )
      .all(entityType, entityId) as AuditLogEntity[];
  }

  /**
   * Search audit log with filters.
   */
  search(filters: AuditFilters): { rows: AuditLogEntity[]; total: number } {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.userId != null) {
      conditions.push("user_id = ?");
      params.push(filters.userId);
    }
    if (filters.action) {
      conditions.push("action = ?");
      params.push(filters.action);
    }
    if (filters.entityType) {
      conditions.push("entity_type = ?");
      params.push(filters.entityType);
    }
    if (filters.entityId) {
      conditions.push("entity_id = ?");
      params.push(filters.entityId);
    }
    if (filters.from) {
      conditions.push("created_at >= ?");
      params.push(filters.from);
    }
    if (filters.to) {
      conditions.push("created_at <= ?");
      params.push(filters.to);
    }
    if (filters.search) {
      conditions.push("summary LIKE ?");
      params.push(`%${filters.search}%`);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = Math.min(Math.max(Number(filters.limit ?? 200), 1), 1000);
    const offset = Math.max(Number(filters.offset ?? 0), 0);

    const total = (
      this.db
        .prepare(`SELECT COUNT(*) as count FROM audit_log ${where}`)
        .get(...params) as { count: number }
    ).count;

    const rows = this.db
      .prepare(
        `SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      )
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
