/**
 * Custom Service Service
 *
 * Business logic layer for custom service operations.
 */

import {
  CustomServiceRepository,
  getCustomServiceRepository,
  type CustomServiceEntity,
  type CustomServiceSummary,
} from "../repositories/CustomServiceRepository.js";
import type { CreateCustomServiceInput } from "../validators/customService.js";
import { customServiceLogger } from "../utils/logger.js";

// =============================================================================
// Types
// =============================================================================

export interface CustomServiceResult {
  success: boolean;
  id?: number;
  error?: string;
}

// =============================================================================
// Custom Service Service Class
// =============================================================================

export class CustomServiceService {
  private repo: CustomServiceRepository;

  constructor(repo?: CustomServiceRepository) {
    this.repo = repo ?? getCustomServiceRepository();
  }

  /**
   * Add a new custom service.
   */
  addService(data: CreateCustomServiceInput): CustomServiceResult {
    if (data.transaction_time) {
      const txTime = new Date(data.transaction_time);
      if (isNaN(txTime.getTime())) {
        return { success: false, error: "Invalid transaction_time format" };
      }
      if (txTime > new Date()) {
        return {
          success: false,
          error: "transaction_time cannot be in the future",
        };
      }
    }
    return this.repo.createService(data);
  }

  /**
   * Get all services, optionally filtered by date.
   */
  getServices(filter?: { date?: string }): CustomServiceEntity[] {
    try {
      return this.repo.getAll(filter);
    } catch (error) {
      customServiceLogger.error({ error }, "Failed to get custom services");
      return [];
    }
  }

  /**
   * Get a single service by ID.
   */
  getServiceById(id: number): CustomServiceEntity | null {
    try {
      return this.repo.getById(id);
    } catch (error) {
      customServiceLogger.error({ error, id }, "Failed to get custom service");
      return null;
    }
  }

  /**
   * Delete a service and reverse its financial effects.
   */
  deleteService(id: number): { success: boolean; error?: string } {
    return this.repo.deleteService(id);
  }

  /**
   * Get today's summary statistics.
   */
  getTodaySummary(): CustomServiceSummary {
    try {
      return this.repo.getTodaySummary();
    } catch (error) {
      customServiceLogger.error({ error }, "Failed to get today summary");
      return {
        count: 0,
        totalCostUsd: 0,
        totalCostLbp: 0,
        totalPriceUsd: 0,
        totalPriceLbp: 0,
        totalProfitUsd: 0,
        totalProfitLbp: 0,
      };
    }
  }

  /**
   * Update non-financial metadata on a custom service record.
   * Records old/new values for audit trail.
   */
  updateCustomServiceMetadata(
    id: number,
    data: {
      description?: string;
      client_name?: string;
      phone_number?: string;
      note?: string;
      category?: string;
    },
    editedBy: string,
  ): {
    success: boolean;
    entity?: CustomServiceEntity;
    oldValues?: Record<string, unknown>;
    error?: string;
  } {
    const existing = this.repo.findById(id);
    if (!existing) {
      return { success: false, error: "Custom service not found" };
    }

    const oldValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};

    const fields = [
      "description",
      "client_name",
      "phone_number",
      "note",
      "category",
    ] as const;

    for (const field of fields) {
      if (data[field] !== undefined && data[field] !== existing[field]) {
        oldValues[field] = existing[field];
        newValues[field] = data[field];
      }
    }

    if (Object.keys(newValues).length === 0) {
      return { success: true, entity: existing };
    }

    const updated = this.repo.updateMetadata(id, data, editedBy);
    if (!updated) {
      return { success: false, error: "Failed to update" };
    }

    customServiceLogger.info(
      { id, editedBy, oldValues, newValues },
      "Custom service metadata updated",
    );

    return { success: true, entity: updated, oldValues };
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let customServiceServiceInstance: CustomServiceService | null = null;

export function getCustomServiceService(): CustomServiceService {
  if (!customServiceServiceInstance) {
    customServiceServiceInstance = new CustomServiceService();
  }
  return customServiceServiceInstance;
}

/** Reset the singleton (for testing) */
export function resetCustomServiceService(): void {
  customServiceServiceInstance = null;
}
