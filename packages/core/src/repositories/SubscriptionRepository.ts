/**
 * Subscription Repository — control plane.
 *
 * Like `TenantRepository`, this deliberately does NOT extend
 * `BaseRepository`. `tenant_subscriptions` is control-plane data keyed BY
 * tenant, and every method here is reached before or outside a tenant
 * context: the write-block middleware runs on requests whose tenant is only
 * known from the JWT, the desktop check is keyed by a license key with no
 * tenant at all, and the lapse job sweeps every tenant at once. So the
 * `tenant_id` predicate is always an explicit PARAMETER, never ambient.
 *
 * `scripts/check-tenant-scoping.mjs`: every statement below either carries a
 * literal `tenant_id = ?` or is a deliberate cross-tenant sweep marked with a
 * `tenant-exempt` comment, matching how `TenantRepository` is treated.
 *
 * SQL only. Every policy question — what a lapse means, when grace ends, what
 * a NULL allowlist implies — belongs to `SubscriptionService` (rule 13).
 */

import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";
import { DatabaseError } from "../utils/errors.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Where a subscription sits in its lifecycle.
 *
 * There is no `suspended`: never hard-locking is an owner decision, and
 * suspension for abuse is `tenants.status`, which gates login itself. These
 * three only ever decide what a shop may DO once it is already in.
 */
export type SubscriptionStatus = "active" | "grace" | "read_only";

export interface SubscriptionEntity {
  id: number;
  tenant_id: number;
  plan: string;
  status: SubscriptionStatus;
  current_period_end: string | null;
  grace_ends_at: string | null;
  license_key: string | null;
  /** RAW JSON text, or null for "every module". Parsed by the service. */
  entitled_modules: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpdateSubscriptionData {
  plan?: string;
  status?: SubscriptionStatus;
  current_period_end?: string | null;
  grace_ends_at?: string | null;
  license_key?: string | null;
  entitled_modules?: string | null;
  notes?: string | null;
}

// =============================================================================
// Repository
// =============================================================================

export class SubscriptionRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  private static readonly COLUMNS = `
    id, tenant_id, plan, status, current_period_end, grace_ends_at,
    license_key, entitled_modules, notes, created_at, updated_at
  `;

  getByTenantId(tenantId: number): SubscriptionEntity | null {
    try {
      const row = this.db
        .prepare(
          `SELECT ${SubscriptionRepository.COLUMNS}
             FROM tenant_subscriptions WHERE tenant_id = ?`,
        )
        .get(tenantId) as SubscriptionEntity | undefined;
      return row ?? null;
    } catch (error) {
      throw new DatabaseError("Failed to load subscription", {
        cause: error,
        entityId: tenantId,
      });
    }
  }

  /**
   * Resolve a subscription from a desktop license key.
   *
   * Deliberately global by construction: the key IS the identity, so there is
   * no tenant to scope to until this returns. `idx_tenant_subscriptions_key`
   * is UNIQUE, so at most one row can match.
   */
  getByLicenseKey(key: string): SubscriptionEntity | null {
    try {
      const row = this.db
        .prepare(
          `SELECT ${SubscriptionRepository.COLUMNS}
             FROM tenant_subscriptions
             /* tenant-exempt: the license key is the identity — no tenant
                context exists until this lookup resolves one */
            WHERE license_key = ?`,
        )
        .get(key) as SubscriptionEntity | undefined;
      return row ?? null;
    } catch (error) {
      throw new DatabaseError("Failed to load subscription by license key", {
        cause: error,
      });
    }
  }

  /**
   * Create the row for a tenant, or do nothing if one already exists.
   *
   * Idempotent on purpose: this is called from inside `provisionTenant()`'s
   * transaction, and a retried provisioning must not fail on the unique index
   * after the tenant row itself succeeded.
   */
  createForTenant(
    tenantId: number,
    data: UpdateSubscriptionData = {},
  ): SubscriptionEntity {
    try {
      this.db
        .prepare(
          `INSERT INTO tenant_subscriptions
             (tenant_id, plan, status, current_period_end, grace_ends_at,
              license_key, entitled_modules, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(tenant_id) DO NOTHING`,
        )
        .run(
          tenantId,
          data.plan ?? "standard",
          data.status ?? "active",
          data.current_period_end ?? null,
          data.grace_ends_at ?? null,
          data.license_key ?? null,
          data.entitled_modules ?? null,
          data.notes ?? null,
        );

      const row = this.getByTenantId(tenantId);
      if (!row) {
        // Neither inserted nor found: the caller would otherwise carry on with
        // a tenant that has no commercial state and no error to explain it.
        throw new DatabaseError(
          "Subscription row missing immediately after insert",
          { entityId: tenantId },
        );
      }
      return row;
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError("Failed to create subscription", {
        cause: error,
        entityId: tenantId,
      });
    }
  }

  /**
   * Patch a subscription. Only the keys PRESENT in `data` are written, so a
   * caller changing `status` cannot accidentally blank `entitled_modules` --
   * which, given NULL means "every module", would silently hand a shop the
   * whole app.
   */
  update(
    tenantId: number,
    data: UpdateSubscriptionData,
  ): SubscriptionEntity | null {
    const sets: string[] = [];
    const params: unknown[] = [];

    const assign = (column: string, value: unknown) => {
      sets.push(`${column} = ?`);
      params.push(value);
    };

    if (data.plan !== undefined) assign("plan", data.plan);
    if (data.status !== undefined) assign("status", data.status);
    if (data.current_period_end !== undefined)
      assign("current_period_end", data.current_period_end);
    if (data.grace_ends_at !== undefined)
      assign("grace_ends_at", data.grace_ends_at);
    if (data.license_key !== undefined) assign("license_key", data.license_key);
    if (data.entitled_modules !== undefined)
      assign("entitled_modules", data.entitled_modules);
    if (data.notes !== undefined) assign("notes", data.notes);

    if (sets.length === 0) return this.getByTenantId(tenantId);

    try {
      this.db
        .prepare(
          `UPDATE tenant_subscriptions
              SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP
            WHERE tenant_id = ?`,
        )
        .run(...params, tenantId);
      return this.getByTenantId(tenantId);
    } catch (error) {
      throw new DatabaseError("Failed to update subscription", {
        cause: error,
        entityId: tenantId,
      });
    }
  }

  /**
   * Every subscription, for the control-plane list and the lapse sweep.
   *
   * Joined to `tenants` for the name/slug so the admin screen does not fan out
   * one query per row.
   */
  listAll(): (SubscriptionEntity & {
    tenant_name: string;
    tenant_slug: string;
  })[] {
    try {
      return this.db
        .prepare(
          `SELECT s.id, s.tenant_id, s.plan, s.status, s.current_period_end,
                  s.grace_ends_at, s.license_key, s.entitled_modules, s.notes,
                  s.created_at, s.updated_at,
                  t.name AS tenant_name, t.slug AS tenant_slug
             FROM tenant_subscriptions s
             /* tenant-exempt: control-plane sweep across every tenant */
             JOIN tenants t ON t.id = s.tenant_id
            ORDER BY t.name COLLATE NOCASE`,
        )
        .all() as (SubscriptionEntity & {
        tenant_name: string;
        tenant_slug: string;
      })[];
    } catch (error) {
      throw new DatabaseError("Failed to list subscriptions", { cause: error });
    }
  }

  /**
   * Subscriptions whose period has run out but that are still `active`, and
   * ones whose grace has run out but that are still `grace`.
   *
   * The date comparison is SQL-side so the sweep does not load every row, but
   * the BOUNDARY is passed in rather than using `datetime('now')`: the service
   * owns the clock, which is what makes the lapse job testable without
   * waiting seven days.
   */
  findLapsed(nowIso: string): {
    toGrace: SubscriptionEntity[];
    toReadOnly: SubscriptionEntity[];
  } {
    try {
      const select = (where: string) =>
        this.db
          .prepare(
            `SELECT ${SubscriptionRepository.COLUMNS}
               FROM tenant_subscriptions
               /* tenant-exempt: control-plane sweep across every tenant */
              WHERE ${where}`,
          )
          .all(nowIso) as SubscriptionEntity[];

      return {
        toGrace: select(
          `status = 'active'
             AND current_period_end IS NOT NULL
             AND current_period_end <= ?`,
        ),
        toReadOnly: select(
          `status = 'grace'
             AND grace_ends_at IS NOT NULL
             AND grace_ends_at <= ?`,
        ),
      };
    } catch (error) {
      throw new DatabaseError("Failed to find lapsed subscriptions", {
        cause: error,
      });
    }
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: SubscriptionRepository | null = null;

export function getSubscriptionRepository(): SubscriptionRepository {
  if (!instance) {
    instance = new SubscriptionRepository(getDatabase());
  }
  return instance;
}

export function resetSubscriptionRepository(): void {
  instance = null;
}
