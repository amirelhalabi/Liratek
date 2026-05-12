/**
 * Service Preset Service
 *
 * Business logic layer for managing service presets (digital accounts, repairs, etc.).
 */

import {
  ServicePresetRepository,
  getServicePresetRepository,
  type ServicePresetEntity,
} from "../repositories/ServicePresetRepository.js";
import type {
  CreateServicePresetInput,
  UpdateServicePresetInput,
} from "../validators/servicePreset.js";
import { customServiceLogger } from "../utils/logger.js";

// =============================================================================
// Service
// =============================================================================

export class ServicePresetService {
  private repo: ServicePresetRepository;

  constructor(repo?: ServicePresetRepository) {
    this.repo = repo ?? getServicePresetRepository();
  }

  /**
   * Create a new service preset.
   */
  createPreset(data: CreateServicePresetInput): {
    success: boolean;
    preset?: ServicePresetEntity;
    error?: string;
  } {
    try {
      if (!data.name?.trim()) {
        return { success: false, error: "Name is required" };
      }
      const preset = this.repo.createPreset(data);
      return { success: true, preset };
    } catch (error) {
      customServiceLogger.error({ error }, "Failed to create service preset");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get all presets, optionally filtered.
   */
  getPresets(filter?: {
    category?: string;
    includeInactive?: boolean;
  }): ServicePresetEntity[] {
    try {
      return this.repo.getAll(filter);
    } catch (error) {
      customServiceLogger.error({ error }, "Failed to get service presets");
      return [];
    }
  }

  /**
   * Update a preset.
   */
  updatePreset(
    id: number,
    data: UpdateServicePresetInput,
  ): { success: boolean; preset?: ServicePresetEntity; error?: string } {
    try {
      const preset = this.repo.updatePreset(id, data);
      if (!preset) {
        return { success: false, error: "Preset not found" };
      }
      return { success: true, preset };
    } catch (error) {
      customServiceLogger.error(
        { error, id },
        "Failed to update service preset",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete a preset.
   */
  deletePreset(id: number): { success: boolean; error?: string } {
    try {
      const deleted = this.repo.deletePreset(id);
      if (!deleted) {
        return { success: false, error: "Preset not found" };
      }
      return { success: true };
    } catch (error) {
      customServiceLogger.error(
        { error, id },
        "Failed to delete service preset",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Seed default presets. Safe to call on every app startup.
   * Only inserts presets that don't already exist (by name + category).
   */
  seedDefaults(): void {
    try {
      this.repo.seedDefaults();
    } catch (error) {
      customServiceLogger.error({ error }, "Failed to seed default presets");
    }
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: ServicePresetService | null = null;

export function getServicePresetService(): ServicePresetService {
  if (!instance) {
    instance = new ServicePresetService();
  }
  return instance;
}

export function resetServicePresetService(): void {
  instance = null;
}
