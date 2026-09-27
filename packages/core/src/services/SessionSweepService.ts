/**
 * Fans `SessionRepository`'s two global background sweeps
 * (`deleteExpiredSessions`/`deleteInactiveSessions`) out across every
 * database file the process knows about (`PRODUCTION_DATABASE_AND_HOSTING_PLAN.md`
 * § 12.3 wave 2, ticket item 1).
 *
 * Both sweep methods are DELIBERATELY not tenant-scoped SQL — each one runs
 * an unfiltered `DELETE` against whichever file is CURRENT, by design (see
 * their own doc comments in `SessionRepository.ts`): a global sweep over a
 * single shared file. That is still exactly correct in `shared` mode and on
 * desktop, where there is only ever one file. What changes in `per-tenant`
 * mode is that "whichever file is current" must be tried once per file that
 * exists — the platform file (super-admin sessions, and the single file in
 * shared mode) plus every shop file — summing counts across all of them.
 *
 * This orchestration deliberately lives here, not in the repository (rule
 * 13): `SessionRepository` keeps its single-file SQL untouched; this class
 * only decides WHICH file is current for each pass, via `runWithTenant`/
 * `runWithoutTenant` — context-scoping, not a database access of its own —
 * and reads `listTenantDatabaseIds()` to know which shop ids exist. In
 * `shared` mode (or desktop, or any test that never installs a lister)
 * `listTenantDatabaseIds()` returns `null` and this is exactly the sweep
 * that already ran before per-tenant mode existed: one pass, over the one
 * file `runWithoutTenant()` resolves to.
 *
 * One shop's file failing to open/migrate must never stop the sweep for the
 * rest of the shops, or for the platform pass — each tenant is wrapped in
 * its own try/catch and reported, never thrown, matching the same
 * one-bad-tenant-does-not-stop-the-others invariant `migrateAllTenants` and
 * `TenantDatabasePool` already hold elsewhere in this plan.
 */
import {
  SessionRepository,
  getSessionRepository,
} from "../repositories/SessionRepository.js";
import { runWithTenant, runWithoutTenant } from "../db/tenantContext.js";
import { listTenantDatabaseIds } from "../db/tenantDatabaseIds.js";
import { authLogger } from "../utils/logger.js";

export interface SessionSweepResult {
  /** Sum of `deleteExpiredSessions()` across every database swept. */
  expiredCount: number;
  /** Sum of `deleteInactiveSessions()` across every database swept. */
  inactiveCount: number;
  /** How many databases were swept successfully (platform + tenants). */
  sweptDatabaseCount: number;
  /** Tenant ids whose sweep threw — logged, not thrown; the platform pass
   * and every OTHER tenant still ran. */
  failedTenantIds: number[];
}

export class SessionSweepService {
  private sessionRepo: SessionRepository;

  constructor(sessionRepo: SessionRepository) {
    this.sessionRepo = sessionRepo;
  }

  sweepAll(): SessionSweepResult {
    let expiredCount = 0;
    let inactiveCount = 0;
    let sweptDatabaseCount = 0;
    const failedTenantIds: number[] = [];

    try {
      runWithoutTenant(() => {
        expiredCount += this.sessionRepo.deleteExpiredSessions();
        inactiveCount += this.sessionRepo.deleteInactiveSessions();
      });
      sweptDatabaseCount += 1;
    } catch (error) {
      authLogger.error(
        { error },
        "session sweep failed for the platform database",
      );
    }

    const tenantIds = listTenantDatabaseIds();
    if (tenantIds) {
      for (const tenantId of tenantIds) {
        try {
          runWithTenant(tenantId, () => {
            expiredCount += this.sessionRepo.deleteExpiredSessions();
            inactiveCount += this.sessionRepo.deleteInactiveSessions();
          });
          sweptDatabaseCount += 1;
        } catch (error) {
          failedTenantIds.push(tenantId);
          authLogger.error(
            { error, tenantId },
            "session sweep failed for a tenant database",
          );
        }
      }
    }

    return { expiredCount, inactiveCount, sweptDatabaseCount, failedTenantIds };
  }
}

let instance: SessionSweepService | null = null;

export function getSessionSweepService(): SessionSweepService {
  if (!instance) {
    instance = new SessionSweepService(getSessionRepository());
  }
  return instance;
}

export function resetSessionSweepService(): void {
  instance = null;
}
