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
import { getDebtRepository, } from "../repositories/index.js";
// =============================================================================
// Debt Service Class
// =============================================================================
export class DebtService {
    debtRepo;
    constructor(debtRepo) {
        this.debtRepo = debtRepo ?? getDebtRepository();
    }
    // ---------------------------------------------------------------------------
    // Debtor Queries
    // ---------------------------------------------------------------------------
    /**
     * Get all clients with outstanding debt
     */
    getDebtors() {
        return this.debtRepo.findAllDebtors();
    }
    /**
     * Get debt history for a specific client
     */
    getClientHistory(clientId) {
        if (!clientId) {
            return [];
        }
        return this.debtRepo.findClientHistory(clientId);
    }
    /**
     * Get total debt amount for a specific client
     */
    getClientTotal(clientId) {
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
    addRepayment(data) {
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
            console.log(`[DEBT] Repayment of $${amountUSD} and ${amountLBP} LBP for client ${clientId}`);
            return { success: true, id: result.id };
        }
        catch (error) {
            console.error("Failed to add repayment:", error);
            return { success: false, error: error.message };
        }
    }
    // ---------------------------------------------------------------------------
    // Dashboard Queries
    // ---------------------------------------------------------------------------
    /**
     * Get debt summary for dashboard display
     */
    getDebtSummary() {
        return this.debtRepo.getDebtSummary(5);
    }
}
// =============================================================================
// Singleton Instance
// =============================================================================
let debtServiceInstance = null;
export function getDebtService() {
    if (!debtServiceInstance) {
        debtServiceInstance = new DebtService();
    }
    return debtServiceInstance;
}
/** Reset the singleton (for testing) */
export function resetDebtService() {
    debtServiceInstance = null;
}
