/**
 * Financial Service (OMT/WHISH/BOB) Service
 *
 * Business logic layer for money transfer operations.
 * Uses FinancialServiceRepository for data access.
 */

import {
  FinancialServiceRepository,
  getFinancialServiceRepository,
  type FinancialServiceEntity,
  type CreateFinancialServiceData,
  type FinancialServiceAnalytics,
  type UnsettledSummary,
} from "../repositories/index.js";
import { getItemCostService } from "./ItemCostService.js";
import { financialLogger } from "../utils/logger.js";

// =============================================================================
// Types
// =============================================================================

export interface FinancialServiceResult {
  success: boolean;
  id?: number;
  error?: string;
}

// =============================================================================
// Financial Service Class
// =============================================================================

export class FinancialService {
  private fsRepo: FinancialServiceRepository;

  constructor(fsRepo?: FinancialServiceRepository) {
    this.fsRepo = fsRepo ?? getFinancialServiceRepository();
  }

  // ---------------------------------------------------------------------------
  // Transaction Operations
  // ---------------------------------------------------------------------------

  /**
   * Add a new financial service transaction (OMT, WHISH, BOB, etc.)
   */
  addTransaction(data: CreateFinancialServiceData): FinancialServiceResult {
    try {
      const result = this.fsRepo.createTransaction(data);

      // Auto-save item cost for future reference
      if (data.itemKey && data.cost !== undefined && data.cost > 0) {
        try {
          const itemCostService = getItemCostService();
          itemCostService.autoSaveCost(
            data.provider,
            data.itemCategory ?? data.serviceType,
            data.itemKey,
            data.cost,
            data.currency ?? "USD",
          );
        } catch (costError) {
          financialLogger.warn(
            { error: costError, itemKey: data.itemKey },
            "Failed to auto-save item cost (non-critical)",
          );
        }
      }

      financialLogger.info(
        {
          provider: data.provider,
          serviceType: data.serviceType,
          amount: data.amount,
          currency: data.currency ?? "USD",
          commission: data.commission,
          drawer: result.drawer,
          id: result.id,
        },
        `${data.provider} - ${data.serviceType}: Amount ${data.amount} ${data.currency ?? "USD"}, Commission ${data.commission}`,
      );

      return { success: true, id: result.id };
    } catch (error) {
      financialLogger.error(
        { error, data },
        "Failed to add financial service transaction",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Query Operations
  // ---------------------------------------------------------------------------

  /**
   * Get transaction history, optionally filtered by provider
   */
  getHistory(provider?: string): FinancialServiceEntity[] {
    try {
      return this.fsRepo.getHistory(provider);
    } catch (error) {
      financialLogger.error(
        { error, provider },
        "Failed to get financial services history",
      );
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Analytics
  // ---------------------------------------------------------------------------

  /**
   * Get comprehensive analytics (today, month, by provider)
   * commission = realized (settled); pending_commission = pending settlement
   */
  getAnalytics(providers?: string[]): FinancialServiceAnalytics {
    try {
      return this.fsRepo.getAnalytics(providers);
    } catch (error) {
      financialLogger.error({ error }, "Failed to get analytics");
      return {
        today: {
          commission: 0,
          pending_commission: 0,
          count: 0,
          byCurrency: [],
        },
        month: {
          commission: 0,
          pending_commission: 0,
          count: 0,
          byCurrency: [],
        },
        byProvider: [],
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Settlement Queries
  // ---------------------------------------------------------------------------

  /**
   * Get all unsettled transactions for a given provider (e.g. "OMT", "WHISH").
   * These are RECEIVE rows where commission > 0 and is_settled = 0.
   */
  getUnsettledByProvider(provider: string): FinancialServiceEntity[] {
    try {
      return this.fsRepo.getUnsettledBySupplier(provider);
    } catch (error) {
      financialLogger.error(
        { error, provider },
        "Failed to get unsettled transactions",
      );
      return [];
    }
  }

  /**
   * Get a per-provider summary of unsettled commissions and amounts owed.
   * Used by Dashboard pending note and Profits pending tab.
   */
  getUnsettledSummary(): UnsettledSummary[] {
    try {
      return this.fsRepo.getUnsettledSummaryByProvider();
    } catch (error) {
      financialLogger.error({ error }, "Failed to get unsettled summary");
      return [];
    }
  }

  /**
   * Update non-financial metadata on a financial service record.
   * Records old/new values for audit trail.
   */
  updateFinancialServiceMetadata(
    id: number,
    data: {
      client_name?: string;
      phone_number?: string;
      sender_name?: string;
      sender_phone?: string;
      receiver_name?: string;
      receiver_phone?: string;
      note?: string;
    },
    editedBy: string,
  ): {
    success: boolean;
    entity?: FinancialServiceEntity;
    oldValues?: Record<string, unknown>;
    error?: string;
  } {
    const existing = this.fsRepo.findById(id);
    if (!existing) {
      return { success: false, error: "Financial service record not found" };
    }

    const oldValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};

    const fields = [
      "client_name",
      "phone_number",
      "sender_name",
      "sender_phone",
      "receiver_name",
      "receiver_phone",
      "note",
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

    const updated = this.fsRepo.updateMetadata(id, data, editedBy);
    if (!updated) {
      return { success: false, error: "Failed to update" };
    }

    financialLogger.info(
      { id, editedBy, oldValues, newValues },
      "Financial service metadata updated",
    );

    return { success: true, entity: updated, oldValues };
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let financialServiceInstance: FinancialService | null = null;

export function getFinancialService(): FinancialService {
  if (!financialServiceInstance) {
    financialServiceInstance = new FinancialService();
  }
  return financialServiceInstance;
}

/** Reset the singleton (for testing) */
export function resetFinancialService(): void {
  financialServiceInstance = null;
}
