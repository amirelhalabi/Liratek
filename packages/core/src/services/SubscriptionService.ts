/**
 * Subscription Service — every policy question about a shop's standing.
 *
 * The repository does SQL; this decides what the rows MEAN (rule 13):
 * what a NULL allowlist implies, when a period has lapsed, what `read_only`
 * forbids, and which modules can never be gated.
 *
 * Owner decisions this implements (`SUBSCRIPTION_MANAGEMENT_PLAN.md` § 3):
 * per-tenant module allowlist rather than named tiers, manual mark-paid, a
 * 7-day grace that ends in `read_only` and NEVER in a lockout, and desktop
 * enforcement that FAILS OPEN.
 *
 * LIRA-332 supersedes D2 ("no trial") for publicly signed-up shops: a
 * 14-day free trial, stored as `trial_ends_at` and derived LIVE into the
 * `trial` / `trial_ended` standings here (research R1/R2/R5). An ended trial
 * gets no grace and creates no records, but loses nothing.
 */

import {
  getSubscriptionRepository,
  type SubscriptionRepository,
  type SubscriptionEntity,
  type SubscriptionStatus,
} from "../repositories/SubscriptionRepository.js";
import { createChildLogger } from "../utils/logger.js";
import {
  endOfShopDay,
  parseUtcInstant,
  toUtcSqlTimestamp,
  trialView,
  type TrialView,
} from "../utils/trialCalendar.js";
import { NotFoundError, ValidationError } from "../utils/errors.js";

/** LIRA-332: refusal texts of the owner's trial actions (contracts §4). */
export const SUBSCRIPTION_DATE_IN_PAST_MESSAGE = "Choose a date in the future";
export const EXTEND_TRIAL_PAYING_SHOP_MESSAGE =
  "This shop pays; use Activate subscription";

/** Before/after views of one owner action, for its audit row (FR-022). */
export interface SubscriptionChange {
  before: SubscriptionStatusView;
  after: SubscriptionStatusView;
}
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
/**
 * LIRA-332: what a shop's standing MEANS, derived once (data-model
 * "Derived: standing"). `status` is still the stored column, which stays
 * `active` for the whole trial; every consumer branches on this instead.
 */
export type SubscriptionStanding = "trial" | "trial_ended" | SubscriptionStatus;

export interface SubscriptionStatusView {
  /** The stored column ('active' throughout a trial, ended or not). */
  status: SubscriptionStatus;
  /** LIRA-332: the derived standing every screen and gate reads. */
  standing: SubscriptionStanding;
  plan: string;
  /**
   * false in read_only and (LIRA-332) trial_ended. Grace is fully functional
   * by design.
   */
  canWrite: boolean;
  currentPeriodEnd: string | null;
  graceEndsAt: string | null;
  /** null means every module — see `entitledModules` handling below. */
  entitledModules: string[] | null;
  /** LIRA-332: null unless standing is `trial` or `trial_ended`. */
  trial: TrialView | null;
}

/**
 * LIRA-332 (FR-021): what the DESKTOP licence channel (`/by-key`) reports.
 *
 * The desktop has no sign-up and is never on a trial, and `licenseSync`
 * stores only the paid columns. So this channel keeps exactly its pre-trial
 * shape: no `standing`/`trial`, and `canWrite` from the PAID reading (a
 * trial tenant's `status` is `active` throughout), never false because a
 * web trial ended.
 */
export interface DesktopSubscriptionView {
  status: SubscriptionStatus;
  plan: string;
  canWrite: boolean;
  currentPeriodEnd: string | null;
  graceEndsAt: string | null;
  entitledModules: string[] | null;
}

export function toDesktopView(
  view: SubscriptionStatusView,
): DesktopSubscriptionView {
  return {
    status: view.status,
    plan: view.plan,
    canWrite: view.status !== "read_only",
    currentPeriodEnd: view.currentPeriodEnd,
    graceEndsAt: view.graceEndsAt,
    entitledModules: view.entitledModules,
  };
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

  /**
   * LIRA-332: the trial view of a row, or null when it is not on a trial.
   *
   * Invariant (enforced by this service, never by callers): a row with
   * `trial_ends_at` is `active` with no period and no grace. A row that
   * breaks it (hand-edited) is read by its PAID columns, so a paying shop is
   * never told "trial ended" (SC-006). Logged as a warning.
   */
  private trialOf(row: SubscriptionEntity): TrialView | null {
    if (!row.trial_ends_at) return null;
    if (
      row.status !== "active" ||
      row.current_period_end !== null ||
      row.grace_ends_at !== null
    ) {
      log.warn(
        { tenantId: row.tenant_id, status: row.status },
        "trial_ends_at set on a paying row; reading the paid columns",
      );
      return null;
    }
    const endsAt = parseUtcInstant(row.trial_ends_at);
    if (Number.isNaN(endsAt.getTime())) {
      log.warn(
        { tenantId: row.tenant_id, trialEndsAt: row.trial_ends_at },
        "trial_ends_at is not a date; treating the shop as not on a trial",
      );
      return null;
    }
    return trialView(endsAt, this.now());
  }

  private toView(row: SubscriptionEntity): SubscriptionStatusView {
    const trial = this.trialOf(row);
    const standing: SubscriptionStanding = trial
      ? trial.ended
        ? "trial_ended"
        : "trial"
      : row.status;
    return {
      status: row.status,
      standing,
      plan: row.plan,
      canWrite: standing !== "read_only" && standing !== "trial_ended",
      currentPeriodEnd: row.current_period_end,
      graceEndsAt: row.grace_ends_at,
      entitledModules: this.parseModules(row.entitled_modules),
      trial,
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
   *
   * LIRA-332: it also clears the trial, so recording a payment on a trial
   * shop can never leave it reading as trial-ended.
   */
  markPaid(tenantId: number, periodEnd: string | null): SubscriptionEntity {
    const updated = this.repo.update(tenantId, {
      status: "active",
      current_period_end: periodEnd,
      grace_ends_at: null,
      trial_started_at: null,
      trial_ends_at: null,
    });
    if (!updated) {
      throw new Error(`No subscription for tenant ${tenantId}`);
    }
    log.info({ tenantId, periodEnd }, "subscription marked paid");
    return updated;
  }

  // ---------------------------------------------------------------------------
  // LIRA-332: the owner's trial actions (data-model "State transitions").
  // Separate from Suspend: neither reads nor writes `tenants.status` (FR-016).
  // Days are shop days (Asia/Beirut); "over" is decided against this
  // service's clock, never the client's.
  // ---------------------------------------------------------------------------

  /**
   * "Activate subscription": the shop pays from now on. Open-ended
   * (`until = null`) or paid until the END of a shop day, stored as that
   * exact instant so the lapse sweep moves it at 00:00 Beirut, not 00:00 UTC.
   * One update: back to `active`, grace and trial cleared.
   */
  activate(tenantId: number, until: string | null): SubscriptionChange {
    const before = this.requireView(tenantId);
    let periodEnd: string | null = null;
    if (until !== null) {
      const end = endOfShopDay(until);
      if (end.getTime() <= this.now().getTime()) {
        throw new ValidationError(SUBSCRIPTION_DATE_IN_PAST_MESSAGE);
      }
      periodEnd = toUtcSqlTimestamp(end);
    }
    this.repo.update(tenantId, {
      status: "active",
      current_period_end: periodEnd,
      grace_ends_at: null,
      trial_started_at: null,
      trial_ends_at: null,
    });
    const after = this.requireView(tenantId);
    log.info({ tenantId, until }, "subscription activated");
    return { before, after };
  }

  /**
   * "Extend trial": the trial's new last day. Allowed on a trial (running or
   * ended) and on an active shop with no paid period (an owner-created shop
   * can be put on a trial). Refused for a paying shop (grace, read-only, or
   * a paid period) and for a day already over.
   */
  extendTrial(tenantId: number, lastDay: string): SubscriptionChange {
    const before = this.requireView(tenantId);
    const row = this.repo.getByTenantId(tenantId);
    if (!row) throw new NotFoundError("Subscription for tenant", tenantId);
    const onTrial = before.standing === "trial" || before.standing === "trial_ended";
    const freeNoPeriod =
      row.status === "active" &&
      row.current_period_end === null &&
      row.grace_ends_at === null;
    if (!onTrial && !freeNoPeriod) {
      throw new ValidationError(EXTEND_TRIAL_PAYING_SHOP_MESSAGE);
    }
    const end = endOfShopDay(lastDay);
    const now = this.now();
    if (end.getTime() <= now.getTime()) {
      throw new ValidationError(SUBSCRIPTION_DATE_IN_PAST_MESSAGE);
    }
    this.repo.update(tenantId, {
      trial_ends_at: toUtcSqlTimestamp(end),
      ...(row.trial_started_at
        ? {}
        : { trial_started_at: toUtcSqlTimestamp(now) }),
    });
    const after = this.requireView(tenantId);
    log.info({ tenantId, lastDay }, "trial extended");
    return { before, after };
  }

  private requireView(tenantId: number): SubscriptionStatusView {
    const view = this.statusFor(tenantId);
    if (!view) throw new NotFoundError("Subscription for tenant", tenantId);
    return view;
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

  /**
   * Every shop's row for the owner's list, each with its derived `standing`
   * and `trial` view (LIRA-332, FR-015) — computed HERE, the same derivation
   * the shop's own status route uses, so the two screens agree (rule 14,
   * US4-4).
   */
  listAll() {
    return this.repo.listAll().map((row) => {
      const view = this.toView(row);
      return { ...row, standing: view.standing, trial: view.trial };
    });
  }

  /** Module keys the owner can put on a plan. */
  listSellableModules(): string[] {
    return this.repo.listSellableModuleKeys();
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
