/**
 * Tenant Provisioning Service — control plane (plan §5, WP5).
 *
 * Business-logic layer over `TenantRepository`: validates the incoming
 * request (slug shape/reserved list, duplicate slug, duplicate username,
 * password complexity), then delegates the ATOMIC create-tenant +
 * seed-config + create-tenant-admin sequence to
 * `TenantRepository.runInTransaction()` — this service never touches the
 * database itself (CLAUDE.md rule 13); every statement lives in
 * `TenantRepository` or `UserRepository`.
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
import {
  SharedTenantStorageProvisioner,
  getTenantStorageProvisionerOverride,
  type TenantStorageProvisioner,
} from "./TenantStorageProvisioner.js";
import { hashPassword, validatePasswordComplexity } from "../utils/crypto.js";
import {
  ValidationError,
  ConflictError,
  BusinessRuleError,
} from "../utils/errors.js";

import { assertValidTenantSlug } from "../utils/tenantSlug.js";
import { tenantLogger } from "../utils/logger.js";

/**
 * Tenant 1 is the seeded tenant: every desktop install runs as it, and on
 * a web deployment it is the original shop. Nothing may delete it.
 */
const PROTECTED_TENANT_ID = 1;

// =============================================================================
// Types
// =============================================================================

export interface ProvisionTenantData {
  name: string;
  slug: string;
  contactName?: string | null;
  contactPhone?: string | null;
  notes?: string | null;
  /**
   * LIRA-267: the shop's contact email. Normalised (trimmed + lowercased)
   * HERE, not only in the zod schema, because the invite-token path takes
   * it from the invite row and never passes through `createTenantSchema`.
   * A duplicate throws `EmailAlreadyHasShopError` (code
   * `EMAIL_ALREADY_HAS_SHOP`).
   */
  contactEmail?: string | null;
  adminUsername: string;
  adminPassword: string;
}

// =============================================================================
// Service
// =============================================================================

export class TenantProvisioningService {
  private tenantRepo: TenantRepository;
  private userRepo: UserRepository;
  private subscriptionRepo: SubscriptionRepository;
  private storageProvisioner: TenantStorageProvisioner;

  /**
   * `storageProvisioner` resolution order:
   *
   *   1. explicitly passed in (tests that want to exercise a specific port
   *      implementation, or a future caller with its own needs);
   *   2. the process-wide override installed via `setTenantStorageProvisioner`
   *      — only ever set by the backend, only in per-tenant mode;
   *   3. a `SharedTenantStorageProvisioner` built from THIS service's own
   *      `tenantRepo`/`userRepo`/`subscriptionRepo` (not fresh global
   *      singletons) — so a caller that injects its own repos (every
   *      existing test) gets byte-identical behaviour to before this port
   *      existed, without needing to know the port exists at all.
   */
  constructor(
    tenantRepo?: TenantRepository,
    userRepo?: UserRepository,
    subscriptionRepo?: SubscriptionRepository,
    storageProvisioner?: TenantStorageProvisioner,
  ) {
    this.tenantRepo = tenantRepo ?? getTenantRepository();
    this.userRepo = userRepo ?? getUserRepository();
    this.subscriptionRepo = subscriptionRepo ?? getSubscriptionRepository();
    this.storageProvisioner =
      storageProvisioner ??
      getTenantStorageProvisionerOverride() ??
      new SharedTenantStorageProvisioner(
        this.tenantRepo,
        this.userRepo,
        this.subscriptionRepo,
      );
  }

  /**
   * Provision a brand-new tenant: registry row + full per-tenant config seed
   * + tenant-admin user, all in ONE transaction (roll back together if any
   * step fails — most notably if the admin user creation fails after the
   * tenant row and config seed already ran).
   */
  provisionTenant(data: ProvisionTenantData): TenantEntity {
    try {
      const name = data.name?.trim();
      const slug = data.slug?.trim();
      const adminUsername = data.adminUsername?.trim();

      if (!name) {
        throw new ValidationError("Tenant name is required");
      }
      if (!slug) {
        throw new ValidationError("Tenant slug is required");
      }
      if (!adminUsername) {
        throw new ValidationError("Admin username is required");
      }
      if (adminUsername.length < 3) {
        throw new ValidationError(
          "Admin username must be at least 3 characters",
        );
      }

      // Defense in depth: `createTenantSchema` (Zod, admin.ts's POST
      // /tenants) already validates the slug at the HTTP boundary. Re-check
      // here so this service stays safe to call from anywhere else (a
      // future CLI/seed script, a test) without depending on that layer.
      assertValidTenantSlug(slug);

      if (this.tenantRepo.existsBySlug(slug)) {
        throw new ConflictError(`Tenant slug '${slug}' is already taken`);
      }
      // No username check here any more, deliberately. Since v172 usernames
      // are unique per tenant, and this provisions a BRAND NEW tenant whose
      // user set is empty -- so no collision is possible. The old global check
      // was the actual bug: it rejected the second shop that wanted an 'admin',
      // naming a conflict in a tenant the caller cannot see.

      const passwordCheck = validatePasswordComplexity(data.adminPassword);
      if (!passwordCheck.valid) {
        throw new ValidationError(passwordCheck.errors.join(", "));
      }
      const passwordHash = hashPassword(data.adminPassword);

      // Delegated to the injected port (TenantStorageProvisioner):
      // shared-file mode does today's one-transaction commit (tenant row +
      // config seed + admin user + subscription row, rolled back together —
      // a tenant that exists with no subscription is a tenant whose
      // standing has to be GUESSED, and the guess is load-bearing, so a
      // half-provisioned shop would silently be unlimited); per-tenant mode
      // builds a brand-new database file this service never needs to know
      // exists. Either way the result is active, with a NULL period end and
      // NULL entitled_modules for every module: no trial, and no plan
      // restriction until the owner sets one
      // (SUBSCRIPTION_MANAGEMENT_PLAN.md D2/D6).
      const tenant = this.storageProvisioner.createTenant({
        name,
        slug,
        contactName: data.contactName?.trim() || null,
        contactPhone: data.contactPhone?.trim() || null,
        notes: data.notes?.trim() || null,
        contactEmail: data.contactEmail?.trim().toLowerCase() || null,
        adminUsername,
        passwordHash,
      });

      tenantLogger.info(
        { tenantId: tenant.id, slug: tenant.slug, adminUsername },
        "Tenant provisioned",
      );
      return tenant;
    } catch (error) {
      tenantLogger.error({ error, slug: data.slug }, "provisionTenant failed");
      throw error;
    }
  }

  /**
   * Permanently delete a tenant and everything it owns.
   *
   * Three guards, each for a failure that actually happens:
   *
   *   1. `confirmSlug` must match. The id in a URL is easy to get wrong
   *      by one; a slug typed by a human is not. Enforced SERVER-side, so
   *      a confirmation dialog is a courtesy rather than the protection.
   *   2. Tenant 1 can never be deleted. It is the seeded tenant every
   *      desktop install runs as, and on a web deployment it is the
   *      original shop -- the one whose loss would be unrecoverable.
   *   3. The tenant must exist, checked before anything is removed.
   *
   * There is no soft delete and no undo. `suspended` already exists for
   * 'stop them logging in but keep the data'; this is for the other case,
   * and pretending otherwise would just leave data nobody can see.
   */
  deleteTenant(
    tenantId: number,
    confirmSlug: string,
  ): { tablesCleared: number; rowsDeleted: number } {
    if (tenantId === PROTECTED_TENANT_ID) {
      throw new BusinessRuleError("The default tenant cannot be deleted");
    }

    const tenant = this.tenantRepo.getById(tenantId);
    if (!tenant) {
      throw new ValidationError(`No tenant with id ${tenantId}`);
    }

    if (confirmSlug !== tenant.slug) {
      throw new ValidationError(
        `Confirmation does not match: expected the slug "${tenant.slug}"`,
      );
    }

    // Delegated to the injected port: shared-file mode does today's
    // in-place cascade; per-tenant mode archives the tenant's own database
    // file (B-D4) and only removes the platform rows once that archive has
    // actually succeeded — see TenantStorageProvisioner.deleteTenant's doc
    // comment for the ordering guarantee.
    const result = this.storageProvisioner.deleteTenant(tenant);
    tenantLogger.warn(
      { tenantId, slug: tenant.slug, ...result },
      "Tenant permanently deleted",
    );
    return result;
  }

  /**
   * Change a tenant's public slug.
   *
   * Same charset and reserved-name rules as creation -- a rename must not
   * be able to claim `admin` or `www` when a signup cannot.
   *
   * The caller is responsible for the CONSEQUENCES: the old subdomain
   * stops matching and a new one has to be provisioned. This method only
   * moves the registry entry, because the DNS side is deployment
   * infrastructure and core knows nothing about it.
   */
  changeTenantSlug(tenantId: number, nextSlug: string): TenantEntity {
    const slug = nextSlug.trim().toLowerCase();
    assertValidTenantSlug(slug);

    const tenant = this.tenantRepo.getById(tenantId);
    if (!tenant) {
      throw new ValidationError(`No tenant with id ${tenantId}`);
    }
    if (tenant.slug === slug) return tenant;

    if (this.tenantRepo.existsBySlug(slug)) {
      throw new ConflictError(`Tenant slug '${slug}' is already taken`);
    }

    const updated = this.tenantRepo.updateSlug(tenantId, slug);
    if (!updated) {
      throw new ValidationError("Slug change did not apply");
    }
    tenantLogger.info(
      { tenantId, from: tenant.slug, to: slug },
      "Tenant slug changed",
    );
    return updated;
  }
}
// =============================================================================
// Singleton
// =============================================================================

let instance: TenantProvisioningService | null = null;

export function getTenantProvisioningService(): TenantProvisioningService {
  if (!instance) {
    instance = new TenantProvisioningService();
  }
  return instance;
}

export function resetTenantProvisioningService(): void {
  instance = null;
}
