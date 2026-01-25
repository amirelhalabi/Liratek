/**
 * Recharge Service
 *
 * Business logic layer for mobile recharge operations (MTC/Alfa).
 */
import { RechargeRepository, type VirtualStock, type RechargeData } from "../repositories/index.js";
export interface RechargeResult {
    success: boolean;
    saleId?: number;
    error?: string;
}
export declare class RechargeService {
    private rechargeRepo;
    constructor(rechargeRepo?: RechargeRepository);
    /**
     * Get virtual stock for MTC and Alfa
     */
    getStock(): VirtualStock;
    /**
     * Process a recharge transaction
     */
    processRecharge(data: RechargeData): RechargeResult;
}
export declare function getRechargeService(): RechargeService;
/** Reset the singleton (for testing) */
export declare function resetRechargeService(): void;
