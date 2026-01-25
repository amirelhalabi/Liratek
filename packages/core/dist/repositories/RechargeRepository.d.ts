/**
 * Recharge Repository
 *
 * Handles recharge-specific queries (virtual stock).
 * Uses products and sales tables.
 */
import { BaseRepository } from "./BaseRepository.js";
export interface VirtualStock {
    mtc: number;
    alfa: number;
}
export type RechargePaidByMethod = "CASH" | "OMT" | "WHISH" | "BINANCE";
export interface RechargeData {
    provider: "MTC" | "Alfa";
    type: "CREDIT_TRANSFER" | "VOUCHER" | "DAYS";
    amount: number;
    cost: number;
    price: number;
    paid_by_method?: RechargePaidByMethod;
    phoneNumber?: string;
}
export declare class RechargeRepository extends BaseRepository<{
    id: number;
}> {
    constructor();
    /**
     * Get virtual stock totals for MTC and Alfa
     */
    getVirtualStock(): VirtualStock;
    /**
     * Process a recharge transaction (creates sale, deducts stock, logs activity)
     */
    processRecharge(data: RechargeData): {
        success: boolean;
        saleId?: number;
        error?: string;
    };
}
export declare function getRechargeRepository(): RechargeRepository;
/** Reset the singleton (for testing) */
export declare function resetRechargeRepository(): void;
