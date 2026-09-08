/**
 * Subscription Service — every policy question about a shop's standing.
 *
 * The repository does SQL; this decides what the rows MEAN (rule 13):
 * what a NULL allowlist implies, when a period has lapsed, what `read_only`
 * forbids, and which modules can never be gated.
 *
 * Owner decisions this implements (`SUBSCRIPTION_MANAGEMENT_PLAN.md` § 3):
 * per-tenant module allowlist rather than named tiers, no trial, manual
 * mark-paid, a 7-day grace that ends in `read_only` and NEVER in a lockout,
 * and desktop enforcement that FAILS OPEN.
 */

import {
  getSubscriptionRepository,
  type SubscriptionRepository,
  type SubscriptionEntity,
  type SubscriptionStatus,
} from "../repositories/SubscriptionRepository.js";
import { createChildLogger } from "../utils/logger.js";
import {
  GRACE_PERIOD_DAYS,
  UNGATEABLE_MODULES,
} from "../constants/subscription.js";

const log = createChildLogger({ module: "subscription" });

// =============================================================================
// Policy constants
// =============================================================================

// Re-exported so existing importers of the service keep working, but DEFINED
// in constants/subscription.ts — the frontend needs the same ungateable rule
// and cannot import this file (it pulls in the logger and the db).
export { GRACE_PERIOD_DAYS, UNGATEABLE_MODULES };

/**
 * The shape both transports report and both UIs render.
 *
 * `canWrite` is deliberately pre-computed rather than left to each caller to
 * derive from `status`: two callers deriving it independently is how one of
 * them ends up treating `grace` as read-only.
 */
export interface SubscriptionStatusView {
  status: SubscriptionStatus;
  plan: string;
  /** false ONLY in read_only. Grace is fully functional by design. */
  canWrite: boolean;
  currentPeriodEnd: string | null;
  graceEndsAt: string | null;
  /** null means every module — see `entitledModules` handling below. */
  entitledModules: string[] | null;
}

// =============================================================================
// Service
// =============================================================================

export class SubscriptionService {
  private repo: SubscriptionRepository;
  /** Injected so the lapse job is testable without waiting seven days (DIP). */
  private now: () => Date;

  constructor(repo?: SubscriptionRepository, now?: () => Date) {
    this.repo = repo ?? getSubscriptionRepository();
    this.now = now ?? (() => new Date());
  }

  /**
   * Parse the stored allowlist.
   *
   * Returns null for "every module" in THREE cases, and the third is the
   * important one: NULL (never restricted), a non-array JSON value, and
   * malformed JSON. A corrupt column must not silently strip a paying shop of
   * its modules, so this fails OPEN — consistent with the desktop decision,
   * and the same reasoning: the failure mode that costs a customer money is
   * worse than the one that costs a licence fee.
   */
  private parseModules(raw: string | null): string[] | null {
    if (raw === null || raw.trim() === "") return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        log.warn({ raw }, "entitled_modules is not an array; treating as ALL");
        return null;
      }
      return parsed.filter((m): m is string => typeof m === "string");
    } catch (error) {
      log.error(
        { error, raw },
        "entitled_modules is not valid JSON; treating as ALL",
      );
      return null;
    }
  }

  /** The view for one tenant, or null when it has no subscription row. */
  statusFor(tenantId: number): SubscriptionStatusView | null {
    const row = this.repo.getByTenantId(tenantId);
    return row ? this.toView(row) : null;
  }

  /** The view for a desktop install, resolved from its licence key. */
  statusForLicenseKey(
    key: string,
  ): (SubscriptionStatusView & { tenantId: number }) | null {
    const row = this.repo.getByLicenseKey(key);
    if (!row) return null;
    return { ...this.toView(row), tenantId: row.tenant_id };
  }

  private toView(row: SubscriptionEntity): SubscriptionStatusView {
    return {
      status: row.status,
      plan: row.plan,
      canWrite: row.status !== "read_only",
      currentPeriodEnd: row.current_period_end,
      graceEndsAt: row.grace_ends_at,
      entitledModules: this.parseModules(row.entitled_modules),
    };
  }

  /**
   * Is this module allowed for this tenant?
   *
   * NOT the same question as "is it enabled" — that is the tenant's own
   * choice, in the `modules` table their admin controls. What a shop actually
   * gets is the intersection, and this side is the half they cannot edit.
   *
   * Absent subscription => allowed. A tenant with no row predates this
   * feature or was created outside provisioning; taking modules away from
   * someone because a control-plane row is missing is the wrong default.
   */
  isModuleEntitled(tenantId: number, moduleKey: string): boolean {
    if (UNGATEABLE_MODULES.includes(moduleKey)) return true;
    const view = this.statusFor(tenantId);
    if (!view || view.entitledModules === null) return true;
    return view.entitledModules.includes(moduleKey);
  }

  /**
   * May this tenant write at all?
   *
   * Absent subscription => yes, same reasoning as above: this is what
   * grandfathers every install that existed before v173.
   */
  canWrite(tenantId: number): boolean {
    const view = this.statusFor(tenantId);
    return view ? view.canWrite : true;
  }

  // ---------------------------------------------------------------------------
  // Control plane (manual collection — D3)
  // ---------------------------------------------------------------------------

  /**
   * Record a payment: back to `active`, period extended, grace cleared.
   *
   * Clearing `grace_ends_at` matters. A shop that lapsed, paid, and later
   * lapsed again would otherwise inherit the OLD grace deadline — already in
   * the past — and skip straight to read-only on its second lapse.
   */
  markPaid(tenantId: number, periodEnd: string | null): SubscriptionEntity {
    const updated = this.repo.update(tenantId, {
      status: "active",
      current_period_end: periodEnd,
      grace_ends_at: null,
    });
    if (!updated) {
      throw new Error(`No subscription for tenant ${tenantId}`);
    }
    log.info({ tenantId, periodEnd }, "subscription marked paid");
    return updated;
  }

  /** Replace the module allowlist. `null` restores "every module". */
  setEntitledModules(
    tenantId: number,
    modules: string[] | null,
  ): SubscriptionEntity {
    const updated = this.repo.update(tenantId, {
      entitled_modules: modules === null ? null : JSON.stringify(modules),
    });
    if (!updated) {
      throw new Error(`No subscription for tenant ${tenantId}`);
    }
    log.info({ tenantId, modules }, "entitled modules updated");
    return updated;
  }

  /**
   * Attach (or clear) the desktop licence key.
   *
   * Until a key is set, that install has no identity and therefore no
   * enforcement — which is exactly how existing desktop customers keep
   * working after the update.
   */
  setLicenseKey(tenantId: number, key: string | null): SubscriptionEntity {
    const updated = this.repo.update(tenantId, { license_key: key });
    if (!updated) {
      throw new Error(`No subscription for tenant ${tenantId}`);
    }
    log.info({ tenantId, hasKey: key !== null }, "licence key updated");
    return updated;
  }

  listAll() {
    return this.repo.listAll();
  }

  // ---------------------------------------------------------------------------
  // The lapse sweep
  // ---------------------------------------------------------------------------

  /**
   * Move expired subscriptions along one step: `active` -> `grace` when the
   * paid period ends, `grace` -> `read_only` when grace ends.
   *
   * IDEMPOTENT. Each transition is selected by the status it is leaving, so a
   * row already moved is not selected again — running this twice equals
   * running it once, which matters because it will be driven by a timer that
   * can fire twice on a clock change or a restart.
   *
   * A row only ever advances ONE step per sweep. A tenant whose period and
   * (stale) grace deadline are both in the past becomes `grace` now and
   * `read_only` on the next run, so it always gets a grace window it can
   * actually notice — never a same-instant jump to read-only.
   */
  runLapseSweep(): { toGrace: number[]; toReadOnly: number[] } {
    const now = this.now();
    const { toGrace, toReadOnly } = this.repo.findLapsed(toIso(now));

    const graceEnds = toIso(addDays(now, GRACE_PERIOD_DAYS));

    for (const row of toGrace) {
      this.repo.update(row.tenant_id, {
        status: "grace",
        grace_ends_at: graceEnds,
      });
    }
    for (const row of toReadOnly) {
      this.repo.update(row.tenant_id, { status: "read_only" });
    }

    const result = {
      toGrace: toGrace.map((r) => r.tenant_id),
      toReadOnly: toReadOnly.map((r) => r.tenant_id),
    };
    if (result.toGrace.length || result.toReadOnly.length) {
      log.info(result, "lapse sweep moved subscriptions");
    }
    return result;
  }
}

// =============================================================================
// Date helpers — kept local; the service owns its clock (DIP)
// =============================================================================

function addDays(d: Date, days: number): Date {
  const out = new Date(d.getTime());
  out.setDate(out.getDate() + days);
  return out;
}

/**
 * `YYYY-MM-DD HH:MM:SS` in UTC — the same shape SQLite's
 * `CURRENT_TIMESTAMP` writes, so string comparison in `findLapsed` orders
 * correctly against rows written by the database itself.
 */
function toIso(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

// =============================================================================
// Singleton
// =============================================================================

let instance: SubscriptionService | null = null;

export function getSubscriptionService(): SubscriptionService {
  if (!instance) {
    instance = new SubscriptionService();
  }
  return instance;
}

export function resetSubscriptionService(): void {
  instance = null;
}
