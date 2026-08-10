/**
 * Service Provider Service
 *
 * Business logic over `ServiceProviderRepository`. Mirrors
 * `PaymentMethodService`'s shape (rule 13 — services never touch the DB
 * directly; all access goes through the injected repository).
 *
 * Phases 1-4a (this file's original scope) built only the read path: the
 * Partners "System Association" dropdown offers the REAL, tenant-scoped
 * provider list instead of a hardcoded `{None, <shop's non-owned system>}`
 * pair.
 *
 * Phase 5 (this addition) is the write path — the enabler that makes "add a
 * Syria provider" an actual data entry instead of a migration. Two
 * money-safety invariants live HERE, not just in the Zod schema
 * (`validators/serviceProvider.ts`), because a service method is the last
 * line of defense before the repository/DB regardless of which transport
 * (IPC or REST) or which schema instance validated the payload:
 *
 * 1. **`createProvider` always resolves `drawer_name` to `'General'`** —
 *    plan §5b owner decision (2026-08-09): "all of them if paid cash will
 *    affect general drawer. only the whish system association is linked to
 *    whish system drawer." A brand-new provider is never handed a bespoke
 *    drawer name (which the daily-close/checkpoint drawer enumeration would
 *    know nothing about) and is never marked `is_system_provider` (Primary-
 *    Cash-Drawer eligible — that stays OMT/WHISH-only, the two seeded rows
 *    that already carry it). The Zod create schema doesn't even accept
 *    these fields; this method hardcodes them as a second, independent
 *    layer, so even a hand-built payload that somehow includes them is
 *    ignored, not merely rejected.
 * 2. **`updateProvider` only ever forwards `label`/`is_active`** — `code` is
 *    already structurally impossible to change (`UpdateServiceProviderData`
 *    has no `code` field at all), and `drawer_name`/`is_system_provider` are
 *    deliberately never forwarded either, even though the repository itself
 *    still permits changing them for a non-system row (pre-existing phase
 *    1-2 capability, not reachable through this write path). This closes
 *    the same drawer-safety hole as (1) for the update path, not just create.
 */

import {
  ServiceProviderRepository,
  getServiceProviderRepository,
} from "../repositories/ServiceProviderRepository.js";
import type {
  ServiceProviderEntity,
  UpdateServiceProviderData,
} from "../repositories/ServiceProviderRepository.js";
// The service accepts exactly the shape the Zod schemas validate — one
// definition (rule 14), reused instead of a second parallel interface.
// `drawer_name`/`is_system_provider` are absent from both because they are
// never client-settable (see the class doc comment, invariants 1 and 2).
import type {
  CreateServiceProviderInput,
  UpdateServiceProviderInput,
} from "../validators/serviceProvider.js";
import { settingsLogger } from "../utils/logger.js";

const log = settingsLogger.child({ sub: "serviceProviders" });

export interface ServiceProviderResult {
  success: boolean;
  id?: number;
  error?: string;
}

export class ServiceProviderService {
  private repo: ServiceProviderRepository;

  constructor(repo?: ServiceProviderRepository) {
    this.repo = repo ?? getServiceProviderRepository();
  }

  /** List every service provider (including inactive/system) — the Settings
   *  management UI. Returns `[]` on error, same failure shape as
   *  `PaymentMethodService.listAll`. */
  listAll(): ServiceProviderEntity[] {
    try {
      return this.repo.getAll();
    } catch (error) {
      log.error({ error }, "ServiceProviderService.listAll error");
      return [];
    }
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

  /**
   * Create a new service provider. See the class doc comment (invariant 1)
   * for why `drawer_name`/`is_system_provider` are hardcoded here rather
   * than accepted from `data`.
   */
  createProvider(data: CreateServiceProviderInput): ServiceProviderResult {
    try {
      const code = data.code?.trim();
      const label = data.label?.trim();
      if (!code || !label) {
        return { success: false, error: "code and label are required" };
      }
      if (/\s/.test(data.code)) {
        return { success: false, error: "code must not contain whitespace" };
      }

      const result = this.repo.createProvider({
        code: data.code,
        label,
        // Hardcoded — see the class doc comment, invariant 1. NOT `data`'s
        // value, even if a caller included one.
        drawer_name: "General",
      });
      if (result.success) {
        log.info({ code: data.code }, "Service provider created");
      }
      return result;
    } catch (error) {
      log.error({ error, data }, "ServiceProviderService.createProvider error");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Update an existing service provider. See the class doc comment
   * (invariant 2) for why only `label`/`is_active` are forwarded.
   */
  updateProvider(
    id: number,
    data: UpdateServiceProviderInput,
  ): ServiceProviderResult {
    try {
      const forwarded: UpdateServiceProviderData = {
        label: data.label,
        is_active: data.is_active,
      };
      const result = this.repo.updateProvider(id, forwarded);
      if (result.success) {
        log.info({ id, data: forwarded }, "Service provider updated");
      }
      return result;
    } catch (error) {
      log.error({ error, id, data }, "ServiceProviderService.updateProvider error");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Delete a non-system service provider — the repository rejects a
   *  system row (the 9 seeded codes) with a clear error; this passes that
   *  result through unchanged. */
  deleteProvider(id: number): ServiceProviderResult {
    try {
      const result = this.repo.deleteProvider(id);
      if (result.success) {
        log.info({ id }, "Service provider deleted");
      }
      return result;
    } catch (error) {
      log.error({ error, id }, "ServiceProviderService.deleteProvider error");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
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
