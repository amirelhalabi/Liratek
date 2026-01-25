/**
 * Financial Service Repository
 *
 * Handles all financial_services table operations (OMT, WHISH, BOB, etc.).
 * Uses BaseRepository for common functionality.
 */
import { BaseRepository } from "./BaseRepository.js";
export interface FinancialServiceEntity {
    id: number;
    provider: "OMT" | "WHISH" | "BOB" | "OTHER";
    service_type: "SEND" | "RECEIVE" | "BILL_PAYMENT";
    amount_usd: number;
    amount_lbp: number;
    commission_usd: number;
    commission_lbp: number;
    client_name: string | null;
    reference_number: string | null;
    note: string | null;
    created_at: string;
    created_by: number | null;
}
export interface CreateFinancialServiceData {
    provider: "OMT" | "WHISH" | "BOB" | "OTHER";
    serviceType: "SEND" | "RECEIVE" | "BILL_PAYMENT";
    amountUSD: number;
    amountLBP: number;
    commissionUSD: number;
    commissionLBP: number;
    clientName?: string;
    referenceNumber?: string;
    note?: string;
}
export interface ProviderStats {
    provider: string;
    commission_usd: number;
    commission_lbp: number;
    count: number;
}
export interface FinancialServiceAnalytics {
    today: {
        commissionUSD: number;
        commissionLBP: number;
        count: number;
    };
    month: {
        commissionUSD: number;
        commissionLBP: number;
        count: number;
    };
    byProvider: ProviderStats[];
}
export declare class FinancialServiceRepository extends BaseRepository<FinancialServiceEntity> {
    constructor();
    /**
     * Create a new financial service transaction
     */
    createTransaction(data: CreateFinancialServiceData): {
        id: number;
        drawer: string;
    };
    /**
     * Log the financial service activity
     */
    logActivity(data: CreateFinancialServiceData, drawer: string): void;
    /**
     * Get transaction history, optionally filtered by provider
     */
    getHistory(provider?: string, limit?: number): FinancialServiceEntity[];
    /**
     * Get comprehensive analytics for financial services
     */
    getAnalytics(): FinancialServiceAnalytics;
}
export declare function getFinancialServiceRepository(): FinancialServiceRepository;
/** Reset the singleton (for testing) */
export declare function resetFinancialServiceRepository(): void;
