export interface ElectronAPI {
    // Settings
    settings: {
        getAll: () => Promise<Array<{ key_name: string; value: string }>>;
        update: (key: string, value: string) => Promise<{ success: boolean }>;
    };

    // Expenses
    addExpense: (data: { description: string; category: string; expense_type: string; amount_usd: number; amount_lbp: number; expense_date: string }) => Promise<{ success: boolean; id?: number; error?: string }>;
    getTodayExpenses: () => Promise<any[]>;
    deleteExpense: (id: number) => Promise<{ success: boolean; error?: string }>;

    // Auth
    login: (username: string, password: string) => Promise<{ success: boolean; user?: { id: number; username: string; role: string }; error?: string }>;
    logout: (userId: number) => Promise<{ success: boolean }>;
    getCurrentUser: (userId: number) => Promise<{ id: number; username: string; role: string } | null>;
    getNonAdminUsers: () => Promise<Array<{ id: number; username: string; role: string; is_active: number }>>;
    setUserActive: (id: number, is_active: number) => Promise<{ success: boolean; error?: string }>;
    setUserRole: (id: number, role: 'admin' | 'staff') => Promise<{ success: boolean; error?: string }>;
    createUser: (username: string, password: string, role: 'admin' | 'staff') => Promise<{ success: boolean; id?: number; error?: string }>;
    setUserPassword: (id: number, password: string) => Promise<{ success: boolean; error?: string }>;

    // Inventory
    getProducts: (search?: string) => Promise<any[]>;
    getProduct: (id: number) => Promise<any>;
    getProductByBarcode: (barcode: string) => Promise<any>;
    createProduct: (product: any) => Promise<{ success: boolean; id?: number; error?: string }>;
    updateProduct: (product: any) => Promise<{ success: boolean; error?: string }>;
    deleteProduct: (id: number) => Promise<{ success: boolean; error?: string }>;
    adjustStock: (id: number, quantity: number) => Promise<{ success: boolean; error?: string }>;
    getInventoryStockStats: () => Promise<{ stock_budget_usd: number; stock_count: number }>;
    // Clients
    getClients: (search?: string) => Promise<any[]>;
    getClient: (id: number) => Promise<any>;
    createClient: (client: any) => Promise<{ success: boolean; id?: number; error?: string }>;
    updateClient: (client: any) => Promise<{ success: boolean; error?: string }>;
    deleteClient: (id: number) => Promise<{ success: boolean; error?: string }>;

    // Sales
    processSale: (saleData: any) => Promise<{ success: boolean; saleId?: number; error?: string }>;
    getDashboardStats: () => Promise<{ totalSalesUSD: number; totalSalesLBP: number; ordersCount: number; activeClients: number; lowStockCount: number }>;
    getProfitSalesChart: (type: 'Sales' | 'Profit') => Promise<any[]>; // Updated
    getTodaysSales: () => Promise<any[]>; // Updated
    getDrafts: () => Promise<any[]>;
    getTopProducts: () => Promise<{ name: string; total_quantity: number; total_revenue: number }[]>;
    getDrawerBalances: () => Promise<{ generalDrawer: { usd: number; lbp: number; }; omtDrawer: { usd: number; lbp: number; }; }>; // New
    
    // Debt
    getDebtSummary: () => Promise<{ totalDebt: number; topDebtors: any[] }>; // New
    getDebtors: () => Promise<{ id: number; full_name: string; phone_number: string; total_debt: number }[]>;
    getClientDebtHistory: (clientId: number) => Promise<any[]>;
    addRepayment: (data: { clientId: number; amountUSD: number; amountLBP: number; note?: string; }) => Promise<{ success: boolean; id?: number; error?: string }>; // Updated
    getClientDebtTotal(clientId: number): Promise<number>;
    
    // Exchange
    currencies: {
        list: () => Promise<Array<{ id: number; code: string; name: string; is_active: number }>>;
        create: (code: string, name: string) => Promise<{ success: boolean; id?: number; error?: string }>;
        update: (data: { id: number; code?: string; name?: string; is_active?: number }) => Promise<{ success: boolean; error?: string }>;
        delete: (id: number) => Promise<{ success: boolean; error?: string }>;
    };
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
    rates: {
        list: () => Promise<Array<{ id: number; from_code: string; to_code: string; rate: number; updated_at: string }>>;
        set: (from_code: string, to_code: string, rate: number) => Promise<{ success: boolean; error?: string }>;
    };


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

    // Diagnostics
    diagnostics: {
        getSyncErrors: () => Promise<Array<{ id: number; endpoint: string; error: string; created_at: string }>>;
    };

    // Reports
    report: {
        generatePDF: (html: string, filename?: string) => Promise<{ success: boolean; path?: string; error?: string }>;
        backupDatabase: () => Promise<{ success: boolean; path?: string; error?: string }>;
    };

    // Closing
    closing: {
        getSystemExpectedBalances: () => Promise<{
            generalDrawer: { usd: number; lbp: number; eur: number };
            omtDrawer: { usd: number; lbp: number; eur: number };
        }>;
        setOpeningBalances: (data: {
            closing_date: string;
            amounts: Array<{ drawer_name: string; currency_code: string; opening_amount: number }>;
            user_id?: number;
        }) => Promise<{ success: boolean; id?: number; error?: string }>;
        createDailyClosing: (data: {
            closing_date: string;
            amounts: Array<{ drawer_name: string; currency_code: string; physical_amount: number; opening_amount?: number }>;
            user_id?: number;
            variance_notes?: string;
            report_path?: string;
        }) => Promise<{ success: boolean; id?: number; error?: string }>;
        updateDailyClosing: (data: { id: number; physical_usd?: number; physical_lbp?: number; physical_eur?: number; system_expected_usd?: number; system_expected_lbp?: number; variance_usd?: number; notes?: string; report_path?: string; user_id?: number; }) => Promise<{ success: boolean; error?: string }>;
        getDailyStatsSnapshot: () => Promise<{
            salesCount: number;
            totalSalesUSD: number;
            totalSalesLBP: number;
            debtPaymentsUSD: number;
            debtPaymentsLBP: number;
            totalExpensesUSD: number;
            totalExpensesLBP: number;
            totalProfitUSD: number;
        }>;
    };
}

declare global {
    interface Window {
        api: ElectronAPI;
    }
}
