import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
    // Database operations
    getSettings: () => ipcRenderer.invoke('db:get-settings'),
    getSetting: (key: string) => ipcRenderer.invoke('db:get-setting', key),
    updateSetting: (key: string, value: string) => ipcRenderer.invoke('db:update-setting', key, value),

    // Expenses
    addExpense: (data: any) => ipcRenderer.invoke('db:add-expense', data),
    getTodayExpenses: () => ipcRenderer.invoke('db:get-today-expenses'),
    deleteExpense: (id: number) => ipcRenderer.invoke('db:delete-expense', id),

    // Auth operations
    login: (username: string, password: string) => ipcRenderer.invoke('auth:login', username, password),
    logout: (userId: number) => ipcRenderer.invoke('auth:logout', userId),
    getCurrentUser: (userId: number) => ipcRenderer.invoke('auth:get-current-user', userId),

    // Inventory operations
    getProducts: (search?: string) => ipcRenderer.invoke('inventory:get-products', search),
    getProduct: (id: number) => ipcRenderer.invoke('inventory:get-product', id),
    getProductByBarcode: (barcode: string) => ipcRenderer.invoke('inventory:get-product-by-barcode', barcode),
    createProduct: (product: any) => ipcRenderer.invoke('inventory:create-product', product),
    updateProduct: (product: any) => ipcRenderer.invoke('inventory:update-product', product),
    deleteProduct: (id: number) => ipcRenderer.invoke('inventory:delete-product', id),
    adjustStock: (id: number, quantity: number) => ipcRenderer.invoke('inventory:adjust-stock', id, quantity),
    getLowStockProducts: () => ipcRenderer.invoke('inventory:get-low-stock-products'),

    // Client operations
    getClients: (search?: string) => ipcRenderer.invoke('clients:get-all', search),
    getClient: (id: number) => ipcRenderer.invoke('clients:get-one', id),
    createClient: (client: any) => ipcRenderer.invoke('clients:create', client),
    updateClient: (client: any) => ipcRenderer.invoke('clients:update', client),
    deleteClient: (id: number) => ipcRenderer.invoke('clients:delete', id),

    // Sales operations
    processSale: (saleData: any) => ipcRenderer.invoke('sales:process', saleData),
    getDashboardStats: () => ipcRenderer.invoke('sales:get-dashboard-stats'),
    getDrawerBalances: () => ipcRenderer.invoke('dashboard:get-drawer-balances'),
    getProfitSalesChart: (type: 'Sales' | 'Profit') => ipcRenderer.invoke('dashboard:get-profit-sales-chart', type),
    getDrafts: () => ipcRenderer.invoke('sales:get-drafts'),
    getTodaysSales: () => ipcRenderer.invoke('sales:get-todays-sales'),
    getTopProducts: () => ipcRenderer.invoke('sales:get-top-products'),

    // Debt
    getDebtSummary: () => ipcRenderer.invoke('dashboard:get-debt-summary'),
    getDebtors: () => ipcRenderer.invoke('debt:get-debtors'),
    getClientDebtHistory: (clientId: number) => ipcRenderer.invoke('debt:get-client-history', clientId),
    getClientDebtTotal: (clientId: number) => ipcRenderer.invoke('debt:get-client-total', clientId),
    addRepayment: (data: any) => ipcRenderer.invoke('debt:add-repayment', data),

    // Closing operations
    closing: {
        getSystemExpectedBalances: () => ipcRenderer.invoke('closing:get-system-expected-balances'),
        createDailyClosing: (data: any) => ipcRenderer.invoke('closing:create-daily-closing', data),
        getDailyStatsSnapshot: () => ipcRenderer.invoke('closing:get-daily-stats-snapshot'),
    },

    // Settings operations
    settings: {
        getAll: () => ipcRenderer.invoke('settings:get-all'),
        update: (key: string, value: string) => ipcRenderer.invoke('settings:update', key, value),
    },

    // Exchange
    addExchangeTransaction: (data: any) => ipcRenderer.invoke('exchange:add-transaction', data),
    getExchangeHistory: () => ipcRenderer.invoke('exchange:get-history'),

    // OMT/Whish Financial Services
    addOMTTransaction: (data: any) => ipcRenderer.invoke('omt:add-transaction', data),
    getOMTHistory: (provider?: string) => ipcRenderer.invoke('omt:get-history', provider),
    getOMTAnalytics: () => ipcRenderer.invoke('omt:get-analytics'),

    // Recharge (Alfa/MTC)
    getRechargeStock: () => ipcRenderer.invoke('recharge:get-stock'),
    processRecharge: (data: any) => ipcRenderer.invoke('recharge:process', data),

    // Maintenance
    saveMaintenanceJob: (job: any) => ipcRenderer.invoke('maintenance:save', job),
    getMaintenanceJobs: (statusFilter?: string) => ipcRenderer.invoke('maintenance:get-jobs', statusFilter),
    deleteMaintenanceJob: (id: number) => ipcRenderer.invoke('maintenance:delete', id),
});
