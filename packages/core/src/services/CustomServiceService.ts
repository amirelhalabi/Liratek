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
import { getSettingsService } from "./SettingsService.js";
import {
  isValidFulfillmentTransition,
  type FulfillmentStatus,
} from "../utils/insuranceFulfillment.js";

// =============================================================================
// Types
// =============================================================================

export interface CustomServiceResult {
  success: boolean;
  id?: number;
  error?: string;
}

export interface FulfillmentUpdateResult {
  success: boolean;
  entity?: CustomServiceEntity;
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
    // §2 FINAL SPEC — the same per-shop "allow out-of-stock sales" setting
    // POS reads (SalesService.processSale) gates whether an inventory-backed
    // service's stock decrement is a hard guard or an unguarded (may go
    // negative) write; mirrors that call site exactly.
    const allowOutOfStock =
      getSettingsService().getSettingValue("allow_out_of_stock_sales")
        ?.value === "1";
    return this.repo.createService(data, undefined, { allowOutOfStock });
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

  /**
   * LIRA-155 — advance a custom service's fulfilment status. This is the
   * ONE place the transition rule is enforced server-side (rule 13's
   * policy-belongs-in-the-service split, and the ticket's explicit
   * instruction not to copy maintenance_jobs' `isPaidStatus` gate, which
   * only validates client-side). The repository's `updateFulfillmentStatus`
   * is a mechanical write with no opinion on legality — this method is the
   * only caller allowed to reach it for an existing row.
   *
   * Payment is a fully independent axis (owner decision): this method never
   * inspects `paid_by`/payments/drawers, and never will — an insurance can
   * be fully paid while still ORDERED.
   */
  advanceFulfillmentStatus(
    id: number,
    status: FulfillmentStatus,
  ): FulfillmentUpdateResult {
    const existing = this.repo.findById(id);
    if (!existing) {
      return { success: false, error: "Custom service not found" };
    }

    const current = existing.fulfillment_status;
    if (!isValidFulfillmentTransition(current, status)) {
      return {
        success: false,
        error: current
          ? `Cannot move fulfilment status from '${current}' to '${status}' — only the next step forward is allowed`
          : "This custom service is not fulfilment-tracked",
      };
    }

    const updated = this.repo.updateFulfillmentStatus(id, status);
    if (!updated) {
      return { success: false, error: "Failed to update fulfilment status" };
    }

    customServiceLogger.info(
      { id, from: current, to: status },
      "Custom service fulfilment status advanced",
    );

    return { success: true, entity: updated };
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
