// Type definitions for window.api
export interface ElectronAPI {
    getSettings: () => Promise<Array<{ key_name: string; value: string }>>;
    getSetting: (key: string) => Promise<{ value: string } | undefined>;
    updateSetting: (key: string, value: string) => Promise<{ success: boolean }>;

    // Auth
    login: (username: string, password: string) => Promise<{ success: boolean; user?: { id: number; username: string; role: string }; error?: string }>;
    logout: (userId: number) => Promise<{ success: boolean }>;
    getCurrentUser: (userId: number) => Promise<{ id: number; username: string; role: string } | null>;

    // Inventory
    getProducts: (search?: string) => Promise<any[]>;
    getProduct: (id: number) => Promise<any>;
    getProductByBarcode: (barcode: string) => Promise<any>;
    createProduct: (product: any) => Promise<{ success: boolean; id?: number; error?: string }>;
    updateProduct: (product: any) => Promise<{ success: boolean; error?: string }>;
    deleteProduct: (id: number) => Promise<{ success: boolean; error?: string }>;
    adjustStock: (id: number, quantity: number) => Promise<{ success: boolean; error?: string }>;

    // Clients
    getClients: (search?: string) => Promise<any[]>;
    getClient: (id: number) => Promise<any>;
    createClient: (client: any) => Promise<{ success: boolean; id?: number; error?: string }>;
    updateClient: (client: any) => Promise<{ success: boolean; error?: string }>;
    deleteClient: (id: number) => Promise<{ success: boolean; error?: string }>;

    // Sales
    processSale: (saleData: any) => Promise<{ success: boolean; saleId?: number; error?: string }>;
    getDashboardStats: () => Promise<{ totalSales: number; ordersCount: number; activeClients: number; lowStockCount: number }>;
    getDrafts: () => Promise<any[]>;
    getSalesChart: () => Promise<{ date: string; amount: number }[]>;
    getRecentActivity: () => Promise<{ id: number; client_name: string; final_amount_usd: number; status: string; created_at: string }[]>;
    getTopProducts: () => Promise<{ name: string; total_quantity: number; total_revenue: number }[]>;

    // Debt
    getDebtors: () => Promise<{ id: number; full_name: string; phone_number: string; total_debt_usd: number }[]>;
    getClientDebtHistory: (clientId: number) => Promise<any[]>;
    addRepayment: (data: { clientId: number; amountUSD: number; amountLBP: number; note?: string; exchangeRate: number }) => Promise<{ success: boolean; id?: number; error?: string }>;

    // Exchange
    addExchangeTransaction: (data: { 
        fromCurrency: string; 
        toCurrency: string; 
        amountIn: number; 
        amountOut: number; 
        rate: number; 
        clientName?: string; 
        note?: string 
    }) => Promise<{ success: boolean; id?: number; error?: string }>;
    getExchangeHistory: () => Promise<any[]>;

    // OMT/Whish Financial Services
    addOMTTransaction: (data: { 
        provider: 'OMT' | 'WHISH' | 'BOB' | 'OTHER'; 
        serviceType: 'SEND' | 'RECEIVE' | 'BILL_PAYMENT'; 
        amountUSD: number; 
        amountLBP: number; 
        commissionUSD: number; 
        commissionLBP: number; 
        clientName?: string; 
        referenceNumber?: string; 
        note?: string 
    }) => Promise<{ success: boolean; id?: number; error?: string }>;
    getOMTHistory: (provider?: string) => Promise<any[]>;
    getOMTAnalytics: () => Promise<{ 
        today: { commissionUSD: number; commissionLBP: number; count: number }; 
        month: { commissionUSD: number; commissionLBP: number; count: number }; 
        byProvider: { provider: string; commission_usd: number; commission_lbp: number; count: number }[] 
    }>;

    // Recharge
    getRechargeStock: () => Promise<{ mtc: number; alfa: number }>;
    processRecharge: (data: { 
        provider: 'MTC' | 'Alfa'; 
        type: 'CREDIT_TRANSFER' | 'VOUCHER' | 'DAYS'; 
        amount: number; 
        cost: number; 
        price: number; 
        phoneNumber?: string 
    }) => Promise<{ success: boolean; saleId?: number; error?: string }>;

    // Maintenance
    saveMaintenanceJob: (job: any) => Promise<{ success: boolean; id?: number; error?: string }>;
    getMaintenanceJobs: (statusFilter?: string) => Promise<any[]>;
    deleteMaintenanceJob: (id: number) => Promise<{ success: boolean; error?: string }>;
}

declare global {
    interface Window {
        api: ElectronAPI;
    }
}
