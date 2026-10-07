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
import { SENSITIVE_SETTING_KEYS } from "../constants/sensitiveSettings.js";

const auditLogger = logger.child({ module: "audit" });

/**
 * LIRA-220 — an audit row's `old_values`/`new_values` must never carry a
 * `SENSITIVE_SETTING_KEYS` value in plaintext. This is the ONE place both
 * transports converge (rule 14): `electron-app/handlers/auditHelper.ts`'s
 * `audit()` and `backend/src/middleware/audit.ts`'s `auditRest()` both end
 * at `log()` below, and both transports' read routes call `getRecent()` /
 * `search()` / `getByEntity()` directly — so redacting here, once, covers
 * every caller on every surface without a second copy of the predicate.
 */
const REDACTED_AUDIT_VALUE: Record<string, unknown> = { redacted: true };

function isSensitiveSettingAuditEntity(
  entityType: string,
  entityId?: string | null,
): boolean {
  return (
    entityType === "setting" &&
    !!entityId &&
    SENSITIVE_SETTING_KEYS.has(entityId)
  );
}

/**
 * Write-time redaction: strips a sensitive setting's value BEFORE it ever
 * reaches `AuditRepository.log()` / the `audit_log` table. Only touches
 * `old_values`/`new_values`, and only when each is actually present — an
 * omitted value (e.g. `ProfitsAccessService`'s own password-set audit call,
 * which never includes `new_values` at all) stays omitted rather than
 * gaining a fabricated marker.
 */
function redactSensitiveAuditWrite(
  data: CreateAuditLogData,
): CreateAuditLogData {
  if (!isSensitiveSettingAuditEntity(data.entity_type, data.entity_id)) {
    return data;
  }
  return {
    ...data,
    old_values: data.old_values ? REDACTED_AUDIT_VALUE : data.old_values,
    new_values: data.new_values ? REDACTED_AUDIT_VALUE : data.new_values,
  };
}

/**
 * Read-time redaction: protects rows already sitting in `audit_log` in
 * plaintext (written before this fix, or by any future caller that bypasses
 * `log()`'s write-time guard by calling `AuditRepository.log()` directly).
 * Cheap — these methods already touch every row on the way out. `old_values`/
 * `new_values` on `AuditLogEntity` are raw JSON strings (or null); only a
 * non-null value is replaced, so an already-empty column stays `null`
 * rather than gaining a fabricated marker.
 */
function redactSensitiveAuditRow(row: AuditLogEntity): AuditLogEntity {
  if (!isSensitiveSettingAuditEntity(row.entity_type, row.entity_id)) {
    return row;
  }
  const redactedJson = JSON.stringify(REDACTED_AUDIT_VALUE);
  return {
    ...row,
    old_values: row.old_values ? redactedJson : row.old_values,
    new_values: row.new_values ? redactedJson : row.new_values,
  };
}

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
  /**
   * The shop the action targets. `null` for a platform action that has no
   * shop yet (LIRA-267: sending a sign-up invite) -- then only the platform
   * row is written and the shop-note write is skipped entirely.
   */
  targetTenantId: number | null;
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
      this.repo.log(redactSensitiveAuditWrite(data));
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
        this.repo.log(
          redactSensitiveAuditWrite({
            user_id: input.actorUserId,
            username: input.actorUsername,
            role: input.actorRole,
            action: input.action,
            entity_type: input.entityType,
            entity_id: input.entityId ?? null,
            summary: input.summary,
            old_values: input.oldValues ?? null,
            new_values: input.newValues ?? null,
            metadata: {
              ...input.metadata,
              targetTenantId: input.targetTenantId,
            },
          }),
        );
      });
    } catch (error) {
      auditLogger.error(
        { error, input },
        "Failed to write platform admin-action audit log",
      );
    }

    // No target shop (e.g. a sign-up invite): there is no shop history to
    // annotate. Skipped rather than attempted, because runWithTenant(null)
    // throws and would log a false error on every such action.
    const targetTenantId = input.targetTenantId;
    if (targetTenantId === null) return;

    try {
      runWithTenant(targetTenantId, () => {
        this.repo.log(
          redactSensitiveAuditWrite({
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
          }),
        );
      });
    } catch (error) {
      auditLogger.error(
        { error, input },
        "Failed to write shop-note admin-action audit log",
      );
    }
  }

  getRecent(limit?: number): AuditLogEntity[] {
    return this.repo.getRecent(limit).map(redactSensitiveAuditRow);
  }

  search(filters: AuditFilters): { rows: AuditLogEntity[]; total: number } {
    const result = this.repo.search(filters);
    return { rows: result.rows.map(redactSensitiveAuditRow), total: result.total };
  }

  getByEntity(entityType: string, entityId: string): AuditLogEntity[] {
    return this.repo
      .getByEntity(entityType, entityId)
      .map(redactSensitiveAuditRow);
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
