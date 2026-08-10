/**
 * Service Provider Repository
 *
 * Handles all CRUD operations for the `service_providers` table — the
 * provider-taxonomy config table introduced by
 * FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5b, phases 1-2 ("do to
 * `provider` exactly what was already done to `payment_methods`").
 *
 * Mirrors `PaymentMethodRepository`/`payment_methods`
 * (create_db.sql:1309-1330) shape-for-shape: same columns pattern
 * (code/label/drawer_name/…/sort_order/is_active/is_system), same
 * tenant-scoping discipline (every query carries `tenant_id = ?`), same
 * seed-then-read split between phases.
 *
 * Phase 1 (this file's introduction): seeded with the 9 existing provider
 * codes, drawer names matching `FinancialServiceRepository.mapDrawerName`'s
 * hardcoded switch exactly. Nothing reads this table yet.
 *
 * Phase 2: `FinancialServiceRepository.mapDrawerName` reads `getByCode()`
 * with the pre-existing hardcoded switch kept as the offline/missing-row
 * fallback — same shape as `paymentMethodToDrawerName()` in
 * `utils/payments.ts` (try the repo; on a falsy/thrown result, fall through
 * to the literal map). See that method's own doc comment.
 *
 * Phase 3 (relax the `financial_services.provider` CHECK to an FK against
 * this table) and phase 4 (Partners UI + partner FK) are explicitly OUT of
 * scope here — see the plan.
 */

import { BaseRepository } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";

// =============================================================================
// Entity Types
// =============================================================================

export interface ServiceProviderEntity {
  id: number;
  tenant_id: number;
  code: string;
  label: string;
  drawer_name: string;
  /** 1 = OMT/WHISH — eligible for `partners.system_association` /
   *  Primary-Cash-Drawer routing (plan §5b); 0 = every other provider. */
  is_system_provider: number;
  is_active: number; // 0 or 1
  is_system: number; // 0 or 1 — cannot be deleted (the 9 built-in codes)
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CreateServiceProviderData {
  code: string;
  label: string;
  drawer_name: string;
  is_system_provider?: number;
  sort_order?: number;
}

export interface UpdateServiceProviderData {
  label?: string;
  drawer_name?: string;
  is_system_provider?: number;
  is_active?: number;
  sort_order?: number;
}

// =============================================================================
// Service Provider Repository Class
// =============================================================================

const COLUMNS =
  "id, tenant_id, code, label, drawer_name, is_system_provider, is_active, is_system, sort_order, created_at, updated_at";

export class ServiceProviderRepository extends BaseRepository<ServiceProviderEntity> {
  constructor() {
    super("service_providers", { softDelete: false });
  }

  // Override getColumns() to use explicit columns instead of SELECT *
  protected getColumns(): string {
    return COLUMNS;
  }

  /** Get all service providers ordered by sort_order */
  getAll(): ServiceProviderEntity[] {
    return this.db
      .prepare(
        `SELECT ${COLUMNS} FROM service_providers WHERE tenant_id = ? ORDER BY sort_order`,
      )
      .all(getCurrentTenantId()) as ServiceProviderEntity[];
  }

  /** Get only active service providers */
  getActive(): ServiceProviderEntity[] {
    return this.db
      .prepare(
        `SELECT ${COLUMNS} FROM service_providers WHERE is_active = 1 AND tenant_id = ? ORDER BY sort_order`,
      )
      .all(getCurrentTenantId()) as ServiceProviderEntity[];
  }

  /** Get a single service provider by code */
  getByCode(code: string): ServiceProviderEntity | undefined {
    return this.db
      .prepare(
        `SELECT ${COLUMNS} FROM service_providers WHERE code = ? AND tenant_id = ?`,
      )
      .get(code, getCurrentTenantId()) as ServiceProviderEntity | undefined;
  }

  /** Get a single service provider by id */
  getById(id: number): ServiceProviderEntity | undefined {
    return this.db
      .prepare(
        `SELECT ${COLUMNS} FROM service_providers WHERE id = ? AND tenant_id = ?`,
      )
      .get(id, getCurrentTenantId()) as ServiceProviderEntity | undefined;
  }

  /**
   * Create a new service provider.
   *
   * Named `createProvider` (not `create`) so it does NOT override
   * `BaseRepository.create()` — that generic method returns `T`, this one
   * returns `{success, id?, error?}` (mirrors `PaymentMethodRepository`'s
   * non-generic surface, and `CurrencyRepository.createCurrency` for the
   * same reason: an incompatible override of a base-class method name is a
   * TS error).
   */
  createProvider(data: CreateServiceProviderData): {
    success: boolean;
    id?: number;
    error?: string;
  } {
    try {
      const tenantId = getCurrentTenantId();
      const sortOrder =
        data.sort_order ??
        (
          this.db
            .prepare(
              `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM service_providers WHERE tenant_id = ?`,
            )
            .get(tenantId) as { next: number }
        ).next;

      const result = this.db
        .prepare(
          `INSERT INTO service_providers (code, label, drawer_name, is_system_provider, sort_order, tenant_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          data.code.toUpperCase(),
          data.label,
          data.drawer_name,
          data.is_system_provider ?? 0,
          sortOrder,
          tenantId,
        );

      return { success: true, id: result.lastInsertRowid as number };
    } catch (error: any) {
      if (error.message?.includes("UNIQUE constraint")) {
        return {
          success: false,
          error: `Service provider code '${data.code}' already exists`,
        };
      }
      return { success: false, error: error.message ?? String(error) };
    }
  }

  /** Update an existing service provider (named `updateProvider` — see `createProvider`'s doc comment on the override-collision reason). */
  updateProvider(
    id: number,
    data: UpdateServiceProviderData,
  ): { success: boolean; error?: string } {
    const provider = this.getById(id);
    if (!provider) {
      return { success: false, error: "Service provider not found" };
    }

    const setClauses: string[] = [];
    const params: any[] = [];

    if (data.label !== undefined) {
      setClauses.push("label = ?");
      params.push(data.label);
    }
    if (data.is_active !== undefined) {
      setClauses.push("is_active = ?");
      params.push(data.is_active);
    }

    // System providers: only label and is_active can be changed
    if (provider.is_system === 0) {
      if (data.drawer_name !== undefined) {
        setClauses.push("drawer_name = ?");
        params.push(data.drawer_name);
      }
      if (data.is_system_provider !== undefined) {
        setClauses.push("is_system_provider = ?");
        params.push(data.is_system_provider);
      }
    }

    if (data.sort_order !== undefined) {
      setClauses.push("sort_order = ?");
      params.push(data.sort_order);
    }

    if (setClauses.length === 0) {
      return { success: true };
    }

    setClauses.push("updated_at = CURRENT_TIMESTAMP");
    params.push(id, getCurrentTenantId());
    this.db
      .prepare(
        `UPDATE service_providers SET ${setClauses.join(", ")} WHERE id = ? AND tenant_id = ?`,
      )
      .run(...params);

    return { success: true };
  }

  /** Delete a service provider, only if non-system (named `deleteProvider` — see `createProvider`'s doc comment on the override-collision reason). */
  deleteProvider(id: number): { success: boolean; error?: string } {
    const provider = this.getById(id);
    if (!provider) {
      return { success: false, error: "Service provider not found" };
    }
    if (provider.is_system === 1) {
      return { success: false, error: "Cannot delete system service provider" };
    }

    this.db
      .prepare(`DELETE FROM service_providers WHERE id = ? AND tenant_id = ?`)
      .run(id, getCurrentTenantId());
    return { success: true };
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let serviceProviderRepositoryInstance: ServiceProviderRepository | null = null;

export function getServiceProviderRepository(): ServiceProviderRepository {
  if (!serviceProviderRepositoryInstance) {
    serviceProviderRepositoryInstance = new ServiceProviderRepository();
  }
  return serviceProviderRepositoryInstance;
}

/** Reset the singleton (for testing) */
export function resetServiceProviderRepository(): void {
  serviceProviderRepositoryInstance = null;
}
