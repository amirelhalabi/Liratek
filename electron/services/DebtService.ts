/**
 * Debt Service
 *
 * Business logic layer for debt operations.
 * Uses DebtRepository for data access.
 *
 * This service encapsulates:
 * - Debt queries and lookups
 * - Repayment processing
 * - Dashboard debt summaries
 */

import {
  DebtRepository,
  getDebtRepository,
  type DebtLedgerEntity,
  type DebtorSummary,
  type DebtSummary,
} from "../database/repositories";

// =============================================================================
// Types
// =============================================================================

export interface RepaymentResult {
  success: boolean;
  id?: number;
  error?: string;
}

export interface RepaymentData {
  clientId: number;
  amountUSD: number;
  amountLBP: number;
  note?: string;
  userId?: number;
}

// =============================================================================
// Debt Service Class
// =============================================================================

export class DebtService {
  private debtRepo: DebtRepository;

  constructor(debtRepo?: DebtRepository) {
    this.debtRepo = debtRepo ?? getDebtRepository();
  }

  // ---------------------------------------------------------------------------
  // Debtor Queries
  // ---------------------------------------------------------------------------

  /**
   * Get all clients with outstanding debt
   */
  getDebtors(): DebtorSummary[] {
    return this.debtRepo.findAllDebtors();
  }

  /**
   * Get debt history for a specific client
   */
  getClientHistory(clientId: number): DebtLedgerEntity[] {
    if (!clientId) {
      return [];
    }
    return this.debtRepo.findClientHistory(clientId);
  }

  /**
   * Get total debt amount for a specific client
   */
  getClientTotal(clientId: number): number {
    if (!clientId) {
      return 0;
    }
    return this.debtRepo.getClientDebtTotal(clientId);
  }

  // ---------------------------------------------------------------------------
  // Repayment Operations
  // ---------------------------------------------------------------------------

  /**
   * Process a debt repayment
   */
  addRepayment(data: RepaymentData): RepaymentResult {
    const { clientId, amountUSD, amountLBP, note, userId } = data;

    // Validate
    if (!clientId) {
      return { success: false, error: "Client ID is required" };
    }
    if (amountUSD <= 0 && amountLBP <= 0) {
      return {
        success: false,
        error: "Repayment amount must be greater than zero",
      };
    }

    try {
      const result = this.debtRepo.addRepayment({
        client_id: clientId,
        amount_usd: amountUSD,
        amount_lbp: amountLBP,
        note: note || null,
        created_by: userId || null,
      });

      console.log(
        `[DEBT] Repayment of $${amountUSD} and ${amountLBP} LBP for client ${clientId}`,
      );

      return { success: true, id: result.id };
    } catch (error) {
      console.error("Failed to add repayment:", error);
      return { success: false, error: (error as Error).message };
    }
  }

  // ---------------------------------------------------------------------------
  // Dashboard Queries
  // ---------------------------------------------------------------------------

  /**
   * Get debt summary for dashboard display
   */
  getDebtSummary(): DebtSummary {
    return this.debtRepo.getDebtSummary(5);
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let debtServiceInstance: DebtService | null = null;

export function getDebtService(): DebtService {
  if (!debtServiceInstance) {
    debtServiceInstance = new DebtService();
  }
  return debtServiceInstance;
}

/** Reset the singleton (for testing) */
export function resetDebtService(): void {
  debtServiceInstance = null;
}
