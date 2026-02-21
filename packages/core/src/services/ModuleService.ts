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

  constructor(moduleRepo?: ModuleRepository) {
    this.moduleRepo = moduleRepo ?? getModuleRepository();
  }

  /** Get all modules */
  getAll(): ModuleEntity[] {
    return this.moduleRepo.getAll();
  }

  /** Get only enabled modules (for sidebar) */
  getEnabledModules(): ModuleEntity[] {
    return this.moduleRepo.getEnabledModules();
  }

  /** Get non-system modules (for Settings > Modules tab) */
  getToggleableModules(): ModuleEntity[] {
    return this.moduleRepo.getToggleableModules();
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
