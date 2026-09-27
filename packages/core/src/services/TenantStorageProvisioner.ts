/**
 * Tenant storage provisioning port (Phase C, `docs/plans/ongoing_plans/
 * PRODUCTION_DATABASE_AND_HOSTING_PLAN.md` § 12.2/12.3).
 *
 * `TenantProvisioningService.provisionTenant()`/`.deleteTenant()` used to
 * BE this: one `db.transaction()` on the single shared file, both directions.
 * That shape cannot survive per-tenant mode — a shop's config seed + first
 * admin user, and its eventual deletion, live in a COMPLETELY SEPARATE
 * SQLite file/connection that no platform transaction can span. Rather than
 * branch on mode inside the service (SRP/rule 13: policy stays out of a
 * single monolith), the whole "commit a tenant into existence" / "make a
 * tenant's storage go away" sequence is this injected port:
 *
 *   - `SharedTenantStorageProvisioner` (default, below) is today's exact
 *     behaviour, byte-identical: one transaction, tenant row + config seed +
 *     admin user + subscription row, all in the SAME (only) database file.
 *     Desktop and shared-mode web never install an override, so this is
 *     always what they get.
 *   - The per-tenant implementation
 *     (`backend/src/database/perTenantStorageProvisioner.ts`) lives in the
 *     backend, since it needs `fs`/a real file path/the tenant connection
 *     pool — core has no opinion on any of that (dependency inversion). It
 *     is installed via `setTenantStorageProvisioner()` below, mirroring
 *     `setDatabaseResolver()`/`setTenantDatabaseIdLister()`'s "one override,
 *     installed once at boot in per-tenant mode only" shape.
 */

import {
  getTenantRepository,
  type TenantRepository,
  type TenantEntity,
} from "../repositories/TenantRepository.js";
import {
  getUserRepository,
  type UserRepository,
} from "../repositories/UserRepository.js";
import {
  getSubscriptionRepository,
  type SubscriptionRepository,
} from "../repositories/SubscriptionRepository.js";

// =============================================================================
// Types
// =============================================================================

export interface CreateTenantStorageInput {
  name: string;
  slug: string;
  contactName: string | null;
  contactPhone: string | null;
  notes: string | null;
  adminUsername: string;
  /** Already hashed — `TenantProvisioningService` owns password validation
   * and hashing; this port never sees a plaintext password. */
  passwordHash: string;
}

export interface TenantStorageDeleteResult {
  tablesCleared: number;
  rowsDeleted: number;
}

export interface TenantStorageProvisioner {
  /**
   * Commits a brand-new tenant into existence: the platform registry row(s)
   * AND that tenant's own config seed + first admin user, wherever that
   * tenant's requests will be routed. All-or-nothing — on ANY failure,
   * nothing observable may remain (no platform row, no orphaned file).
   * Returns the tenant `active` and ready to serve requests.
   */
  createTenant(input: CreateTenantStorageInput): TenantEntity;

  /**
   * Removes a tenant's own storage AND the platform registry rows for it.
   * All-or-nothing in the OTHER direction from `createTenant`'s ordering
   * concern: if the tenant's own storage cannot be removed/archived, the
   * platform rows MUST remain untouched (the caller has already validated
   * the delete is allowed and loaded `tenant`).
   */
  deleteTenant(tenant: TenantEntity): TenantStorageDeleteResult;
}

// =============================================================================
// Default (shared-file) implementation — today's behaviour, unchanged
// =============================================================================

/**
 * Shared-file mode default. Every desktop install and every web deployment
 * before `TENANT_DB_MODE=per-tenant` gets exactly this — reproduced from what
 * `TenantProvisioningService` used to do inline, moved here verbatim so the
 * service itself no longer has an opinion on WHERE a tenant's storage lives.
 */
export class SharedTenantStorageProvisioner implements TenantStorageProvisioner {
  private tenantRepo: TenantRepository;
  private userRepo: UserRepository;
  private subscriptionRepo: SubscriptionRepository;

  constructor(
    tenantRepo?: TenantRepository,
    userRepo?: UserRepository,
    subscriptionRepo?: SubscriptionRepository,
  ) {
    this.tenantRepo = tenantRepo ?? getTenantRepository();
    this.userRepo = userRepo ?? getUserRepository();
    this.subscriptionRepo = subscriptionRepo ?? getSubscriptionRepository();
  }

  createTenant(input: CreateTenantStorageInput): TenantEntity {
    return this.tenantRepo.runInTransaction(() => {
      const created = this.tenantRepo.create({
        name: input.name,
        slug: input.slug,
        contact_name: input.contactName,
        contact_phone: input.contactPhone,
        notes: input.notes,
      });

      // shop_name seeds from the tenant's own name — see
      // TenantRepository.seedConfig's doc comment for the one deliberate
      // deviation from a byte-literal create_db.sql copy.
      this.tenantRepo.seedConfig(created.id, input.name);

      this.userRepo.createUser({
        username: input.adminUsername,
        password_hash: input.passwordHash,
        role: "admin",
        is_active: 1,
        tenant_id: created.id,
      });

      // Commercial state, in the SAME transaction as the tenant row — see
      // the historical note this used to carry in TenantProvisioningService:
      // a tenant that exists with no subscription is a tenant whose
      // standing has to be GUESSED, and the guess is load-bearing
      // (absent means full access), so a half-provisioned shop would
      // silently be unlimited and unbilled. Rolling both back together is
      // the only state that cannot lie.
      this.subscriptionRepo.createForTenant(created.id, {
        plan: "standard",
        status: "active",
        current_period_end: null,
        entitled_modules: null,
      });

      return created;
    });
  }

  deleteTenant(tenant: TenantEntity): TenantStorageDeleteResult {
    return this.tenantRepo.deleteTenantCascade(tenant.id);
  }
}

// =============================================================================
// Override registry
// =============================================================================

let override: TenantStorageProvisioner | null = null;

/**
 * Installs (or, with `null`, clears) the process-wide tenant storage
 * provisioner override. Only `backend/src/database/connection.ts` calls
 * this, and only in `per-tenant` mode — mirrors `setDatabaseResolver`'s
 * shape exactly (§ 11.1) so the seams stay consistent. `null` restores
 * default (shared-file) behaviour.
 */
export function setTenantStorageProvisioner(
  provisioner: TenantStorageProvisioner | null,
): void {
  override = provisioner;
}

/**
 * The currently-installed override, or `null` if none (shared mode,
 * desktop, or a test that never called `setTenantStorageProvisioner`).
 * `TenantProvisioningService` reads this directly (rather than a
 * "getOrDefault" accessor) so that a caller which constructed its OWN
 * repositories for the default provisioner — as every existing test does —
 * keeps using exactly those instances instead of a default built from fresh
 * global singletons.
 */
export function getTenantStorageProvisionerOverride(): TenantStorageProvisioner | null {
  return override;
}

/** Test-only: clears the override. */
export function resetTenantStorageProvisioner(): void {
  override = null;
}
