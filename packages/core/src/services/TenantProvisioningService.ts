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
import { hashPassword, validatePasswordComplexity } from "../utils/crypto.js";
import { ValidationError, ConflictError } from "../utils/errors.js";
import { assertValidTenantSlug } from "../utils/tenantSlug.js";
import { tenantLogger } from "../utils/logger.js";

// =============================================================================
// Types
// =============================================================================

export interface ProvisionTenantData {
  name: string;
  slug: string;
  contactName?: string | null;
  contactPhone?: string | null;
  notes?: string | null;
  adminUsername: string;
  adminPassword: string;
}

// =============================================================================
// Service
// =============================================================================

export class TenantProvisioningService {
  private tenantRepo: TenantRepository;
  private userRepo: UserRepository;

  constructor(tenantRepo?: TenantRepository, userRepo?: UserRepository) {
    this.tenantRepo = tenantRepo ?? getTenantRepository();
    this.userRepo = userRepo ?? getUserRepository();
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
      if (this.userRepo.usernameExists(adminUsername)) {
        throw new ConflictError(`Username '${adminUsername}' already exists`);
      }

      const passwordCheck = validatePasswordComplexity(data.adminPassword);
      if (!passwordCheck.valid) {
        throw new ValidationError(passwordCheck.errors.join(", "));
      }
      const passwordHash = hashPassword(data.adminPassword);

      const tenant = this.tenantRepo.runInTransaction(() => {
        const created = this.tenantRepo.create({
          name,
          slug,
          contact_name: data.contactName?.trim() || null,
          contact_phone: data.contactPhone?.trim() || null,
          notes: data.notes?.trim() || null,
        });

        // shop_name seeds from the tenant's own name — see
        // TenantRepository.seedConfig's doc comment for the one deliberate
        // deviation from a byte-literal create_db.sql copy.
        this.tenantRepo.seedConfig(created.id, name);

        this.userRepo.createUser({
          username: adminUsername,
          password_hash: passwordHash,
          role: "admin",
          is_active: 1,
          tenant_id: created.id,
        });

        return created;
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
