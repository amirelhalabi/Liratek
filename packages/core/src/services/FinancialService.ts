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

      console.log(
        `[OMT/WHISH] ${data.provider} - ${data.serviceType}: Commission $${data.commissionUSD} [${result.drawer}]`,
      );

      return { success: true, id: result.id };
    } catch (error) {
      console.error("Failed to add financial service transaction:", error);
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
      console.error("Failed to get financial services history:", error);
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
      console.error("Failed to get analytics:", error);
      return {
        today: { commissionUSD: 0, commissionLBP: 0, count: 0 },
        month: { commissionUSD: 0, commissionLBP: 0, count: 0 },
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
