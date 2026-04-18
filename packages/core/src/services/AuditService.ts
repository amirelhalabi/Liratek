import {
  AuditRepository,
  getAuditRepository,
} from "../repositories/AuditRepository.js";
import type {
  CreateAuditLogData,
  AuditLogEntity,
  AuditFilters,
} from "../repositories/AuditRepository.js";
import logger from "../utils/logger.js";

const auditLogger = logger.child({ module: "audit" });

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
