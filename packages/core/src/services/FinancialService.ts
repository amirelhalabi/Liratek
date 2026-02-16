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
} from "../repositories/index.js";
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

      // Log the activity
      this.fsRepo.logActivity(data, result.drawer);

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
   */
  getAnalytics(): FinancialServiceAnalytics {
    try {
      return this.fsRepo.getAnalytics();
    } catch (error) {
      financialLogger.error({ error }, "Failed to get analytics");
      return {
        today: { commission: 0, count: 0, byCurrency: [] },
        month: { commission: 0, count: 0, byCurrency: [] },
        byProvider: [],
      };
    }
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
