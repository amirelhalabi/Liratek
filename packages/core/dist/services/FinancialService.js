/**
 * Financial Service (OMT/WHISH/BOB) Service
 *
 * Business logic layer for money transfer operations.
 * Uses FinancialServiceRepository for data access.
 */
import { getFinancialServiceRepository, } from "../repositories/index.js";
// =============================================================================
// Financial Service Class
// =============================================================================
export class FinancialService {
    fsRepo;
    constructor(fsRepo) {
        this.fsRepo = fsRepo ?? getFinancialServiceRepository();
    }
    // ---------------------------------------------------------------------------
    // Transaction Operations
    // ---------------------------------------------------------------------------
    /**
     * Add a new financial service transaction (OMT, WHISH, BOB, etc.)
     */
    addTransaction(data) {
        try {
            const result = this.fsRepo.createTransaction(data);
            // Log the activity
            this.fsRepo.logActivity(data, result.drawer);
            console.log(`[OMT/WHISH] ${data.provider} - ${data.serviceType}: Commission $${data.commissionUSD} [${result.drawer}]`);
            return { success: true, id: result.id };
        }
        catch (error) {
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
    getHistory(provider) {
        try {
            return this.fsRepo.getHistory(provider);
        }
        catch (error) {
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
    getAnalytics() {
        try {
            return this.fsRepo.getAnalytics();
        }
        catch (error) {
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
let financialServiceInstance = null;
export function getFinancialService() {
    if (!financialServiceInstance) {
        financialServiceInstance = new FinancialService();
    }
    return financialServiceInstance;
}
/** Reset the singleton (for testing) */
export function resetFinancialService() {
    financialServiceInstance = null;
}
