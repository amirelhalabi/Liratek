import { BaseRepository } from "./BaseRepository.js";
import { getCurrentTenantId, isTenantBypass } from "../db/tenantContext.js";

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
  /** Set only on rows written during an impersonated session (plan §5/WP6):
   * the real super_admin acting behind the tenant-admin identity in user_id. */
  impersonator_id: number | null;
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
  /** Real super_admin id — set ONLY when this row is written during an
   * impersonated session. Defaults to null for every normal write. */
  impersonator_id?: number | null;
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
    return "id, user_id, username, role, action, entity_type, entity_id, summary, old_values, new_values, metadata, impersonator_id, created_at, updated_at";
  }

  /**
   * Insert an audit log entry. Returns the new row ID.
   *
   * `tenant_id`: `getCurrentTenantId()` inside an explicit
   * `runWithoutTenant()` bypass — the platform's own control-plane calls
   * (`AuditService.logAdminAction()`'s platform-row write) — so a NULL
   * `tenant_id` row lands in whichever database is currently in scope (the
   * platform file, once resolved that way). Any OTHER unscoped call (no
   * `runWithTenant()` and no explicit bypass) still throws, same as before:
   * a forgotten wrapper must stay a loud failure, not a silent NULL-tenant
   * row (B-D3; this also used to be why subscription-change/license-key
   * audit rows were silently dropped — `AuditService.log()` swallows the
   * throw — see `logAdminAction()`, which now wraps its platform write in
   * `runWithoutTenant()` explicitly instead of relying on ambient scope).
   *
   * `created_at`/`updated_at`: `CURRENT_TIMESTAMP` (plain UTC), matching
   * every other table's convention (`transactions.created_at`, the
   * repository template in `packages/core/CLAUDE.md`). LIRA-243: this used
   * to be `datetime('now', 'localtime')` — the QUERY HOST's wall-clock time
   * (the shop's PC on desktop, always non-UTC; the Fly container's own zone
   * on web). The frontend renders every timestamp through
   * `parseDbDate.ts`, which pins a marker-less string to UTC before
   * converting to the viewer's local zone — correct for `CURRENT_TIMESTAMP`,
   * but a value that was ALREADY local got double-shifted, showing the
   * Audit Log 3h ahead of the Transactions tab for the same real moment
   * (Beirut's offset). Fixing the write side (not the renderer, which was
   * already doing the right thing for a value that should have been UTC) is
   * what rule 27 calls for — never derive a wall-clock value from the query
   * host's own OS zone on a request path. NOTE: rows written before this fix
   * remain stamped in whatever the writing machine's local zone was — this
   * change does not rewrite them (see LIRA-243 investigation notes on old
   * rows).
   */
  log(data: CreateAuditLogData): number {
    const tenantId = isTenantBypass() ? null : getCurrentTenantId();
    const stmt = this.db.prepare(`
      INSERT INTO audit_log
        (user_id, username, role, action, entity_type, entity_id,
         summary, old_values, new_values, metadata,
         impersonator_id, tenant_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
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
      data.impersonator_id ?? null,
      tenantId,
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
    let countQuery =
      "SELECT COUNT(*) as count FROM audit_log WHERE tenant_id = ?";
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
