import {
  AuditRepository,
  getAuditRepository,
} from "../repositories/AuditRepository.js";
import type {
  CreateAuditLogData,
  AuditLogEntity,
  AuditFilters,
} from "../repositories/AuditRepository.js";
import { runWithTenant, runWithoutTenant } from "../db/tenantContext.js";
import logger from "../utils/logger.js";

const auditLogger = logger.child({ module: "audit" });

/**
 * B-D3 (`PRODUCTION_DATABASE_AND_HOSTING_PLAN.md` § 12.1) — a super admin's
 * control-plane action against a target tenant (create/update/rename/delete
 * a tenant, change its subscription, issue a licence key, start an
 * impersonation session). The actor is a PLATFORM user; their id only exists
 * in the platform `users` table, never in the target shop's own file.
 */
export interface AdminActionAuditInput {
  /** The super admin's OWN platform user id — valid FK in the platform file only. */
  actorUserId: number;
  actorUsername: string;
  /** Always 'super_admin' for every current caller; kept as an input rather
   *  than hardcoded so a future platform role doesn't need a new method. */
  actorRole: string;
  targetTenantId: number;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  /** Extra fields folded into the PLATFORM row's metadata only. */
  metadata?: Record<string, unknown> | null;
}

// =============================================================================
// Service
// =============================================================================

export class AuditService {
  private repo: AuditRepository;

  constructor(repo?: AuditRepository) {
    this.repo = repo ?? getAuditRepository();
  }

  /**
   * Log an audit entry. Fire-and-forget — never throws.
   */
  log(data: CreateAuditLogData): void {
    try {
      this.repo.log(data);
    } catch (error) {
      auditLogger.error({ error, data }, "Failed to write audit log");
    }
  }

  /**
   * A super admin's control-plane action, recorded TWICE (B-D3):
   *
   * 1. The PLATFORM row — `tenant_id NULL`, the actor's REAL platform
   *    identity (valid FK: a super admin only ever lives in the platform
   *    `users` table), the target shop id folded into `metadata`. This is
   *    the durable control-plane record and the fix for the pre-existing
   *    bug where subscription-change/licence-key audit writes were silently
   *    dropped (`AuditRepository.log()` threw resolving `tenant_id` with no
   *    scope at all; wrapping here in `runWithoutTenant()` turns that into
   *    an explicit bypass, so `tenant_id` resolves to NULL instead of
   *    throwing).
   * 2. The SHOP-NOTE row — written inside `runWithTenant(targetTenantId)` so
   *    the target shop's OWN audit history isn't silently missing an action
   *    taken against it. `user_id` is the sentinel `0`, never the super
   *    admin's real platform id: `audit_log.user_id` has no FK, so writing
   *    the platform id there would not fail loudly, it would just silently
   *    LOOK like a real shop user happened to share that numeric id — worse
   *    than a crash. `0` can never collide with a real `users.id` row
   *    (AUTOINCREMENT starts at 1), and pairing it with `role: 'super_admin'`
   *    (a role no shop-provisioned account ever holds) makes the row
   *    unambiguous on sight. `impersonator_id` is always NULL here too — this
   *    is a direct admin action, not an impersonated session.
   *
   * Both writes are individually fire-and-forget, matching `log()`'s
   * contract: a failure on one must never suppress the other, and neither
   * may ever throw back into the route handler that already committed the
   * change this row describes.
   */
  logAdminAction(input: AdminActionAuditInput): void {
    try {
      runWithoutTenant(() => {
        this.repo.log({
          user_id: input.actorUserId,
          username: input.actorUsername,
          role: input.actorRole,
          action: input.action,
          entity_type: input.entityType,
          entity_id: input.entityId ?? null,
          summary: input.summary,
          old_values: input.oldValues ?? null,
          new_values: input.newValues ?? null,
          metadata: { ...input.metadata, targetTenantId: input.targetTenantId },
        });
      });
    } catch (error) {
      auditLogger.error(
        { error, input },
        "Failed to write platform admin-action audit log",
      );
    }

    try {
      runWithTenant(input.targetTenantId, () => {
        this.repo.log({
          user_id: 0,
          username: input.actorUsername,
          role: "super_admin",
          action: input.action,
          entity_type: input.entityType,
          entity_id: input.entityId ?? null,
          summary: input.summary,
          old_values: input.oldValues ?? null,
          new_values: input.newValues ?? null,
          impersonator_id: null,
          metadata: { platformAction: true },
        });
      });
    } catch (error) {
      auditLogger.error(
        { error, input },
        "Failed to write shop-note admin-action audit log",
      );
    }
  }

  getRecent(limit?: number): AuditLogEntity[] {
    return this.repo.getRecent(limit);
  }

  search(filters: AuditFilters): { rows: AuditLogEntity[]; total: number } {
    return this.repo.search(filters);
  }

  getByEntity(entityType: string, entityId: string): AuditLogEntity[] {
    return this.repo.getByEntity(entityType, entityId);
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: AuditService | null = null;

export function getAuditService(): AuditService {
  if (!instance) {
    instance = new AuditService();
  }
  return instance;
}

export function resetAuditService(): void {
  instance = null;
}

export { auditLogger };
export type { CreateAuditLogData, AuditLogEntity, AuditFilters };
