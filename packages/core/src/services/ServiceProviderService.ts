/**
 * Service Provider Service
 *
 * Business logic over `ServiceProviderRepository` — currently just the read
 * path needed by FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5b phase 4a: the
 * Partners "System Association" dropdown offers the REAL, tenant-scoped
 * provider list instead of a hardcoded `{None, <shop's non-owned system>}`
 * pair. Mirrors `PaymentMethodService`'s shape (rule 13 — services never
 * touch the DB directly; all access goes through the injected repository).
 *
 * Phase 4b (relax `financial_services.provider`'s CHECK to an FK against
 * this table) and phase 5 (a "Syria" provider as a plain data entry) are
 * explicitly OUT of scope here — see the plan. CRUD for service providers
 * is not exposed yet; add it here (mirroring `PaymentMethodService.create/
 * update/delete/reorder`) when a provider-management surface is built.
 */

import {
  ServiceProviderRepository,
  getServiceProviderRepository,
} from "../repositories/ServiceProviderRepository.js";
import type { ServiceProviderEntity } from "../repositories/ServiceProviderRepository.js";
import { settingsLogger } from "../utils/logger.js";

const log = settingsLogger.child({ sub: "serviceProviders" });

export class ServiceProviderService {
  private repo: ServiceProviderRepository;

  constructor(repo?: ServiceProviderRepository) {
    this.repo = repo ?? getServiceProviderRepository();
  }

  /**
   * List only active service providers, ordered by `sort_order` — the read
   * path behind the Partners "System Association" dropdown. Returns `[]` on
   * error (same failure shape as `PaymentMethodService.listActive`) rather
   * than throwing, since callers render this straight into a dropdown.
   */
  listActive(): ServiceProviderEntity[] {
    try {
      return this.repo.getActive();
    } catch (error) {
      log.error({ error }, "ServiceProviderService.listActive error");
      return [];
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let serviceProviderServiceInstance: ServiceProviderService | null = null;

export function getServiceProviderService(): ServiceProviderService {
  if (!serviceProviderServiceInstance) {
    serviceProviderServiceInstance = new ServiceProviderService();
  }
  return serviceProviderServiceInstance;
}

/** Reset the singleton (for testing) */
export function resetServiceProviderService(): void {
  serviceProviderServiceInstance = null;
}
