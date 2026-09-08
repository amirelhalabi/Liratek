/**
 * Module Service
 *
 * Business logic layer for module management (enable/disable sidebar features).
 */

import {
  ModuleRepository,
  getModuleRepository,
  type ModuleEntity,
} from "../repositories/ModuleRepository.js";
import { toErrorString } from "../utils/errors.js";
import {
  getSubscriptionService,
  type SubscriptionService,
} from "./SubscriptionService.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { isUngateableModule } from "../constants/subscription.js";

// =============================================================================
// Types
// =============================================================================

export interface ModuleResult {
  success: boolean;
  error?: string;
}

// =============================================================================
// Module Service Class
// =============================================================================

export class ModuleService {
  private moduleRepo: ModuleRepository;
  private subscriptions: SubscriptionService;

  constructor(
    moduleRepo?: ModuleRepository,
    subscriptions?: SubscriptionService,
  ) {
    this.moduleRepo = moduleRepo ?? getModuleRepository();
    this.subscriptions = subscriptions ?? getSubscriptionService();
  }

  /**
   * Drop modules this tenant is not entitled to.
   *
   * The intersection rule, in the ONE place both transports read modules
   * from: `is_enabled` is the tenant's own choice (their admin can toggle
   * it), `entitled_modules` is what they pay for and cannot edit. A shop
   * gets modules that are BOTH.
   *
   * FAILS OPEN at every step — no tenant context, no subscription row, a
   * NULL allowlist, or a thrown lookup all return the list untouched. Two
   * paying desktop customers were live when this landed and neither had a
   * licence key; anything stricter would have taken modules away from
   * someone mid-shift.
   */
  private filterByEntitlement(modules: ModuleEntity[]): ModuleEntity[] {
    let tenantId: number;
    try {
      // Fail-closed by design outside a context, which is why this is
      // guarded: a read with no ambient tenant must not start throwing
      // where it previously returned a list.
      tenantId = getCurrentTenantId();
    } catch {
      return modules;
    }

    try {
      const view = this.subscriptions.statusFor(tenantId);
      if (!view || view.entitledModules === null) return modules;
      const allowed = new Set(view.entitledModules);
      return modules.filter(
        (m) => isUngateableModule(m.key) || allowed.has(m.key),
      );
    } catch {
      return modules;
    }
  }

  /** Get all modules */
  getAll(): ModuleEntity[] {
    return this.moduleRepo.getAll();
  }

  /**
   * Enabled modules for the sidebar, minus anything unentitled.
   *
   * Gated HERE rather than in each transport: this is the single read the
   * nav and the dashboard are built from, so one filter covers IPC and
   * REST both (rules 13/19). A copy in the main process or the router
   * would be a second implementation of the same rule.
   */
  getEnabledModules(): ModuleEntity[] {
    return this.filterByEntitlement(this.moduleRepo.getEnabledModules());
  }

  /**
   * Toggleable modules for Settings, also filtered.
   *
   * Deliberate: showing an unentitled module as toggleable lets an admin
   * switch it ON, see it confirmed, and then never find it in the nav —
   * which reads as a bug rather than a plan boundary. What you can see is
   * what you have. (An upsell list is a separate feature, not this one.)
   */
  getToggleableModules(): ModuleEntity[] {
    return this.filterByEntitlement(this.moduleRepo.getToggleableModules());
  }

  /** Enable or disable a single module */
  setModuleEnabled(key: string, enabled: boolean): ModuleResult {
    try {
      const mod = this.moduleRepo.getByKey(key);
      if (!mod) return { success: false, error: `Module "${key}" not found` };
      if (mod.is_system)
        return {
          success: false,
          error: `System module "${key}" cannot be toggled`,
        };
      this.moduleRepo.setEnabled(key, enabled);
      return { success: true };
    } catch (e) {
      return { success: false, error: toErrorString(e) };
    }
  }

  /** Bulk enable/disable modules (filters out system modules) */
  bulkSetEnabled(
    updates: { key: string; is_enabled: boolean }[],
  ): ModuleResult {
    try {
      // Filter out system modules
      const valid = updates.filter((u) => {
        const mod = this.moduleRepo.getByKey(u.key);
        return mod && !mod.is_system;
      });
      this.moduleRepo.bulkSetEnabled(valid);
      return { success: true };
    } catch (e) {
      return { success: false, error: toErrorString(e) };
    }
  }

  /** Reorder modules — accepts an ordered array of module keys */
  reorderModules(orderedKeys: string[]): ModuleResult {
    try {
      this.moduleRepo.bulkUpdateSortOrder(orderedKeys);
      return { success: true };
    } catch (e) {
      return { success: false, error: toErrorString(e) };
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let moduleServiceInstance: ModuleService | null = null;

export function getModuleService(): ModuleService {
  if (!moduleServiceInstance) {
    moduleServiceInstance = new ModuleService();
  }
  return moduleServiceInstance;
}

/** Reset the singleton (for testing) */
export function resetModuleService(): void {
  moduleServiceInstance = null;
}
