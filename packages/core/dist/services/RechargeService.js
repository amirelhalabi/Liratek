/**
 * Recharge Service
 *
 * Business logic layer for mobile recharge operations (MTC/Alfa).
 */
import { getRechargeRepository, } from "../repositories/index.js";
// =============================================================================
// Recharge Service Class
// =============================================================================
export class RechargeService {
    rechargeRepo;
    constructor(rechargeRepo) {
        this.rechargeRepo = rechargeRepo ?? getRechargeRepository();
    }
    /**
     * Get virtual stock for MTC and Alfa
     */
    getStock() {
        try {
            return this.rechargeRepo.getVirtualStock();
        }
        catch (error) {
            console.error("Failed to get recharge stock:", error);
            return { mtc: 0, alfa: 0 };
        }
    }
    /**
     * Process a recharge transaction
     */
    processRecharge(data) {
        return this.rechargeRepo.processRecharge(data);
    }
}
// =============================================================================
// Singleton Instance
// =============================================================================
let rechargeServiceInstance = null;
export function getRechargeService() {
    if (!rechargeServiceInstance) {
        rechargeServiceInstance = new RechargeService();
    }
    return rechargeServiceInstance;
}
/** Reset the singleton (for testing) */
export function resetRechargeService() {
    rechargeServiceInstance = null;
}
