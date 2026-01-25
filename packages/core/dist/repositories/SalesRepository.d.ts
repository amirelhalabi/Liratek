/**
 * Sales Repository
 *
 * Handles all database operations for sales and sale_items.
 * Extends BaseRepository for standard CRUD operations.
 */
import { BaseRepository } from "./BaseRepository.js";
export interface SaleEntity {
    id: number;
    client_id: number | null;
    total_amount_usd: number;
    discount_usd: number;
    final_amount_usd: number;
    paid_usd: number;
    paid_lbp: number;
    change_given_usd: number;
    change_given_lbp: number;
    exchange_rate_snapshot: number;
    drawer_name: string;
    status: "completed" | "draft" | "cancelled" | "refunded";
    note: string | null;
    created_at: string;
    created_by?: number;
}
export interface SaleItemEntity {
    id: number;
    sale_id: number;
    product_id: number;
    quantity: number;
    sold_price_usd: number;
    cost_price_snapshot_usd: number;
    is_refunded: number;
    imei: string | null;
}
export interface SaleWithClient extends SaleEntity {
    client_name: string | null;
    client_phone: string | null;
}
export interface SaleItemWithProduct extends SaleItemEntity {
    name: string;
    barcode: string;
}
export interface DraftSaleWithItems extends SaleWithClient {
    items: SaleItemWithProduct[];
}
export type PaymentMethod = "CASH" | "OMT" | "WHISH" | "BINANCE";
export type PaymentCurrencyCode = "USD" | "LBP";
export interface PaymentLine {
    method: PaymentMethod;
    currency_code: PaymentCurrencyCode;
    amount: number;
}
export interface SaleRequest {
    client_id: number | null;
    client_name?: string;
    client_phone?: string;
    items: {
        product_id: number;
        quantity: number;
        price: number;
        imei?: string;
    }[];
    total_amount: number;
    discount: number;
    final_amount: number;
    payment_usd: number;
    payment_lbp: number;
    payments?: PaymentLine[];
    change_given_usd?: number;
    change_given_lbp?: number;
    exchange_rate: number;
    drawer_name?: string;
    id?: number;
    status?: "completed" | "draft" | "cancelled";
    note?: string;
}
export interface DashboardStats {
    totalSalesUSD: number;
    totalSalesLBP: number;
    cashCollectedUSD: number;
    cashCollectedLBP: number;
    ordersCount: number;
    activeClients: number;
    lowStockCount: number;
}
export interface DrawerBalance {
    usd: number;
    lbp: number;
}
export interface DrawerBalances {
    generalDrawer: DrawerBalance;
    omtDrawer: DrawerBalance;
}
export interface TopProduct {
    name: string;
    total_quantity: number;
    total_revenue: number;
}
export interface RecentSale {
    id: number;
    client_name: string | null;
    paid_usd: number;
    paid_lbp: number;
    created_at: string;
}
export interface ChartDataPoint {
    date: string;
    usd?: number;
    lbp?: number;
    profit?: number;
}
export declare class SalesRepository extends BaseRepository<SaleEntity> {
    constructor();
    /**
     * Process a complete sale transaction (create/update with items, stock, debt)
     * This wraps all sale operations in a single transaction
     */
    processSale(sale: SaleRequest): {
        success: boolean;
        saleId?: number;
        error?: string;
    };
    /**
     * Get all draft sales with client info and items
     */
    findDrafts(): DraftSaleWithItems[];
    /**
     * Create a new sale
     */
    createSale(data: {
        client_id: number | null;
        total_amount: number;
        discount: number;
        final_amount: number;
        payment_usd: number;
        payment_lbp: number;
        change_given_usd: number;
        change_given_lbp: number;
        exchange_rate: number;
        drawer_name: string;
        status: string;
        note: string | null;
    }): number;
    /**
     * Update an existing sale
     */
    updateSale(id: number, data: {
        client_id: number | null;
        total_amount: number;
        discount: number;
        final_amount: number;
        payment_usd: number;
        payment_lbp: number;
        change_given_usd: number;
        change_given_lbp: number;
        exchange_rate: number;
        drawer_name: string;
        status: string;
        note: string | null;
    }): boolean;
    /**
     * Delete all items for a sale (used when updating drafts)
     */
    deleteSaleItems(saleId: number): void;
    /**
     * Add an item to a sale
     */
    addSaleItem(saleId: number, item: {
        product_id: number;
        quantity: number;
        price: number;
        imei?: string | null;
    }): void;
    /**
     * Get sale items for a sale
     */
    getSaleItems(saleId: number): SaleItemWithProduct[];
    /**
     * Get dashboard statistics for today
     */
    getDashboardStats(): DashboardStats;
    /**
     * Get drawer balances for today
     */
    getDrawerBalances(): DrawerBalances;
    /**
     * Get today's recent sales for dashboard
     */
    getTodaysSales(limit?: number): RecentSale[];
    /**
     * Get top selling products
     */
    getTopProducts(limit?: number): TopProduct[];
    /**
     * Get chart data for last 30 days - Sales or Profit
     */
    getChartData(type: "Sales" | "Profit"): ChartDataPoint[];
    /**
     * Get sales by date range
     */
    findByDateRange(startDate: string, endDate: string): SaleWithClient[];
}
export declare function getSalesRepository(): SalesRepository;
/** Reset the singleton (for testing) */
export declare function resetSalesRepository(): void;
